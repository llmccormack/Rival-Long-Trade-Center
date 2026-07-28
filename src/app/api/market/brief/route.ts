// ─── Daily Market Brief ───────────────────────────────────────────────────────
//
// The morning snapshot: index day-changes (S&P/Nasdaq/Dow via ETFs), the yield
// curve (10Y + 3M), what's dominating the tape (biggest gainers/losers), our own
// top-scored names, and the AI outlook (reuses the rundown generated on the last
// autopilot run — no per-load Claude cost). Session-protected by middleware.

import { prisma } from '@/lib/db/client'
import { getQuotes, getMarketMovers } from '@/lib/fmp/client'
import { getMarketContext } from '@/lib/macro/market-context'

const INDICES: Array<{ ticker: string; label: string }> = [
  { ticker: 'SPY', label: 'S&P 500' },
  { ticker: 'QQQ', label: 'Nasdaq 100' },
  { ticker: 'DIA', label: 'Dow Jones' },
]

export async function GET() {
  try {
    const [quotes, macro, gainers, losers, topScores, config] = await Promise.all([
      getQuotes(INDICES.map(i => i.ticker)),
      getMarketContext().catch(() => null),
      getMarketMovers('gainers').catch(() => []),
      getMarketMovers('losers').catch(() => []),
      prisma.stockScore.findMany({ where: { signal: 'BUY' }, orderBy: { score: 'desc' }, take: 5 }).catch(() => []),
      prisma.autopilotConfig.findUnique({ where: { id: 'singleton' } }).catch(() => null),
    ])

    const indices = INDICES.map(i => {
      const q = quotes.find(x => x.symbol === i.ticker)
      return {
        label: i.label,
        ticker: i.ticker,
        price: q?.price ?? null,
        changePct: q?.changesPercentage ?? null,
      }
    })

    // Yield-curve shape is a real-time recession tell; surface it plainly.
    const tenY = macro ? macro.treasury10yr * 100 : null
    const threeM = macro ? macro.tbill3mo * 100 : null
    const curveSpread = tenY !== null && threeM !== null ? +(tenY - threeM).toFixed(2) : null

    return Response.json({
      asOf: new Date().toISOString(),
      indices,
      rates: {
        tenYear: tenY !== null ? +tenY.toFixed(2) : null,
        threeMonth: threeM !== null ? +threeM.toFixed(2) : null,
        curveSpread,
        inverted: curveSpread !== null ? curveSpread < 0 : null,
      },
      market: macro ? {
        cape: macro.sp500Cape,
        temperature: macro.marketTemperature,
        capeSource: macro.capeSource,
      } : null,
      gainers,
      losers,
      topScores: topScores.map(s => ({ ticker: s.ticker, name: s.name, score: s.score, mos: s.mos, signal: s.signal })),
      outlook: config?.dailyRundown ?? null,
      outlookAsOf: config?.lastRunAt ?? null,
    })
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'error' }, { status: 500 })
  }
}
