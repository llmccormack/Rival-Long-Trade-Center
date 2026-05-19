import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getCompleteFundamentals, getTickerNews, getEarningsCalendar, getInsiderTransactions } from '@/lib/fmp/client'
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

  // ── Step 2: Buy evaluation — watchlist only ───────────────────────────────
  const watchlist = await prisma.watchlistItem.findMany({
    where: { isActive: true },
    include: { stock: true },
  })

  const tradeResults: any[] = []

  for (const item of watchlist) {
    try {
      const fundamentals = await getCompleteFundamentals(item.stock.ticker)
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
    watchlistScanned: watchlist.length,
    buys: tradeResults.filter(r => r.action === 'PAPER_BUY').length,
    skipped: tradeResults.filter(r => r.action === 'SKIP').length,
    vetoed: tradeResults.filter(r => r.action === 'VETOED').length,
    capitalDeployed: tradeResults.filter(r => r.action === 'PAPER_BUY').reduce((s: number, r: any) => s + (r.dollarAmount ?? 0), 0),
    results: tradeResults,
  }

  await Promise.all([
    sendRunSummary({ buys: summary.buys, sells: summary.sells ?? 0, vetoed: summary.vetoed, skipped: summary.skipped, newWatchlist: [], results: summary.results, mode: summary.mode }).catch(() => {}),
    pushRunSummary({ buys: summary.buys, sells: summary.sells ?? 0, vetoed: summary.vetoed, newWatchlist: [], mode: summary.mode }).catch(() => {}),
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
