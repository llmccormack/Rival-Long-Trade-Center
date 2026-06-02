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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 500)
  const offset = parseInt(searchParams.get('offset') ?? '0')
  const search = searchParams.get('search') ?? ''

  try {
    // Build where clause
    const where: any = { isActive: true }
    if (search) {
      where.stock = {
        OR: [
          { ticker: { contains: search.toUpperCase() } },
          { name: { contains: search, mode: 'insensitive' } },
        ]
      }
    }

    const [items, total] = await Promise.all([
      prisma.watchlistItem.findMany({
        where,
        include: {
          stock: {
            include: {
              intrinsicValues: { orderBy: { calculatedAt: 'desc' }, take: 1 },
            },
          },
        },
        orderBy: [
          { lastScore: { sort: 'desc', nulls: 'last' } },
          { lastMos: { sort: 'desc', nulls: 'last' } },
          { addedAt: 'desc' },
        ],
        take: limit,
        skip: offset,
      }),
      prisma.watchlistItem.count({ where }),
    ])

    const enriched = items.map((item) => {
      const iv = item.stock.intrinsicValues?.[0]
      return {
        id: item.id,
        ticker: item.stock.ticker,
        name: item.stock.name,
        sector: item.stock.sector,
        currentPrice: iv?.currentPrice ?? 0,
        targetPrice: item.targetPrice,
        intrinsicValue: iv?.intrinsicValue ?? undefined,
        marginOfSafety: iv?.marginOfSafety ?? undefined,
        isBuySignal: iv?.isBuySignal ?? false,
        addedAt: item.addedAt,
        notes: item.notes,
        // Last autopilot analysis results
        lastScore: item.lastScore ?? undefined,
        lastMos: item.lastMos ?? undefined,
        lastAction: item.lastAction ?? undefined,
        lastSkipReason: item.lastSkipReason ?? undefined,
        lastAnalyzedAt: item.lastAnalyzedAt ?? undefined,
      }
    })

    return Response.json({ items: enriched, total, limit, offset })
  } catch {
    return Response.json({ items: [], total: 0, limit, offset }, { status: 200 })
  }
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
