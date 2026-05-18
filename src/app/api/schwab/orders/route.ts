import { NextRequest } from 'next/server'
import { executeAutomatedBuy } from '@/lib/portfolio/manager'

export async function POST(request: NextRequest) {
  const { ticker, accountId } = await request.json()

  if (!ticker || !accountId) {
    return Response.json({ error: 'Missing ticker or accountId' }, { status: 400 })
  }

  try {
    const result = await executeAutomatedBuy(ticker, accountId)
    if (!result.success) {
      return Response.json({ error: result.reason }, { status: 400 })
    }
    return Response.json(result)
  } catch (err: any) {
    return Response.json(
      { error: 'Order failed', message: err.message },
      { status: 500 }
    )
  }
}
