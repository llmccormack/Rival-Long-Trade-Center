import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getCompleteFundamentals } from '@/lib/fmp/client'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import { isMutationAuthorized } from '@/lib/auth/api'
import { z } from 'zod'

const WatchlistPostSchema = z.object({
  ticker: z.string().min(1).max(10).transform(v => v.toUpperCase()),
  targetPrice: z.number().positive().optional(),
  notes: z.string().max(500).optional(),
})

export async function GET() {
  let items: any[]
  try {
    items = await prisma.watchlistItem.findMany({
      where: { isActive: true },
      include: { stock: true },
      orderBy: { addedAt: 'desc' },
    })
  } catch {
    return Response.json([], { status: 200 })
  }

  const enriched = await Promise.all(
    items.map(async (item) => {
      try {
        const fund = await getCompleteFundamentals(item.stock.ticker)
        const iv = calculateIntrinsicValue(fund, fund.sharesOutstanding)
        return {
          id: item.id,
          ticker: item.stock.ticker,
          name: item.stock.name,
          currentPrice: fund.price,
          targetPrice: item.targetPrice,
          intrinsicValue: iv.intrinsicValue,
          marginOfSafety: iv.marginOfSafety,
          isBuySignal: iv.isBuySignal,
          addedAt: item.addedAt,
          notes: item.notes,
          expectedCagr10yr: iv.expectedCagr10yr,
          businessTier: fund.businessTier,
        }
      } catch {
        return {
          id: item.id,
          ticker: item.stock.ticker,
          name: item.stock.name,
          currentPrice: 0,
          targetPrice: item.targetPrice,
          intrinsicValue: undefined,
          marginOfSafety: undefined,
          isBuySignal: false,
          addedAt: item.addedAt,
          notes: item.notes,
        }
      }
    })
  )

  return Response.json(enriched)
}

export async function POST(request: NextRequest) {
  if (!isMutationAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const raw = await request.json()
  const parsed = WatchlistPostSchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request body', details: parsed.error.issues }, { status: 400 })
  }
  const { ticker, notes } = parsed.data

  try {
    const fund = await getCompleteFundamentals(ticker)
    const iv = calculateIntrinsicValue(fund, fund.sharesOutstanding)

    const stock = await prisma.stock.upsert({
      where: { ticker },
      create: {
        ticker,
        name: fund.name,
        sector: fund.sector,
        industry: fund.industry,
        exchange: fund.exchange,
      },
      update: { name: fund.name },
    })

    const item = await prisma.watchlistItem.upsert({
      where: { stockId: stock.id },
      create: {
        stockId: stock.id,
        targetPrice: iv.intrinsicValue * 0.7, // 30% below intrinsic value
        notes,
        isActive: true,
      },
      update: { isActive: true, notes },
    })

    return Response.json({ id: item.id, ticker, targetPrice: item.targetPrice })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  if (!isMutationAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await request.json()
    await prisma.watchlistItem.update({ where: { id }, data: { isActive: false } })
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'DB unavailable' }, { status: 503 })
  }
}
