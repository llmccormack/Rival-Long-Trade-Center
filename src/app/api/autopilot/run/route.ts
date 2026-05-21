import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getCompleteFundamentals, getTickerNews, getInsiderTransactions } from '@/lib/fmp/client'
import { applyGrahamCriteria } from '@/lib/graham/screener'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import { scoreBuyDecision } from '@/lib/philosophy/scorer'
import { allocateCapital } from '@/lib/philosophy/capital-allocator'
import { getMarketContext, formatMarketContext } from '@/lib/macro/market-context'
import { isAuthorized } from '@/lib/auth/cron'

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

  // isEnabled is informational only — cron always runs regardless

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

  // Apply macro adjustments on top of user config
  const effectiveMinScore     = (config.minPhilosophyScore ?? 55) + (macro?.minScoreAdj ?? 0)
  const effectiveMinMos       = config.minMarginOfSafety ?? 30
  const effectiveCashReserve  = (config.minCashReservePct ?? 15) + (macro?.cashReserveAdj ?? 0)

  // Compute deployed capital and sector exposure — used for cash reserve floor and sector caps
  const openPaperPositions = await prisma.paperPortfolioItem.findMany({
    where: { isOpen: true },
    include: { stock: true },
  })
  let deployedCapital = 0
  const sectorExposure: Record<string, number> = {}
  for (const p of openPaperPositions) {
    const val = p.shares * (p.currentPrice ?? p.avgCostBasis)
    deployedCapital += val
    const sector = (p as any).stock?.sector
    if (sector) {
      sectorExposure[sector] = (sectorExposure[sector] ?? 0) + val
    }
  }
  const maxSectorPct = config.maxSectorPct ?? 30

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
      const news = await getTickerNews(item.stock.ticker).catch(() => undefined)
      const insider = await getInsiderTransactions(item.stock.ticker).catch(() => undefined)
      const philosophy = scoreBuyDecision(fundamentals, criteria, iv, news, insider)

      // Deep-value dampening: net-nets and individual CAPE < 12 are statistically cheap
      // regardless of market temperature. Graham: "At 2/3 of NCAV, buy in any market."
      // The macro score overlay is calibrated for fairly-priced stocks, not deep-value situations.
      const isDeepValue = fundamentals.isNetNet || (fundamentals.capeRatio !== undefined && fundamentals.capeRatio < 12)
      const stockMinScore = isDeepValue
        ? Math.min(effectiveMinScore, (config.minPhilosophyScore ?? 55) + 3)
        : effectiveMinScore

      const passed =
        philosophy.vetoedBy.length === 0 &&
        philosophy.total >= stockMinScore &&
        iv.marginOfSafety >= effectiveMinMos

      if (!passed) {
        results.push({
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
          minCashReservePct,
          avgCostBasis: existing?.avgCostBasis,
          stockSector: fundamentals.sector,
          sectorExposure,
          maxSectorPct,
        })

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

        // Keep sector exposure and deployed capital accurate for subsequent iterations
        if (fundamentals.sector) {
          sectorExposure[fundamentals.sector] = (sectorExposure[fundamentals.sector] ?? 0) + allocation.dollarAmount
        }
        deployedCapital += allocation.dollarAmount

        await prisma.alert.create({
          data: {
            ticker: item.stock.ticker,
            type: 'paper_buy',
            message: `PAPER BUY: ${allocation.shares} shares of ${item.stock.ticker} @ $${fundamentals.price.toFixed(2)} ($${allocation.dollarAmount.toFixed(0)} · ${allocation.positionPct.toFixed(1)}% of capital) | Score: ${philosophy.total}/100 | MOS: ${iv.marginOfSafety.toFixed(1)}%`,
            severity: 'buy',
          },
        })

        results.push({
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
    skipped: results.filter(r => r.action === 'SKIP').length,
    vetoed: results.filter(r => r.action === 'VETOED').length,
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
