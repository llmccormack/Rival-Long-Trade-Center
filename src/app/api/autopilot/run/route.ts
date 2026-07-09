import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'
import { generateRundown } from '@/lib/ai/rundown'
import { getCompleteFundamentals, getTickerNews, getInsiderTransactions } from '@/lib/fmp/client'
import { applyGrahamCriteria } from '@/lib/graham/screener'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import { scoreBuyDecision } from '@/lib/philosophy/scorer'
import { allocateCapital } from '@/lib/philosophy/capital-allocator'
import { qualifiesForQualityMode, summarizeBlockers, QUALITY_SIZE_MULTIPLIER } from '@/lib/philosophy/quality-mode'
import { isMarketInFreefall } from '@/lib/fmp/client'
import { getMarketContext, formatMarketContext } from '@/lib/macro/market-context'
import { isAuthorized } from '@/lib/auth/cron'
import { isMarketDay } from '@/lib/utils/market-hours'

// Called by Railway cron: POST /api/autopilot/run
// Also callable manually from the Autopilot page (same-origin, no secret needed).
// External callers must pass: Authorization: Bearer <CRON_SECRET>
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

  if (!isMarketDay()) {
    return Response.json({ message: 'Market closed — autopilot only runs on trading days', ranAt: new Date().toISOString() })
  }

  // Kill switch — a disabled autopilot that still trades is not a kill switch.
  if (!config.isEnabled) {
    return Response.json({
      message: 'Autopilot is disabled (kill switch). Enable it in Settings to resume runs.',
      ranAt: new Date().toISOString(),
    })
  }

  let dailyBuys = 0
  let dailyNotional = 0

  const results: any[] = []

  // Rotation: manual items always analyzed; auto-discovered items rotate daily
  const allWatchlist = await prisma.watchlistItem.findMany({
    where: { isActive: true },
    include: { stock: true },
    orderBy: { stock: { ticker: 'asc' } },
  })
  const dailyLimit   = config.dailyAnalysisLimit ?? 25
  const manualItems  = allWatchlist.filter(w => !w.notes?.startsWith('Auto-discovered'))
  const discovered   = allWatchlist.filter(w =>  w.notes?.startsWith('Auto-discovered'))
  const slotsLeft    = Math.max(0, dailyLimit - manualItems.length)
  const dayN         = Math.floor(Date.now() / (24 * 60 * 60 * 1000))
  const start        = discovered.length > 0 ? (dayN * slotsLeft) % discovered.length : 0
  const rotatedBatch = slotsLeft > 0 && discovered.length > 0
    ? [...discovered.slice(start, start + slotsLeft), ...discovered.slice(0, Math.max(0, start + slotsLeft - discovered.length))]
    : []
  const watchlist = [...manualItems, ...rotatedBatch]

  // ── Macro market context (Shiller CAPE overlay) ──────────────────────────
  // Fetch once per run — adjusts cash reserve and min score based on S&P 500 CAPE.
  // Buffett sat on $325B cash in 2024 (CAPE ~34). In 2009 (CAPE ~13) he was buying.
  // This makes the autopilot behave like Buffett: aggressive in fear, patient in greed.
  const macro = await getMarketContext()
  const macroAudit = macro ? [formatMarketContext(macro)] : []

  // Market-regime carve-out: when SPY itself is in freefall, stock-level
  // freefall is uninformative — that is when Graham entries appear.
  const marketCrash = await isMarketInFreefall().catch(() => false)

  // Apply macro adjustments on top of user config
  const effectiveMinScore     = (config.minPhilosophyScore ?? 45) + Math.min(macro?.minScoreAdj ?? 0, 5)
  const effectiveMinMos       = config.minMarginOfSafety ?? 15
  const effectiveCashReserve  = (config.minCashReservePct ?? 15) + Math.min(macro?.cashReserveAdj ?? 0, 5)

  // Compute deployed capital and sector exposure — used for cash reserve floor and sector caps
  const openPaperPositions = await prisma.paperPortfolioItem.findMany({
    where: { isOpen: true },
    include: { stock: true },
  })
  let deployedCapital = 0
  let qualityDeployed = 0
  const sectorExposure: Record<string, number> = {}
  for (const p of openPaperPositions) {
    const val = p.shares * (p.currentPrice ?? p.avgCostBasis)
    deployedCapital += val
    if ((p as any).entryMode === 'quality') qualityDeployed += val
    const sector = (p as any).stock?.sector
    if (sector) {
      sectorExposure[sector] = (sectorExposure[sector] ?? 0) + val
    }
  }
  const maxSectorPct = config.maxSectorPct ?? 30
  const qualityCap = (config.totalCapital ?? 10000) * ((config.maxQualityPct ?? 35) / 100)

  const discountRate = ((config.discountRate ?? 10) / 100)
  const minCashReservePct = effectiveCashReserve

  for (const item of watchlist) {
    try {
      const fundamentals = await getCompleteFundamentals(item.stock.ticker)
      if (fundamentals.price <= 0) {
        results.push({ ticker: item.stock.ticker, action: 'SKIP', reason: 'No price data from FMP' })
        continue
      }
      // Inject treasury yield from macro context so scorer can compute OE spread
      if (macro?.treasury10yr) {
        fundamentals.treasuryYield10yr = macro.treasury10yr
        if (fundamentals.ownerEarningsYield !== undefined) {
          fundamentals.ownerEarningsSpread = fundamentals.ownerEarningsYield - macro.treasury10yr
        }
      }
      const criteria = applyGrahamCriteria(fundamentals)
      const iv = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding, discountRate)

      // Persist IV + stock metadata so watchlist displays without live API calls
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
      // The macro score overlay is calibrated for fairly-priced stocks, not deep-value situations.
      const isDeepValue = fundamentals.isNetNet || (fundamentals.capeRatio !== undefined && fundamentals.capeRatio < 12)
      const stockMinScore = isDeepValue
        ? Math.min(effectiveMinScore, (config.minPhilosophyScore ?? 45) + 3)
        : effectiveMinScore

      // Market-crash carve-out — suspend the per-stock falling-knife veto
      // when the whole market is crashing (see full-run for rationale)
      if (marketCrash && fundamentals.inFreefall) {
        fundamentals.inFreefall = false
      }

      // Bear-case gate: the MOS must survive a zero-growth stress test.
      // (Undefined bear-case is tolerated in paper mode — the scorer already
      // dampens for the data gap; the live path in manager.ts requires it.)
      const bearOk = iv.bearCaseMos === undefined || iv.bearCaseMos >= 0

      const passed =
        philosophy.vetoedBy.length === 0 &&
        philosophy.total >= stockMinScore &&
        iv.marginOfSafety >= effectiveMinMos &&
        bearOk

      // ── Quality Mode fallback — "wonderful company at a fair price" ────────
      // When the strict value gate fails (which is EVERY day in a hot market),
      // wonderful/good businesses at fair prices can still enter at half size,
      // capped at maxQualityPct of capital. Vetoes and the bear-case gate stand.
      let entryMode: 'value' | 'quality' = 'value'
      let qualityRationale: string | undefined
      if (!passed && config.mode === 'paper' && (config.qualityModeEnabled ?? true) &&
          philosophy.vetoedBy.length === 0 && bearOk) {
        const qm = qualifiesForQualityMode(fundamentals, philosophy, iv)
        if (qm.eligible && qualityDeployed < qualityCap) {
          entryMode = 'quality'
          qualityRationale = qm.rationale
        }
      }

      if (!passed && entryMode === 'value') {
        const action = philosophy.vetoedBy.length > 0 ? 'VETOED' : 'SKIP'
        const skipReason = philosophy.vetoedBy.length > 0
          ? philosophy.vetoedBy.map((p: any) => p.title).join('; ')
          : !bearOk
          ? `Bear-case MOS ${iv.bearCaseMos!.toFixed(1)}% < 0 — margin of safety evaporates under zero-growth stress`
          : `Score ${philosophy.total} / MOS ${iv.marginOfSafety.toFixed(1)}% below thresholds${isDeepValue ? ' (deep-value dampening applied)' : ''}`
        results.push({
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
        // Shadow book: record the pass we didn't take, with price at decision.
        // Later runs fill in forward returns — this is how thresholds get tuned
        // with evidence instead of philosophy alone.
        prisma.shadowDecision.create({
          data: {
            ticker: item.stock.ticker,
            action,
            reason: skipReason,
            score: philosophy.total,
            mos: iv.marginOfSafety,
            priceAtDecision: fundamentals.price,
          },
        }).catch(() => {})
        continue
      }

      if (config.mode === 'paper') {
        // Daily trade limit check
        if (dailyBuys >= (config.maxDailyTrades ?? 5)) {
          results.push({ ticker: item.stock.ticker, action: 'SKIP', score: philosophy.total, mos: iv.marginOfSafety, reason: 'Daily trade limit reached' })
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
          minCashReservePct,
          avgCostBasis: existing?.avgCostBasis,
          stockSector: fundamentals.sector,
          sectorExposure,
          maxSectorPct,
          piotroskiFScore: fundamentals.piotroskiFScore,
          inFreefall: fundamentals.inFreefall,
          marginTrendDeclining: fundamentals.operatingMarginTrend === 'declining',
          sizeMultiplier: entryMode === 'quality' ? QUALITY_SIZE_MULTIPLIER : undefined,
        })

        // Quality-mode exposure cap — hard clamp after allocation
        if (entryMode === 'quality' && allocation.canAllocate &&
            qualityDeployed + allocation.dollarAmount > qualityCap) {
          results.push({ ticker: item.stock.ticker, action: 'SKIP', score: philosophy.total, mos: iv.marginOfSafety, reason: `Quality-mode exposure cap reached ($${qualityDeployed.toFixed(0)} of $${qualityCap.toFixed(0)})` })
          continue
        }

        if (!allocation.canAllocate) {
          results.push({
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
          results.push({ ticker: item.stock.ticker, action: 'SKIP', score: philosophy.total, mos: iv.marginOfSafety, reason: 'Daily notional limit reached' })
          continue
        }

        // Single trade notional clamp
        if (allocation.dollarAmount > (config.maxSingleNotional ?? 1000)) {
          allocation.dollarAmount = config.maxSingleNotional ?? 1000
          allocation.shares = Math.floor(allocation.dollarAmount / fundamentals.price)
          if (allocation.shares < 1) {
            results.push({ ticker: item.stock.ticker, action: 'SKIP', score: philosophy.total, mos: iv.marginOfSafety, reason: 'Single trade notional clamp resulted in 0 shares' })
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
              entryMode,
              auditTrail: [
                ...(qualityRationale ? [qualityRationale] : []),
                allocation.rationale,
                ...philosophy.auditTrail.slice(0, 8),
              ],
            },
          })
        }

        // Keep sector exposure and deployed capital accurate for subsequent iterations
        if (fundamentals.sector) {
          sectorExposure[fundamentals.sector] = (sectorExposure[fundamentals.sector] ?? 0) + allocation.dollarAmount
        }
        deployedCapital += allocation.dollarAmount
        if (entryMode === 'quality') qualityDeployed += allocation.dollarAmount
        dailyBuys += 1
        dailyNotional += allocation.dollarAmount

        await prisma.alert.create({
          data: {
            ticker: item.stock.ticker,
            type: 'paper_buy',
            message: `PAPER BUY${entryMode === 'quality' ? ' (QUALITY — wonderful business at fair price, half-size)' : ''}: ${allocation.shares} shares of ${item.stock.ticker} @ $${fundamentals.price.toFixed(2)} ($${allocation.dollarAmount.toFixed(0)} · ${allocation.positionPct.toFixed(1)}% of capital) | Score: ${philosophy.total}/100 | MOS: ${iv.marginOfSafety.toFixed(1)}%`,
            severity: 'buy',
          },
        })

        results.push({
          ticker: item.stock.ticker,
          action: 'PAPER_BUY',
          entryMode,
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
      } else {
        // Live mode — defer to portfolio manager (requires Schwab connection)
        results.push({
          ticker: item.stock.ticker,
          action: 'QUEUED_LIVE',
          score: philosophy.total,
          mos: iv.marginOfSafety,
          reason: 'Live execution requires Schwab account connected in Settings',
        })
      }
    } catch (err: any) {
      results.push({ ticker: item.stock.ticker, action: 'ERROR', reason: err.message })
    }
  }

  const summary = {
    ranAt: new Date().toISOString(),
    mode: config.mode,
    totalCapital: config.totalCapital ?? 10000,
    watchlistScanned: watchlist.length,
    buys: results.filter(r => r.action.includes('BUY')).length,
    qualityBuys: results.filter(r => r.action.includes('BUY') && r.entryMode === 'quality').length,
    skipped: results.filter(r => r.action === 'SKIP').length,
    vetoed: results.filter(r => r.action === 'VETOED').length,
    // Why nothing was bought, at a glance — the top skip/veto reasons this run
    topBlockers: summarizeBlockers(results),
    qualityExposure: { deployed: Math.round(qualityDeployed), cap: Math.round(qualityCap) },
    capitalDeployed: results.filter(r => r.action.includes('BUY')).reduce((s, r) => s + (r.dollarAmount ?? 0), 0),
    // Macro context snapshot — shows market temperature at time of run
    macro: macro ? {
      sp500Cape: macro.sp500Cape,
      marketTemperature: macro.marketTemperature,
      treasury10yr: (macro.treasury10yr * 100).toFixed(2) + '%',
      excessEarningsYield: (macro.excessEarningsYield * 100).toFixed(2) + '%',
      effectiveMinScore,
      effectiveCashReservePct: effectiveCashReserve,
    } : null,
    results,
  }

  await prisma.autopilotConfig.update({
    where: { id: 'singleton' },
    data: { lastRunAt: new Date(), lastRunResult: summary },
  })

  // Generate daily rundown
  const openCount = await prisma.paperPortfolioItem.count({ where: { isOpen: true } }).catch(() => 0)
  const snapshot = await prisma.portfolioSnapshot.findFirst({ orderBy: { date: 'desc' } }).catch(() => null)

  const rundownText = await generateRundown({
    ranAt: summary.ranAt,
    mode: summary.mode,
    macro: summary.macro,
    watchlistTotal: allWatchlist.length,
    watchlistScanned: summary.watchlistScanned,
    buys: summary.buys,
    sells: 0,
    skipped: summary.skipped,
    vetoed: summary.vetoed,
    capitalDeployed: summary.capitalDeployed,
    topResults: (summary.results ?? []).slice(0, 20),
    openPositions: openCount,
    portfolioGainPct: snapshot?.gainLossPct,
  })

  if (rundownText) {
    await prisma.autopilotConfig.update({
      where: { id: 'singleton' },
      data: { dailyRundown: rundownText },
    }).catch(() => {})
  }

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

export async function GET() {
  try {
    const config = await prisma.autopilotConfig.findUnique({ where: { id: 'singleton' } })
    return Response.json({
      lastRunAt: config?.lastRunAt ?? null,
      lastRunResult: config?.lastRunResult ?? null,
    })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
