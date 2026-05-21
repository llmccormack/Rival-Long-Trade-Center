import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getCompleteFundamentals, getTickerNews, getEarningsCalendar, getInsiderTransactions } from '@/lib/fmp/client'
import { getMarketCandidates } from '@/lib/yahoo/screener'
import { applyGrahamCriteria } from '@/lib/graham/screener'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import { scoreBuyDecision } from '@/lib/philosophy/scorer'
import { scoreSellDecision } from '@/lib/philosophy/sell-scorer'
import { allocateCapital } from '@/lib/philosophy/capital-allocator'
import { getMarketContext, formatMarketContext } from '@/lib/macro/market-context'
import { sendTradeNotification, sendRunSummary, sendVetoAlert } from '@/lib/notifications/email'
import { pushTradeNotification, pushRunSummary, pushVetoAlert } from '@/lib/notifications/push'
import { isAuthorized } from '@/lib/auth/cron'

// POST /api/autopilot/full-run
// Investor-style autopilot: sell then buy, watchlist only.
// Buffett doesn't screen the market — he evaluates businesses he already understands.
// Step 1: Sell check on all open positions.
// Step 2: Buy evaluation on all active watchlist items with sector concentration awareness.
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let config: any
  try {
    config = await prisma.autopilotConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    })
  } catch (err: any) {
    return Response.json({ error: 'DB unavailable: ' + err.message }, { status: 500 })
  }

  // ── Discovery: populate watchlist from Yahoo Finance screens ─────────────
  // Uses Yahoo-only data (0 FMP calls) to cast a wide net across ~900 US value
  // stocks from 4 preset screens. Stocks that pass the basic Yahoo pre-filter
  // are added to the watchlist; the buy phase below then runs the full FMP
  // philosophy analysis (Graham criteria, DCF, insider, news, etc.) on them.
  //
  // API budget: 0 FMP calls here. All philosophy scoring happens in Step 2.
  const discoveryResults: any[] = []
  if (config.autoDiscovery !== false) {
    try {
      const candidates = await getMarketCandidates({
        maxPE: 30,
        maxPB: 4,
        minMarketCapM: 100,
      })

      const existingWatchlistTickers = new Set(
        (await prisma.watchlistItem.findMany({ include: { stock: true } }))
          .map(w => w.stock.ticker)
      )

      for (const candidate of candidates) {
        if (existingWatchlistTickers.has(candidate.symbol)) {
          discoveryResults.push({ ticker: candidate.symbol, action: 'ALREADY_WATCHED' })
          continue
        }

        // Add to watchlist using Yahoo data — no FMP call needed here.
        // The buy phase (Step 2) runs the full philosophy scoring on watchlist items.
        try {
          const stock = await prisma.stock.upsert({
            where: { ticker: candidate.symbol },
            create: {
              ticker: candidate.symbol,
              name: candidate.name,
              sector: candidate.sector,
            },
            update: {},
          })
          await prisma.watchlistItem.upsert({
            where: { stockId: stock.id },
            create: {
              stockId: stock.id,
              notes: `Auto-discovered via Yahoo (PE: ${candidate.pe?.toFixed(1) ?? 'n/a'}, PB: ${candidate.pb?.toFixed(2) ?? 'n/a'})`,
            },
            update: {},
          })
          existingWatchlistTickers.add(candidate.symbol)
          discoveryResults.push({ ticker: candidate.symbol, action: 'ADDED_TO_WATCHLIST', pe: candidate.pe, pb: candidate.pb })
        } catch { /* skip DB errors per ticker */ }
      }
    } catch { /* discovery failure must not abort the run */ }
  }

  // ── Macro market context (Shiller CAPE overlay) ──────────────────────────
  const macro = await getMarketContext()
  const macroAudit = macro ? [formatMarketContext(macro)] : []

  const effectiveMinScore    = (config.minPhilosophyScore ?? 55) + (macro?.minScoreAdj ?? 0)
  const effectiveMinMos      = config.minMarginOfSafety ?? 30
  const effectiveCashReserve = (config.minCashReservePct ?? 15) + (macro?.cashReserveAdj ?? 0)
  const discountRate         = (config.discountRate ?? 10) / 100
  const maxSectorPct         = config.maxSectorPct ?? 30

  // ── Step 1: Sell check on all open positions ─────────────────────────────
  const openPositions = await prisma.paperPortfolioItem.findMany({
    where: { isOpen: true },
    include: { stock: true },
  })

  const sellResults: any[] = []

  for (const pos of openPositions) {
    try {
      const f = await getCompleteFundamentals(pos.stock.ticker)
      if (f.price <= 0) { sellResults.push({ ticker: pos.stock.ticker, action: 'SKIP', reason: 'No price data' }); continue }
      if (macro?.treasury10yr) {
        f.treasuryYield10yr = macro.treasury10yr
        if (f.ownerEarningsYield !== undefined) {
          f.ownerEarningsSpread = f.ownerEarningsYield - macro.treasury10yr
        }
      }
      const posIv = calculateIntrinsicValue(f, f.sharesOutstanding, discountRate)
      const posNews = await getTickerNews(pos.stock.ticker).catch(() => undefined)
      const sellSignal = scoreSellDecision(f, posIv, posNews, pos.mosAtPurchase ?? undefined)

      if (posNews && posNews.hardVetoFlags.length > 0) {
        await prisma.paperPortfolioItem.update({
          where: { id: pos.id },
          data: {
            isOpen: false,
            closedAt: new Date(),
            closePrice: f.price,
            closeReason: `News veto: ${posNews.hardVetoFlags[0]}`,
            currentPrice: f.price,
          },
        })
        await prisma.alert.create({
          data: {
            ticker: pos.stock.ticker,
            type: 'fundamental_change',
            message: `PAPER SELL (news veto): ${pos.stock.ticker} — "${posNews.hardVetoFlags[0]}"`,
            severity: 'warning',
          },
        })
        sellResults.push({ ticker: pos.stock.ticker, action: 'SOLD_NEWS_VETO', flag: posNews.hardVetoFlags[0], price: f.price })
        await Promise.all([
          sendVetoAlert({ ticker: pos.stock.ticker, reason: posNews.hardVetoFlags[0], isHeld: false }).catch(() => {}),
          pushVetoAlert({ ticker: pos.stock.ticker, reason: posNews.hardVetoFlags[0], isHeld: false }).catch(() => {}),
        ])
        continue
      }

      if (sellSignal.shouldSell) {
        await prisma.paperPortfolioItem.update({
          where: { id: pos.id },
          data: {
            isOpen: false,
            closedAt: new Date(),
            closePrice: f.price,
            closeReason: sellSignal.reason,
            currentPrice: f.price,
          },
        })
        await prisma.alert.create({
          data: {
            ticker: pos.stock.ticker,
            type: 'paper_sell',
            message: `PAPER SELL: ${pos.stock.ticker} @ $${f.price.toFixed(2)} — ${sellSignal.reason}`,
            severity: sellSignal.urgency === 'immediate' ? 'danger' : 'warning',
          },
        })
        sellResults.push({ ticker: pos.stock.ticker, action: 'PAPER_SELL', reason: sellSignal.reason, urgency: sellSignal.urgency, price: f.price })
        await Promise.all([
          sendTradeNotification({ type: 'sell', ticker: pos.stock.ticker, shares: pos.shares, price: f.price, reason: sellSignal.reason }).catch(() => {}),
          pushTradeNotification({ type: 'sell', ticker: pos.stock.ticker, shares: pos.shares, price: f.price, reason: sellSignal.reason }).catch(() => {}),
          ...(sellSignal.vetoSell ? [
            sendVetoAlert({ ticker: pos.stock.ticker, reason: sellSignal.reason, isHeld: true }).catch(() => {}),
            pushVetoAlert({ ticker: pos.stock.ticker, reason: sellSignal.reason, isHeld: true }).catch(() => {}),
          ] : []),
        ])
      } else {
        await prisma.paperPortfolioItem.update({
          where: { id: pos.id },
          data: { currentPrice: f.price },
        })
      }

      await new Promise(r => setTimeout(r, 200))
    } catch { /* skip */ }
  }

  // ── Step 2: Compute sector exposure from remaining open positions ─────────
  // Re-fetch after sells so the buy phase works with accurate sector headroom.
  const remainingPositions = await prisma.paperPortfolioItem.findMany({
    where: { isOpen: true },
    include: { stock: true },
  })

  const sectorExposure: Record<string, number> = {}
  let deployedCapital = 0
  for (const p of remainingPositions) {
    const val = p.shares * (p.currentPrice ?? p.avgCostBasis)
    deployedCapital += val
    const sector = p.stock?.sector
    if (sector) {
      sectorExposure[sector] = (sectorExposure[sector] ?? 0) + val
    }
  }

  // ── Step 2: Buy evaluation — watchlist with daily rotation ───────────────
  // The watchlist can grow large (hundreds of auto-discovered stocks).
  // Manual items (user-curated, no "Auto-discovered" note) are always analyzed.
  // Auto-discovered items rotate in daily batches so every stock gets evaluated
  // over a multi-day cycle without blowing the FMP API budget in a single run.
  const allWatchlist = await prisma.watchlistItem.findMany({
    where: { isActive: true },
    include: { stock: true },
    orderBy: { stock: { ticker: 'asc' } },  // stable alphabetical sort for rotation
  })

  const dailyLimit = config.dailyAnalysisLimit ?? 25
  const manualItems  = allWatchlist.filter(w => !w.notes?.startsWith('Auto-discovered'))
  const discovered   = allWatchlist.filter(w =>  w.notes?.startsWith('Auto-discovered'))
  const slotsLeft    = Math.max(0, dailyLimit - manualItems.length)

  // Rotate through auto-discovered items based on calendar day
  const dayN   = Math.floor(Date.now() / (24 * 60 * 60 * 1000))
  const start  = discovered.length > 0 ? (dayN * slotsLeft) % discovered.length : 0
  const rotatedBatch = slotsLeft > 0 && discovered.length > 0
    ? [
        ...discovered.slice(start, start + slotsLeft),
        ...discovered.slice(0, Math.max(0, start + slotsLeft - discovered.length)),
      ]
    : []

  const watchlist = [...manualItems, ...rotatedBatch]

  const tradeResults: any[] = []

  for (const item of watchlist) {
    try {
      const fundamentals = await getCompleteFundamentals(item.stock.ticker)
      if (fundamentals.price <= 0) {
        tradeResults.push({ ticker: item.stock.ticker, action: 'SKIP', reason: 'No price data from FMP' })
        continue
      }
      if (macro?.treasury10yr) {
        fundamentals.treasuryYield10yr = macro.treasury10yr
        if (fundamentals.ownerEarningsYield !== undefined) {
          fundamentals.ownerEarningsSpread = fundamentals.ownerEarningsYield - macro.treasury10yr
        }
      }
      const criteria = applyGrahamCriteria(fundamentals)
      const iv = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding, discountRate)
      const news = await getTickerNews(item.stock.ticker).catch(() => undefined)
      const insider = await getInsiderTransactions(item.stock.ticker).catch(() => undefined)
      const philosophy = scoreBuyDecision(fundamentals, criteria, iv, news, insider)

      // Deep-value dampening: net-nets and individual CAPE < 12 are statistically cheap
      // regardless of market temperature. Graham: "At 2/3 of NCAV, buy in any market."
      const isDeepValue = fundamentals.isNetNet || (fundamentals.capeRatio !== undefined && fundamentals.capeRatio < 12)
      const stockMinScore = isDeepValue
        ? Math.min(effectiveMinScore, (config.minPhilosophyScore ?? 55) + 3)
        : effectiveMinScore

      // Skip if earnings within 21 days — don't buy into uncertainty
      const earningsEvents = await getEarningsCalendar(item.stock.ticker).catch(() => [])
      const today = new Date()
      const earningsIn21Days = earningsEvents.some(e => {
        const d = new Date(e.date)
        const daysUntil = (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        return daysUntil >= 0 && daysUntil <= 21
      })
      if (earningsIn21Days) {
        tradeResults.push({
          ticker: item.stock.ticker,
          action: 'SKIP',
          score: philosophy.total,
          mos: iv.marginOfSafety,
          reason: 'Earnings within 21 days — waiting for clarity',
        })
        continue
      }

      const passed =
        philosophy.vetoedBy.length === 0 &&
        philosophy.total >= stockMinScore &&
        iv.marginOfSafety >= effectiveMinMos

      if (!passed) {
        tradeResults.push({
          ticker: item.stock.ticker,
          action: philosophy.vetoedBy.length > 0 ? 'VETOED' : 'SKIP',
          score: philosophy.total,
          mos: iv.marginOfSafety,
          grahamNumber: iv.grahamNumber,
          dcfValue: iv.dcfValue,
          reason: philosophy.vetoedBy.length > 0
            ? philosophy.vetoedBy.map((p: any) => p.title).join('; ')
            : `Score ${philosophy.total} / MOS ${iv.marginOfSafety.toFixed(1)}% below thresholds${isDeepValue ? ' (deep-value dampening applied)' : ''}`,
        })
        continue
      }

      if (config.mode === 'paper') {
        const stock = await prisma.stock.upsert({
          where: { ticker: item.stock.ticker },
          create: {
            ticker: item.stock.ticker,
            name: fundamentals.name,
            sector: fundamentals.sector,
            industry: fundamentals.industry,
            exchange: fundamentals.exchange,
          },
          update: { name: fundamentals.name },
        })

        const existing = await prisma.paperPortfolioItem.findFirst({
          where: { stockId: stock.id, isOpen: true },
        })
        const openCount = await prisma.paperPortfolioItem.count({ where: { isOpen: true } })
        const existingValue = existing
          ? existing.shares * (existing.currentPrice ?? existing.avgCostBasis)
          : 0

        const allocation = allocateCapital({
          totalCapital: config.totalCapital ?? 10000,
          conviction: philosophy.conviction,
          marginOfSafety: iv.marginOfSafety,
          philosophyScore: philosophy.total,
          price: fundamentals.price,
          maxPositionPct: config.maxPositionPct ?? 10,
          openPositionCount: openCount,
          maxPositions: config.maxPositions ?? 15,
          existingPositionValue: existingValue,
          deployedCapital,
          minCashReservePct: effectiveCashReserve,
          avgCostBasis: existing?.avgCostBasis,
          stockSector: fundamentals.sector,
          sectorExposure,
          maxSectorPct,
        })

        if (!allocation.canAllocate) {
          tradeResults.push({
            ticker: item.stock.ticker,
            action: 'SKIP',
            score: philosophy.total,
            mos: iv.marginOfSafety,
            reason: allocation.reason,
          })
          continue
        }

        if (existing) {
          const newShares = existing.shares + allocation.shares
          const newAvg = (existing.shares * existing.avgCostBasis + allocation.shares * fundamentals.price) / newShares
          await prisma.paperPortfolioItem.update({
            where: { id: existing.id },
            data: { shares: newShares, avgCostBasis: newAvg, currentPrice: fundamentals.price },
          })
        } else {
          await prisma.paperPortfolioItem.create({
            data: {
              stockId: stock.id,
              shares: allocation.shares,
              avgCostBasis: fundamentals.price,
              currentPrice: fundamentals.price,
              philosophyScore: philosophy.total,
              conviction: philosophy.conviction,
              mosAtPurchase: iv.marginOfSafety,
              auditTrail: [allocation.rationale, ...philosophy.auditTrail.slice(0, 9)],
            },
          })
        }

        // Update sector exposure for subsequent iterations in this run
        if (fundamentals.sector) {
          sectorExposure[fundamentals.sector] = (sectorExposure[fundamentals.sector] ?? 0) + allocation.dollarAmount
        }
        deployedCapital += allocation.dollarAmount

        await prisma.alert.create({
          data: {
            ticker: item.stock.ticker,
            type: 'paper_buy',
            message: `PAPER BUY: ${allocation.shares} shares of ${item.stock.ticker} @ $${fundamentals.price.toFixed(2)} ($${allocation.dollarAmount.toFixed(0)} · ${allocation.positionPct.toFixed(1)}% of capital) | Score: ${philosophy.total}/100 | MOS: ${iv.marginOfSafety.toFixed(1)}% | ${philosophy.conviction.toUpperCase()}`,
            severity: 'buy',
          },
        })

        tradeResults.push({
          ticker: item.stock.ticker,
          action: 'PAPER_BUY',
          shares: allocation.shares,
          price: fundamentals.price,
          dollarAmount: allocation.dollarAmount,
          positionPct: allocation.positionPct,
          score: philosophy.total,
          mos: iv.marginOfSafety,
          conviction: philosophy.conviction,
          rationale: allocation.rationale,
          grahamNumber: iv.grahamNumber,
          dcfValue: iv.dcfValue,
          intrinsicValue: iv.intrinsicValue,
        })
        await Promise.all([
          sendTradeNotification({ type: 'buy', ticker: item.stock.ticker, shares: allocation.shares, price: fundamentals.price, score: philosophy.total, mos: iv.marginOfSafety, conviction: philosophy.conviction }).catch(() => {}),
          pushTradeNotification({ type: 'buy', ticker: item.stock.ticker, shares: allocation.shares, price: fundamentals.price, score: philosophy.total, mos: iv.marginOfSafety, conviction: philosophy.conviction }).catch(() => {}),
        ])
      } else {
        tradeResults.push({
          ticker: item.stock.ticker,
          action: 'QUEUED_LIVE',
          score: philosophy.total,
          mos: iv.marginOfSafety,
          reason: 'Live execution requires Schwab account connected in Settings',
        })
      }
    } catch (err: any) {
      tradeResults.push({ ticker: item.stock.ticker, action: 'ERROR', reason: err.message })
    }
  }

  const summary = {
    ranAt: new Date().toISOString(),
    mode: config.mode,
    // Discovery phase
    discoveryEnabled: config.autoDiscovery !== false,
    newlyDiscovered: discoveryResults.filter(r => r.action === 'ADDED_TO_WATCHLIST').length,
    discoveryResults,
    macro: macro ? {
      sp500Cape: macro.sp500Cape,
      marketTemperature: macro.marketTemperature,
      treasury10yr: (macro.treasury10yr * 100).toFixed(2) + '%',
      excessEarningsYield: (macro.excessEarningsYield * 100).toFixed(2) + '%',
      effectiveMinScore,
      effectiveCashReservePct: effectiveCashReserve,
    } : null,
    // Sell phase
    positionsReviewed: openPositions.length,
    sells: sellResults.filter(r => r.action === 'PAPER_SELL').length,
    vetoSells: sellResults.filter(r => r.action === 'SOLD_NEWS_VETO').length,
    sellResults,
    // Buy phase
    watchlistTotal: allWatchlist.length,
    watchlistScanned: watchlist.length,
    watchlistManual: manualItems.length,
    watchlistDiscovered: discovered.length,
    buys: tradeResults.filter(r => r.action === 'PAPER_BUY').length,
    skipped: tradeResults.filter(r => r.action === 'SKIP').length,
    vetoed: tradeResults.filter(r => r.action === 'VETOED').length,
    capitalDeployed: tradeResults.filter(r => r.action === 'PAPER_BUY').reduce((s: number, r: any) => s + (r.dollarAmount ?? 0), 0),
    results: tradeResults,
  }

  const newlyAddedTickers = discoveryResults
    .filter(r => r.action === 'ADDED_TO_WATCHLIST')
    .map(r => r.ticker)

  await Promise.all([
    sendRunSummary({ buys: summary.buys, sells: summary.sells ?? 0, vetoed: summary.vetoed, skipped: summary.skipped, newWatchlist: newlyAddedTickers, results: summary.results, mode: summary.mode }).catch(() => {}),
    pushRunSummary({ buys: summary.buys, sells: summary.sells ?? 0, vetoed: summary.vetoed, newWatchlist: newlyAddedTickers, mode: summary.mode }).catch(() => {}),
  ])

  await prisma.autopilotConfig.update({
    where: { id: 'singleton' },
    data: { lastRunAt: new Date(), lastRunResult: summary },
  })

  try {
    await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/performance`, { method: 'POST' })
  } catch { /* best effort */ }

  return Response.json(summary)
}
