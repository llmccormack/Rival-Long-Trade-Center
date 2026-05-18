import { prisma } from '@/lib/db/client'
import { getCompleteFundamentals } from '@/lib/fmp/client'

export async function GET() {
  try {
    const positions = await prisma.paperPortfolioItem.findMany({
      where: { isOpen: true },
      include: { stock: true },
      orderBy: { firstPurchased: 'desc' },
    })

    const enriched = await Promise.all(
      positions.map(async (p) => {
        let currentPrice = p.currentPrice ?? p.avgCostBasis
        try {
          const fund = await getCompleteFundamentals(p.stock.ticker)
          currentPrice = fund.price
          await prisma.paperPortfolioItem.update({
            where: { id: p.id },
            data: { currentPrice: fund.price },
          })
        } catch {
          // Use stored price if live fetch fails
        }

        const costBasis = p.avgCostBasis * p.shares
        const currentValue = currentPrice * p.shares
        return {
          id: p.id,
          ticker: p.stock.ticker,
          name: p.stock.name,
          shares: p.shares,
          avgCostBasis: p.avgCostBasis,
          currentPrice,
          currentValue,
          costBasis,
          gainLoss: currentValue - costBasis,
          gainLossPct: ((currentValue - costBasis) / costBasis) * 100,
          philosophyScore: p.philosophyScore,
          conviction: p.conviction,
          mosAtPurchase: p.mosAtPurchase,
          auditTrail: p.auditTrail,
          firstPurchased: p.firstPurchased,
        }
      })
    )

    const totalValue = enriched.reduce((s, p) => s + p.currentValue, 0)
    const totalCost = enriched.reduce((s, p) => s + p.costBasis, 0)

    return Response.json({
      positions: enriched,
      totalValue,
      totalCost,
      totalGainLoss: totalValue - totalCost,
      totalGainLossPct: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
    })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
