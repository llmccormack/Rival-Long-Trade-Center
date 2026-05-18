import { prisma } from '@/lib/db/client'
import { getHistoricalPrices } from '@/lib/fmp/client'

export async function GET() {
  try {
    // Get all closed + open paper portfolio positions
    const positions = await prisma.paperPortfolioItem.findMany({
      include: { stock: true },
      orderBy: { firstPurchased: 'asc' },
    })

    if (positions.length === 0) {
      return Response.json({ hasData: false, message: 'No positions yet' })
    }

    // Snapshots for chart data (most recent 90 days of snapshots if they exist)
    const snapshots = await prisma.portfolioSnapshot.findMany({
      orderBy: { date: 'asc' },
      take: 90,
    })

    // Current open positions summary
    const open = positions.filter(p => p.isOpen)
    const closed = positions.filter(p => !p.isOpen)

    const totalCost = open.reduce((s, p) => s + p.shares * p.avgCostBasis, 0)
    const totalValue = open.reduce((s, p) => s + p.shares * (p.currentPrice ?? p.avgCostBasis), 0)
    const totalGainLoss = totalValue - totalCost
    const totalGainLossPct = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0

    // Realised P&L from closed positions
    const realisedGainLoss = closed.reduce((s, p) => {
      if (p.closePrice == null) return s
      return s + p.shares * (p.closePrice - p.avgCostBasis)
    }, 0)

    // Get SPY data from first purchase to now for benchmark
    const firstDate = positions[0].firstPurchased
    const fromStr = firstDate.toISOString().slice(0, 10)
    const toStr = new Date().toISOString().slice(0, 10)

    let spyReturn: number | null = null
    let spyPrices: { date: string; close: number }[] = []
    try {
      spyPrices = await getHistoricalPrices('SPY', fromStr, toStr)
      if (spyPrices.length >= 2) {
        const spyStart = spyPrices[0].close
        const spyEnd = spyPrices[spyPrices.length - 1].close
        spyReturn = ((spyEnd - spyStart) / spyStart) * 100
      }
    } catch { /* benchmark is best-effort */ }

    // Alpha vs SPY
    const alpha = spyReturn !== null ? totalGainLossPct - spyReturn : null

    // Best and worst open positions
    const positionsWithPnl = open.map(p => ({
      ticker: p.stock.ticker,
      shares: p.shares,
      avgCost: p.avgCostBasis,
      currentPrice: p.currentPrice ?? p.avgCostBasis,
      gainLossPct: p.currentPrice
        ? ((p.currentPrice - p.avgCostBasis) / p.avgCostBasis) * 100
        : 0,
      philosophyScore: p.philosophyScore,
      conviction: p.conviction,
      mosAtPurchase: p.mosAtPurchase,
      firstPurchased: p.firstPurchased,
    })).sort((a, b) => b.gainLossPct - a.gainLossPct)

    return Response.json({
      hasData: true,
      summary: {
        totalCost: Math.round(totalCost * 100) / 100,
        totalValue: Math.round(totalValue * 100) / 100,
        totalGainLoss: Math.round(totalGainLoss * 100) / 100,
        totalGainLossPct: Math.round(totalGainLossPct * 100) / 100,
        realisedGainLoss: Math.round(realisedGainLoss * 100) / 100,
        openPositions: open.length,
        closedPositions: closed.length,
        spyReturn: spyReturn !== null ? Math.round(spyReturn * 100) / 100 : null,
        alpha: alpha !== null ? Math.round(alpha * 100) / 100 : null,
        fromDate: fromStr,
        toDate: toStr,
      },
      positions: positionsWithPnl,
      snapshots,
      spyPrices: spyPrices.slice(-60), // last 60 days for chart
    })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// POST — take a snapshot of current portfolio value (called by full-run)
export async function POST() {
  try {
    const open = await prisma.paperPortfolioItem.findMany({
      where: { isOpen: true },
      include: { stock: true },
    })

    if (open.length === 0) return Response.json({ snapped: false })

    const totalCost = open.reduce((s, p) => s + p.shares * p.avgCostBasis, 0)
    const totalValue = open.reduce((s, p) => s + p.shares * (p.currentPrice ?? p.avgCostBasis), 0)
    const gainLossPct = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0

    // Get SPY price for today
    let spyPrice: number | null = null
    try {
      const today = new Date().toISOString().slice(0, 10)
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      const { getHistoricalPrices } = await import('@/lib/fmp/client')
      const spy = await getHistoricalPrices('SPY', yesterday, today)
      spyPrice = spy[spy.length - 1]?.close ?? null
    } catch { /* best effort */ }

    const snapshot = await prisma.portfolioSnapshot.create({
      data: {
        totalValue,
        totalCost,
        gainLossPct,
        spyPrice,
        positions: open.map(p => ({
          ticker: p.stock.ticker,
          shares: p.shares,
          value: p.shares * (p.currentPrice ?? p.avgCostBasis),
        })),
      },
    })

    return Response.json({ snapped: true, snapshot })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
