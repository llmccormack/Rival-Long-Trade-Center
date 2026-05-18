import { NextRequest } from 'next/server'
import { getCompleteFundamentals } from '@/lib/fmp/client'
import { applyGrahamCriteria } from '@/lib/graham/screener'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import { prisma } from '@/lib/db/client'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params

  try {
    const fundamentals = await getCompleteFundamentals(ticker.toUpperCase())
    const criteria = applyGrahamCriteria(fundamentals)
    const intrinsicValue = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding)

    // Persist intrinsic value calculation
    const stock = await prisma.stock.findUnique({ where: { ticker: ticker.toUpperCase() } })
    if (stock) {
      await prisma.intrinsicValue.create({
        data: {
          stockId: stock.id,
          currentPrice: fundamentals.price,
          grahamNumber: intrinsicValue.grahamNumber,
          dcfValue: intrinsicValue.dcfValue,
          intrinsicValue: intrinsicValue.intrinsicValue,
          marginOfSafety: intrinsicValue.marginOfSafety,
          isBuySignal: intrinsicValue.isBuySignal,
          ownerEarnings: intrinsicValue.ownerEarnings,
          growthRateUsed: intrinsicValue.growthRateUsed,
          discountRateUsed: intrinsicValue.discountRateUsed,
          terminalGrowth: intrinsicValue.terminalGrowth,
        },
      })

      // Persist screen result
      await prisma.screenResult.create({
        data: {
          stockId: stock.id,
          ...criteria,
        },
      })
    }

    return Response.json({ ticker: ticker.toUpperCase(), fundamentals, criteria, intrinsicValue })
  } catch (err: any) {
    return Response.json(
      { error: 'Analysis failed', message: err.message },
      { status: 500 }
    )
  }
}
