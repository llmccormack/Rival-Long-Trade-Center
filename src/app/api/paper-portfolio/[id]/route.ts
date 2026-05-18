import { prisma } from '@/lib/db/client'
import { getCompleteFundamentals } from '@/lib/fmp/client'

// POST /api/paper-portfolio/[id] — close a paper position
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const reason: string = body.reason ?? 'Manual close'

    const position = await prisma.paperPortfolioItem.findUnique({
      where: { id },
      include: { stock: true },
    })

    if (!position) {
      return Response.json({ error: 'Position not found' }, { status: 404 })
    }
    if (!position.isOpen) {
      return Response.json({ error: 'Position already closed' }, { status: 400 })
    }

    let closePrice = position.currentPrice ?? position.avgCostBasis
    try {
      const fund = await getCompleteFundamentals(position.stock.ticker)
      closePrice = fund.price
    } catch {
      // Use stored price if live fetch fails
    }

    const costBasis = position.avgCostBasis * position.shares
    const closeValue = closePrice * position.shares
    const gainLoss = closeValue - costBasis
    const gainLossPct = (gainLoss / costBasis) * 100

    const closed = await prisma.paperPortfolioItem.update({
      where: { id },
      data: {
        isOpen: false,
        closedAt: new Date(),
        closePrice,
        closeReason: reason,
        currentPrice: closePrice,
      },
    })

    return Response.json({
      id: closed.id,
      ticker: position.stock.ticker,
      shares: position.shares,
      avgCostBasis: position.avgCostBasis,
      closePrice,
      gainLoss,
      gainLossPct,
      reason,
      closedAt: closed.closedAt,
    })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// GET /api/paper-portfolio/[id] — get a single position including closed history
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const position = await prisma.paperPortfolioItem.findUnique({
      where: { id },
      include: { stock: true },
    })

    if (!position) {
      return Response.json({ error: 'Position not found' }, { status: 404 })
    }

    return Response.json(position)
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
