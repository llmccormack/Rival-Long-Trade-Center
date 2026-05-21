import { isMutationAuthorized } from '@/lib/auth/api'
import { prisma } from '@/lib/db/client'
import { executeAutomatedBuy } from '@/lib/portfolio/manager'
import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  if (!isMutationAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { ticker, accountId, confirmed } = await request.json()

  if (!ticker || !accountId) {
    return Response.json({ error: 'Missing ticker or accountId' }, { status: 400 })
  }

  if (!confirmed) {
    return Response.json({ error: 'Explicit confirmation required: pass confirmed: true' }, { status: 400 })
  }

  // Server-side gate: live trading must be explicitly enabled in DB config
  const config = await prisma.autopilotConfig.findUnique({ where: { id: 'singleton' } })
  if (!config || config.mode !== 'live') {
    return Response.json({ error: 'Live trading is not enabled. Set mode to live in autopilot config.' }, { status: 403 })
  }

  try {
    const result = await executeAutomatedBuy(ticker, accountId)
    if (!result.success) {
      return Response.json({ error: result.reason }, { status: 400 })
    }
    return Response.json(result)
  } catch (err: any) {
    return Response.json({ error: 'Order failed', message: err.message }, { status: 500 })
  }
}
