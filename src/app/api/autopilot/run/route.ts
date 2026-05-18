import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getCompleteFundamentals, getTickerNews } from '@/lib/fmp/client'
import { applyGrahamCriteria } from '@/lib/graham/screener'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import { scoreBuyDecision } from '@/lib/philosophy/scorer'

// Called by Railway cron: POST /api/autopilot/run
// Also callable manually from the Autopilot settings page.
// Header: Authorization: Bearer <CRON_SECRET>
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

  // isEnabled is informational only — cron always runs regardless

  const results: any[] = []

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
        results.push({
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

      const sharesToBuy = Math.max(1, Math.floor(10000 / fundamentals.price)) // $10k notional for paper

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

        results.push({
          ticker: item.stock.ticker,
          action: 'PAPER_BUY',
          shares: sharesToBuy,
          price: fundamentals.price,
          score: philosophy.total,
          mos: iv.marginOfSafety,
          conviction: philosophy.conviction,
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
    watchlistScanned: watchlist.length,
    buys: results.filter(r => r.action.includes('BUY')).length,
    skipped: results.filter(r => r.action === 'SKIP').length,
    vetoed: results.filter(r => r.action === 'VETOED').length,
    results,
  }

  await prisma.autopilotConfig.update({
    where: { id: 'singleton' },
    data: { lastRunAt: new Date(), lastRunResult: summary },
  })

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
