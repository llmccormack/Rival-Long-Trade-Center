// GET /api/screener/scores
// Returns the full StockScore leaderboard — every stock ever scored, latest run only.
// Sorted by score desc. Used by the screener Score Board tab.

import { prisma } from '@/lib/db/client'

export async function GET(req: Request) {
  const url    = new URL(req.url)
  const signal = url.searchParams.get('signal')   // filter: BUY | PASS | HOLD
  const min    = Number(url.searchParams.get('minScore') ?? 0)
  const limit  = Math.min(Number(url.searchParams.get('limit') ?? 200), 500)

  try {
    const scores = await prisma.stockScore.findMany({
      where: {
        ...(signal ? { signal } : {}),
        ...(min > 0 ? { score: { gte: min } } : {}),
      },
      orderBy: { score: 'desc' },
      take: limit,
    })

    const buyThreshold = 45 // matches autopilot default — used by UI to draw the line

    return Response.json({
      total: scores.length,
      buySignals:  scores.filter(s => s.signal === 'BUY').length,
      aboveThreshold: scores.filter(s => s.score >= buyThreshold).length,
      buyThreshold,
      scores,
    })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
