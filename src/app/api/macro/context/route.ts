import { getMarketContext } from '@/lib/macro/market-context'

// GET /api/macro/context
// Returns current S&P 500 CAPE, treasury yield, and autopilot adjustments.
// Used by the dashboard to show market temperature indicator.
export async function GET() {
  try {
    const ctx = await getMarketContext()

    if (!ctx) {
      return Response.json({
        available: false,
        reason: 'FRED data temporarily unavailable — autopilot running with no macro adjustment',
      })
    }

    return Response.json({
      available: true,
      sp500Cape: ctx.sp500Cape,
      treasury10yr: ctx.treasury10yr,
      treasury10yrPct: +(ctx.treasury10yr * 100).toFixed(2),
      marketTemperature: ctx.marketTemperature,
      excessEarningsYield: ctx.excessEarningsYield,
      excessEarningsYieldPct: +(ctx.excessEarningsYield * 100).toFixed(2),
      cashReserveAdj: ctx.cashReserveAdj,
      minScoreAdj: ctx.minScoreAdj,
      fetchedAt: ctx.fetchedAt,
      // Human-readable context
      interpretation: {
        cold:    'Rare buying opportunity — CAPE < 15. Expected 10yr real returns ~10%. Deploy aggressively.',
        fair:    'Fair valuations — CAPE 15-20. Expected 10yr real returns ~7%. Deploy selectively.',
        warm:    'Above historical average — CAPE 20-25. Expected 10yr real returns ~5%. Maintain discipline.',
        hot:     'Elevated valuations — CAPE 25-33. Expected 10yr real returns ~3%. Raise cash threshold.',
        extreme: 'Bubble territory — CAPE > 33. Expected 10yr real returns ~1-2%. Hold significant cash.',
      }[ctx.marketTemperature],
    })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
