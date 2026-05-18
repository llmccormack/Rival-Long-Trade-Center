import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getMarketCandidates } from '@/lib/yahoo/screener'
import { getCompleteFundamentals, getTickerNews } from '@/lib/fmp/client'
import { applyGrahamCriteria } from '@/lib/graham/screener'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import { scoreBuyDecision } from '@/lib/philosophy/scorer'

// POST /api/autopilot/full-run
// Full pipeline: scan market → auto-populate watchlist → execute trades
// Step 1: Yahoo pre-screen + FMP scoring → promote qualifying stocks to watchlist
// Step 2: Run autopilot against full watchlist
export async function POST(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
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

  // ── Step 1: Market scan + watchlist population ───────────────────────────
  const scanStart = Date.now()
  const candidates = await getMarketCandidates({ maxPE: 18, maxPB: 2.0, minMarketCapM: 300 })
  const toAnalyse = candidates.slice(0, 40)

  const scanResults: any[] = []
  const promoted: string[] = []

  for (const candidate of toAnalyse) {
    try {
      const fundamentals = await getCompleteFundamentals(candidate.symbol)
      const criteria = applyGrahamCriteria(fundamentals)
      const iv = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding)
      const philosophy = scoreBuyDecision(fundamentals, criteria, iv)

      scanResults.push({
        ticker: candidate.symbol,
        philosophyScore: philosophy.total,
        signal: philosophy.signal,
        mos: iv.marginOfSafety,
        vetoCount: philosophy.vetoedBy.length,
      })

      // Auto-promote: no vetoes, score ≥ 55, MOS ≥ 30%
      if (
        philosophy.vetoedBy.length === 0 &&
        philosophy.total >= 55 &&
        iv.marginOfSafety >= 30
      ) {
        const stock = await prisma.stock.upsert({
          where: { ticker: candidate.symbol },
          create: {
            ticker: candidate.symbol,
            name: fundamentals.name,
            sector: fundamentals.sector,
            industry: fundamentals.industry,
            exchange: fundamentals.exchange,
          },
          update: { name: fundamentals.name },
        })
        await prisma.watchlistItem.upsert({
          where: { stockId: stock.id },
          create: {
            stockId: stock.id,
            targetPrice: iv.intrinsicValue * 0.7,
            notes: `Auto-added by full-run scan. Score: ${philosophy.total}/100, MOS: ${iv.marginOfSafety.toFixed(1)}%`,
            isActive: true,
          },
          update: { isActive: true },
        })
        promoted.push(candidate.symbol)
      }

      await new Promise(r => setTimeout(r, 200))
    } catch {
      // Skip tickers with no FMP data
    }
  }

  // ── Step 2: Execute trades against full watchlist ────────────────────────
  const tradeResults: any[] = []

  const watchlist = await prisma.watchlistItem.findMany({
    where: { isActive: true },
    include: { stock: true },
  })

  for (const item of watchlist) {
    try {
      const fundamentals = await getCompleteFundamentals(item.stock.ticker)
      const criteria = applyGrahamCriteria(fundamentals)
      const iv = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding)
      const news = await getTickerNews(item.stock.ticker).catch(() => undefined)
      const philosophy = scoreBuyDecision(fundamentals, criteria, iv, news)

      const passed =
        philosophy.vetoedBy.length === 0 &&
        philosophy.total >= config.minPhilosophyScore &&
        iv.marginOfSafety >= config.minMarginOfSafety

      if (!passed) {
        tradeResults.push({
          ticker: item.stock.ticker,
          action: philosophy.vetoedBy.length > 0 ? 'VETOED' : 'SKIP',
          score: philosophy.total,
          mos: iv.marginOfSafety,
          reason: philosophy.vetoedBy.length > 0
            ? philosophy.vetoedBy.map((p: any) => p.title).join('; ')
            : `Score ${philosophy.total} / MOS ${iv.marginOfSafety.toFixed(1)}% below thresholds`,
        })
        continue
      }

      const sharesToBuy = Math.max(1, Math.floor(10000 / fundamentals.price))

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

        if (existing) {
          const newShares = existing.shares + sharesToBuy
          const newAvg = (existing.shares * existing.avgCostBasis + sharesToBuy * fundamentals.price) / newShares
          await prisma.paperPortfolioItem.update({
            where: { id: existing.id },
            data: { shares: newShares, avgCostBasis: newAvg, currentPrice: fundamentals.price },
          })
        } else {
          await prisma.paperPortfolioItem.create({
            data: {
              stockId: stock.id,
              shares: sharesToBuy,
              avgCostBasis: fundamentals.price,
              currentPrice: fundamentals.price,
              philosophyScore: philosophy.total,
              conviction: philosophy.conviction,
              mosAtPurchase: iv.marginOfSafety,
              auditTrail: philosophy.auditTrail.slice(0, 10),
            },
          })
        }

        await prisma.alert.create({
          data: {
            ticker: item.stock.ticker,
            type: 'paper_buy',
            message: `PAPER BUY: ${sharesToBuy} shares of ${item.stock.ticker} @ $${fundamentals.price.toFixed(2)} | Score: ${philosophy.total}/100 | MOS: ${iv.marginOfSafety.toFixed(1)}%`,
            severity: 'buy',
          },
        })

        tradeResults.push({
          ticker: item.stock.ticker,
          action: 'PAPER_BUY',
          shares: sharesToBuy,
          price: fundamentals.price,
          score: philosophy.total,
          mos: iv.marginOfSafety,
          conviction: philosophy.conviction,
        })
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
    scanDurationMs: Date.now() - scanStart,
    // Scan phase
    candidatesScanned: toAnalyse.length,
    newlyPromoted: promoted,
    // Trade phase
    watchlistScanned: watchlist.length,
    buys: tradeResults.filter(r => r.action.includes('BUY')).length,
    skipped: tradeResults.filter(r => r.action === 'SKIP').length,
    vetoed: tradeResults.filter(r => r.action === 'VETOED').length,
    results: tradeResults,
  }

  await prisma.autopilotConfig.update({
    where: { id: 'singleton' },
    data: { lastRunAt: new Date(), lastRunResult: summary },
  })

  return Response.json(summary)
}
