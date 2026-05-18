import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getCompleteFundamentals, getTickerNews } from '@/lib/fmp/client'
import { applyGrahamCriteria } from '@/lib/graham/screener'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import { scoreBuyDecision, scoreSellDecision } from '@/lib/philosophy/scorer'

// POST /api/autopilot/rebalance
// Reviews all open positions for sell signals, then runs buy scan on watchlist.
// Designed to be called by cron or manually from Settings.
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

  const sellActions: any[] = []
  const holdActions: any[] = []
  const vetoActions: any[] = []

  // ── Review open positions for sell signals ──────────────────────────────

  const openPositions = await prisma.paperPortfolioItem.findMany({
    where: { isOpen: true },
    include: { stock: true },
  })

  for (const pos of openPositions) {
    try {
      const fundamentals = await getCompleteFundamentals(pos.stock.ticker)
      const criteria = applyGrahamCriteria(fundamentals)
      const iv = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding)
      const news = await getTickerNews(pos.stock.ticker)

      // Hard-veto news kills the hold immediately
      if (news.hardVetoFlags.length > 0) {
        await prisma.paperPortfolioItem.update({
          where: { id: pos.id },
          data: {
            isOpen: false,
            closedAt: new Date(),
            closePrice: fundamentals.price,
            closeReason: `News veto: ${news.hardVetoFlags[0]}`,
            currentPrice: fundamentals.price,
          },
        })
        await prisma.alert.create({
          data: {
            ticker: pos.stock.ticker,
            type: 'fundamental_change',
            message: `PAPER SELL (news veto): ${pos.stock.ticker} — "${news.hardVetoFlags[0]}"`,
            severity: 'warning',
          },
        })
        vetoActions.push({
          ticker: pos.stock.ticker,
          action: 'SOLD_NEWS_VETO',
          flag: news.hardVetoFlags[0],
          closePrice: fundamentals.price,
        })
        continue
      }

      const sell = scoreSellDecision(fundamentals, criteria, iv, pos.avgCostBasis)

      if (sell.shouldSell) {
        await prisma.paperPortfolioItem.update({
          where: { id: pos.id },
          data: {
            isOpen: false,
            closedAt: new Date(),
            closePrice: fundamentals.price,
            closeReason: sell.reasons.join('; '),
            currentPrice: fundamentals.price,
          },
        })
        await prisma.alert.create({
          data: {
            ticker: pos.stock.ticker,
            type: 'fundamental_change',
            message: `PAPER SELL: ${pos.stock.ticker} @ $${fundamentals.price.toFixed(2)} — ${sell.reasons[0]}`,
            severity: 'warning',
          },
        })
        sellActions.push({
          ticker: pos.stock.ticker,
          action: 'SOLD',
          closePrice: fundamentals.price,
          reasons: sell.reasons,
        })
      } else {
        // Refresh current price
        await prisma.paperPortfolioItem.update({
          where: { id: pos.id },
          data: { currentPrice: fundamentals.price },
        })

        const buyScore = scoreBuyDecision(fundamentals, criteria, iv, news)
        holdActions.push({
          ticker: pos.stock.ticker,
          action: sell.signal,
          currentPrice: fundamentals.price,
          mos: iv.marginOfSafety,
          philosophyScore: buyScore.total,
          notes: sell.reasons,
        })
      }
    } catch (err: any) {
      holdActions.push({ ticker: pos.stock.ticker, action: 'ERROR', reason: err.message })
    }
  }

  const summary = {
    ranAt: new Date().toISOString(),
    positionsReviewed: openPositions.length,
    sold: sellActions.length,
    vetoSold: vetoActions.length,
    held: holdActions.length,
    sells: sellActions,
    vetos: vetoActions,
    holds: holdActions,
  }

  return Response.json(summary)
}
