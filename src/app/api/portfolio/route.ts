import { NextRequest } from 'next/server'
import { getPortfolioSummary, runQuarterlyRebalance } from '@/lib/portfolio/manager'

export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get('accountId') ?? 'default'

  try {
    const summary = await getPortfolioSummary(accountId)
    return Response.json(summary)
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { action, accountId } = await request.json()

  if (action === 'rebalance') {
    try {
      const result = await runQuarterlyRebalance(accountId ?? 'default')
      return Response.json(result)
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 500 })
    }
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
