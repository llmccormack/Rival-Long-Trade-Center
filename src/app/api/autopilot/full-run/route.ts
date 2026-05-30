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
import { isMarketDay } from '@/lib/utils/market-hours'
import { getSecTickers, getDailyBatch } from '@/lib/sec/tickers'
import { getQuickQuotes } from '@/lib/yahoo/quick-quote'

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

  // Only enforce market hours for automated cron runs, not manual UI triggers
  const isCronRequest = !!request.headers.get('authorization')
  if (isCronRequest && !isMarketDay()) {
    return Response.json({ message: 'Market closed — autopilot only runs on trading days', ranAt: new Date().toISOString() })
  }

  let dailyBuys = 0
  let dailyNotional = 0

  // ── Discovery: full US market coverage via SEC EDGAR + Yahoo quality signal ─
  // Phase A: SEC EDGAR pulls every exchange-listed US common stock (~5,000+).
  //   createMany with skipDuplicates is idempotent — safe to run every day.
  // Phase B: Yahoo screener flags stocks appearing in value screens right now,
  //   updating notes as a quality signal overlay on the EDGAR universe.
  //
  // API budget: 0 FMP calls here. All philosophy scoring happens in Step 2.
  const discoveryResults: any[] = []
  if (config.autoDiscovery !== false) {
    try {
      // ── Phase A: SEC EDGAR full universe (bulk, ~5,000 US stocks) ──────────
      // Pull every exchange-listed US common stock from SEC's free ticker list.
      // Uses createMany with skipDuplicates — safe to run every day, only adds new listings.
      const secTickers = await getSecTickers()

      if (secTickers.length > 0) {
        // Bulk upsert stocks
        await prisma.stock.createMany({
          data: secTickers.map(t => ({ ticker: t.ticker, name: t.name, exchange: t.exchange })),
          skipDuplicates: true,
        })

        // Get stock IDs for all SEC tickers
        const stocks = await prisma.stock.findMany({
          where: { ticker: { in: secTickers.map(t => t.ticker) } },
          select: { id: true, ticker: true },
        })

        // Get existing watchlist stock IDs
        const existingWatchlistIds = new Set(
          (await prisma.watchlistItem.findMany({ select: { stockId: true } }))
            .map(w => w.stockId)
        )

        // Bulk add new stocks to watchlist
        const newItems = stocks.filter(s => !existingWatchlistIds.has(s.id))
        if (newItems.length > 0) {
          await prisma.watchlistItem.createMany({
            data: newItems.map(s => ({
              stockId: s.id,
              notes: 'Auto-discovered via SEC EDGAR',
            })),
            skipDuplicates: true,
          })
          discoveryResults.push({ action: 'EDGAR_BULK', newStocks: newItems.length, totalSecTickers: secTickers.length })
        } else {
          discoveryResults.push({ action: 'EDGAR_BULK', newStocks: 0, totalSecTickers: secTickers.length })
        }
      }

      // ── Phase B: Yahoo screener (quality signal overlay) ──────────────────
      // Yahoo's preset screens highlight currently undervalued stocks.
      // These are already in the watchlist from EDGAR; Yahoo just confirms they're
      // appearing in value screens right now. We update their notes as a signal.
      const candidates = await getMarketCandidates({ maxPE: 30, maxPB: 4, minMarketCapM: 100 })
      let yahooHighlighted = 0
      for (const candidate of candidates) {
        try {
          await prisma.watchlistItem.updateMany({
            where: { stock: { ticker: candidate.symbol }, isActive: true },
            data: { notes: `Yahoo value screen (PE: ${candidate.pe?.toFixed(1) ?? 'n/a'}, PB: ${candidate.pb?.toFixed(2) ?? 'n/a'})` },
          })
          yahooHighlighted++
        } catch { /* skip */ }
      }
      if (yahooHighlighted > 0) {
        discoveryResults.push({ action: 'YAHOO_HIGHLIGHT', count: yahooHighlighted })
      }
    } catch { /* discovery failure must not abort the run */ }

    // ── Tier 2 Discovery: SEC EDGAR full-market scan (50/day, pre-filtered) ─
    // Cycles through all ~10,000 US public company tickers from SEC EDGAR.
    // 50 tickers/day are fetched from Yahoo for a quick value pre-filter,
    // and only those passing the filter are added to the watchlist.
    // At 50/day the full universe cycles in ~200 days.
    try {
      const allSecTickers = await getSecTickers()

      // Reuse the watchlist we already built above for the already-watched set
      const currentWatched = new Set(
        (await prisma.watchlistItem.findMany({ include: { stock: true } }))
          .map(w => w.stock.ticker)
      )

      const secBatch = getDailyBatch(allSecTickers, currentWatched, 50)

      if (secBatch.length > 0) {
        const quotes = await getQuickQuotes(secBatch.map(t => t.ticker))

        for (const q of quotes) {
          // Value pre-filter: must be equity, price > $1, marketCap > $50M,
          // and show at least one value signal (low PE or low PB)
          if (q.quoteType !== 'EQUITY') continue
          if (q.price < 1) continue
          if (q.marketCap > 0 && q.marketCap < 50_000_000) continue // skip micro-caps < $50M

          const hasValueSignal =
            (q.pe !== null && q.pe > 0 && q.pe < 30) ||
            (q.pb !== null && q.pb > 0 && q.pb < 3)

          if (!hasValueSignal) continue
          if (currentWatched.has(q.ticker)) continue

          try {
            const secInfo = secBatch.find(t => t.ticker === q.ticker)
            const stock = await prisma.stock.upsert({
              where: { ticker: q.ticker },
              create: {
                ticker: q.ticker,
                name: q.name ?? secInfo?.name ?? q.ticker,
                exchange: secInfo?.exchange ?? undefined,
              },
              update: {},
            })
            await prisma.watchlistItem.upsert({
              where: { stockId: stock.id },
              create: {
                stockId: stock.id,
                notes: `Auto-discovered via SEC EDGAR (PE: ${q.pe?.toFixed(1) ?? 'n/a'}, PB: ${q.pb?.toFixed(2) ?? 'n/a'})`,
              },
              update: {},
            })
            currentWatched.add(q.ticker)
            discoveryResults.push({
              ticker: q.ticker,
              action: 'ADDED_TO_WATCHLIST',
              source: 'SEC',
              pe: q.pe,
              pb: q.pb,
            })
          } catch { /* skip DB errors per ticker */ }
        }
      }
    } catch { /* SEC Tier 2 discovery failure must not abort the run */ }
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

  // ── Step 2: Buy evaluation — priority-based watchlist selection ──────────
  // Picks the best candidates each day rather than cycling blindly.
  // Priority order:
  //   1. Manual items (user-curated) — always included
  //   2. Yahoo-highlighted (appearing in active value screens) — high signal
  //   3. Previously scored with high score but failing MOS — close to qualifying
  //   4. Never analyzed — rotate through these to build coverage
  const allWatchlist = await prisma.watchlistItem.findMany({
    where: { isActive: true },
    include: { stock: true },
  })

  const dailyLimit = config.dailyAnalysisLimit ?? 25
  const manualItems = allWatchlist.filter(w => !w.notes?.startsWith('Auto-discovered') && !w.notes?.startsWith('Yahoo value screen'))

  // Yahoo-highlighted: appeared in Yahoo value screen recently
  const yahooHighlighted = allWatchlist.filter(w => w.notes?.startsWith('Yahoo value screen'))

  // Previously scored auto-discovered: sort by last score desc (closest to buy threshold first)
  const prevScored = allWatchlist
    .filter(w => (w.notes?.startsWith('Auto-discovered') || w.notes?.startsWith('SEC')) && w.lastScore !== null)
    .sort((a, b) => (b.lastScore ?? 0) - (a.lastScore ?? 0))

  // Never analyzed: rotate through these daily to build coverage
  const neverAnalyzed = allWatchlist.filter(w => w.lastAnalyzedAt === null && !w.notes?.startsWith('Yahoo value screen'))
  const dayN = Math.floor(Date.now() / (24 * 60 * 60 * 1000))

  // Fill slots in priority order
  const slotsLeft = Math.max(0, dailyLimit - manualItems.length)
  const selected = new Set(manualItems.map(w => w.id))
  const candidates: typeof allWatchlist = [...manualItems]

  // Add Yahoo-highlighted first (up to half remaining slots)
  const yahooSlots = Math.min(yahooHighlighted.length, Math.floor(slotsLeft / 2))
  for (const item of yahooHighlighted.slice(0, yahooSlots)) {
    if (!selected.has(item.id)) { candidates.push(item); selected.add(item.id) }
  }

  // Add previously high-scoring stocks
  for (const item of prevScored) {
    if (candidates.length >= dailyLimit) break
    if (!selected.has(item.id)) { candidates.push(item); selected.add(item.id) }
  }

  // Fill remaining slots with never-analyzed (rotating batch)
  if (candidates.length < dailyLimit && neverAnalyzed.length > 0) {
    const start = (dayN * dailyLimit) % neverAnalyzed.length
    const batch = [
      ...neverAnalyzed.slice(start, start + dailyLimit),
      ...neverAnalyzed.slice(0, Math.max(0, start + dailyLimit - neverAnalyzed.length)),
    ]
    for (const item of batch) {
      if (candidates.length >= dailyLimit) break
      if (!selected.has(item.id)) { candidates.push(item); selected.add(item.id) }
    }
  }

  const watchlist = candidates.slice(0, dailyLimit)

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

      // Persist IV + stock metadata so watchlist can display without live API calls
      Promise.all([
        prisma.intrinsicValue.create({
          data: {
            stockId: item.stockId,
            currentPrice: fundamentals.price,
            grahamNumber: iv.grahamNumber ?? null,
            dcfValue: iv.dcfValue ?? null,
            intrinsicValue: iv.intrinsicValue,
            marginOfSafety: iv.marginOfSafety,
            isBuySignal: iv.isBuySignal ?? false,
            ownerEarnings: fundamentals.ownerEarnings ?? null,
            discountRateUsed: discountRate,
          },
        }),
        prisma.stock.update({
          where: { id: item.stockId },
          data: {
            name: fundamentals.name,
            sector: fundamentals.sector ?? undefined,
            industry: fundamentals.industry ?? undefined,
          },
        }),
      ]).catch(() => {})

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
        const action = philosophy.vetoedBy.length > 0 ? 'VETOED' : 'SKIP'
        const skipReason = philosophy.vetoedBy.length > 0
          ? philosophy.vetoedBy.map((p: any) => p.title).join('; ')
          : `Score ${philosophy.total} / MOS ${iv.marginOfSafety.toFixed(1)}% below thresholds${isDeepValue ? ' (deep-value dampening applied)' : ''}`
        tradeResults.push({
          ticker: item.stock.ticker,
          action,
          score: philosophy.total,
          mos: iv.marginOfSafety,
          grahamNumber: iv.grahamNumber,
          dcfValue: iv.dcfValue,
          reason: skipReason,
        })
        prisma.watchlistItem.update({
          where: { stockId: item.stockId },
          data: { lastScore: philosophy.total, lastMos: iv.marginOfSafety, lastAction: action, lastSkipReason: skipReason, lastAnalyzedAt: new Date() },
        }).catch(() => {})
        continue
      }

      if (config.mode === 'paper') {
        // Daily trade limit check
        if (dailyBuys >= (config.maxDailyTrades ?? 5)) {
          tradeResults.push({ ticker: item.stock.ticker, action: 'SKIP', score: philosophy.total, mos: iv.marginOfSafety, reason: 'Daily trade limit reached' })
          continue
        }

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

        // Daily notional limit check
        if (dailyNotional + allocation.dollarAmount > (config.maxDailyNotional ?? 2000)) {
          tradeResults.push({ ticker: item.stock.ticker, action: 'SKIP', score: philosophy.total, mos: iv.marginOfSafety, reason: 'Daily notional limit reached' })
          continue
        }

        // Single trade notional clamp
        if (allocation.dollarAmount > (config.maxSingleNotional ?? 1000)) {
          allocation.dollarAmount = config.maxSingleNotional ?? 1000
          allocation.shares = Math.floor(allocation.dollarAmount / fundamentals.price)
          if (allocation.shares < 1) {
            tradeResults.push({ ticker: item.stock.ticker, action: 'SKIP', score: philosophy.total, mos: iv.marginOfSafety, reason: 'Single trade notional clamp resulted in 0 shares' })
            continue
          }
          allocation.dollarAmount = allocation.shares * fundamentals.price
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
        dailyBuys += 1
        dailyNotional += allocation.dollarAmount

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
    newlyDiscovered: discoveryResults.find(r => r.action === 'EDGAR_BULK')?.newStocks ?? 0,
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
    watchlistDiscovered: allWatchlist.filter(w => w.notes?.startsWith('Auto-discovered') || w.notes?.startsWith('Yahoo value screen') || w.notes?.startsWith('SEC')).length,
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
    await prisma.auditLog.create({
      data: {
        action: 'autopilot_run',
        actor: 'cron',
        details: { buys: summary.buys, skipped: summary.skipped, vetoed: summary.vetoed, mode: summary.mode } as any,
      },
    })
  } catch { /* audit failures must not crash main flow */ }

  try {
    await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/performance`, { method: 'POST' })
  } catch { /* best effort */ }

  return Response.json(summary)
}
