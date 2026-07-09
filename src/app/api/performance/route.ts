import { prisma } from '@/lib/db/client'
import { getHistoricalPrices } from '@/lib/fmp/client'

export async function GET() {
  try {
    // Get all closed + open paper portfolio positions
    const positions = await prisma.paperPortfolioItem.findMany({
      include: { stock: true },
      orderBy: { firstPurchased: 'asc' },
    })

    // Always include macro/watchlist context regardless of whether there are positions
    const [topWatchlist, config] = await Promise.all([
      prisma.watchlistItem.findMany({
        where: { isActive: true, lastScore: { not: null } },
        orderBy: { lastScore: 'desc' },
        take: 5,
        include: { stock: { include: { intrinsicValues: { take: 1, orderBy: { calculatedAt: 'desc' } } } } },
      }).catch(() => []),
      prisma.autopilotConfig.findUnique({ where: { id: 'singleton' } }).catch(() => null),
    ])

    const topWatchlistSummary = topWatchlist.map((item: any) => {
      const iv = item.stock.intrinsicValues?.[0]
      return {
        ticker: item.stock.ticker,
        name: item.stock.name,
        lastScore: item.lastScore,
        lastMos: item.lastMos ?? iv?.marginOfSafety ?? null,
        lastAction: item.lastAction,
      }
    })

    const lastRunResult = config?.lastRunResult as any ?? null

    if (positions.length === 0) {
      return Response.json({
        hasData: false,
        message: 'No positions yet',
        topWatchlist: topWatchlistSummary,
        lastRunResult,
        lastRunAt: config?.lastRunAt ?? null,
      })
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

    // VTV — the style benchmark. Beating SPY is the wrong bar for a value
    // strategy in a growth-led market; alpha vs a value ETF answers the real
    // question: does this system beat what $0 of code would buy?
    let vtvReturn: number | null = null
    try {
      const vtv = await getHistoricalPrices('VTV', fromStr, toStr)
      if (vtv.length >= 2) {
        vtvReturn = ((vtv[vtv.length - 1].close - vtv[0].close) / vtv[0].close) * 100
      }
    } catch { /* benchmark is best-effort */ }

    // Income the old accounting ignored: accrued dividends on positions and
    // T-bill yield on idle cash. Without these, disciplined cash-holding
    // looks like failure and value stocks' dividends vanish.
    const dividendsEarned = positions.reduce((s, p) => s + (p.dividendsEarned ?? 0), 0)
    const cashYieldAccrued = (config as any)?.cashYieldAccrued ?? 0
    const totalGainLossInclIncome = totalGainLoss + dividendsEarned + cashYieldAccrued
    const totalGainLossInclIncomePct = totalCost > 0 ? (totalGainLossInclIncome / totalCost) * 100 : 0

    // Alpha vs SPY (price-only) and vs the style benchmark (income-inclusive)
    const alpha = spyReturn !== null ? totalGainLossPct - spyReturn : null
    const alphaVsVtv = vtvReturn !== null ? totalGainLossInclIncomePct - vtvReturn : null

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

    // Daily snapshot — write once per calendar day
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const existingSnapshot = await prisma.portfolioSnapshot.findFirst({
      where: { date: { gte: today } },
    }).catch(() => null)

    if (!existingSnapshot && totalValue > 0) {
      await prisma.portfolioSnapshot.create({
        data: {
          totalValue,
          totalCost,
          gainLossPct: totalGainLossPct,
          spyPrice: spyPrices.length > 0 ? spyPrices[spyPrices.length - 1].close : null,
          positions: positionsWithPnl.map(p => ({ ticker: p.ticker, value: p.currentPrice * p.shares, shares: p.shares })),
        },
      }).catch(() => {})
    }

    return Response.json({
      hasData: true,
      topWatchlist: topWatchlistSummary,
      lastRunResult,
      lastRunAt: config?.lastRunAt ?? null,
      summary: {
        totalCost: Math.round(totalCost * 100) / 100,
        totalValue: Math.round(totalValue * 100) / 100,
        totalGainLoss: Math.round(totalGainLoss * 100) / 100,
        totalGainLossPct: Math.round(totalGainLossPct * 100) / 100,
        realisedGainLoss: Math.round(realisedGainLoss * 100) / 100,
        dividendsEarned: Math.round(dividendsEarned * 100) / 100,
        cashYieldAccrued: Math.round(cashYieldAccrued * 100) / 100,
        totalGainLossInclIncomePct: Math.round(totalGainLossInclIncomePct * 100) / 100,
        openPositions: open.length,
        closedPositions: closed.length,
        spyReturn: spyReturn !== null ? Math.round(spyReturn * 100) / 100 : null,
        vtvReturn: vtvReturn !== null ? Math.round(vtvReturn * 100) / 100 : null,
        alpha: alpha !== null ? Math.round(alpha * 100) / 100 : null,
        alphaVsVtv: alphaVsVtv !== null ? Math.round(alphaVsVtv * 100) / 100 : null,
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

    // Benchmark prices for today — SPY (market) and VTV (value style)
    let spyPrice: number | null = null
    let vtvPrice: number | null = null
    try {
      const today = new Date().toISOString().slice(0, 10)
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      const { getHistoricalPrices } = await import('@/lib/fmp/client')
      const [spy, vtv] = await Promise.all([
        getHistoricalPrices('SPY', yesterday, today),
        getHistoricalPrices('VTV', yesterday, today).catch(() => []),
      ])
      spyPrice = spy[spy.length - 1]?.close ?? null
      vtvPrice = vtv[vtv.length - 1]?.close ?? null
    } catch { /* best effort */ }

    const snapshot = await prisma.portfolioSnapshot.create({
      data: {
        totalValue,
        totalCost,
        gainLossPct,
        spyPrice,
        vtvPrice,
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
