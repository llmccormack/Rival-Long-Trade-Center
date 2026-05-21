import { isMutationAuthorized } from '@/lib/auth/api'
import { prisma } from '@/lib/db/client'
import { executeAutomatedBuy } from '@/lib/portfolio/manager'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const OrderSchema = z.object({
  ticker: z.string().min(1).max(10).transform(v => v.toUpperCase()),
  accountId: z.string().min(1),
  confirmed: z.literal(true),
  idempotencyKey: z.string().min(1),
})

const recentKeys = new Map<string, number>() // key → timestamp

function isDuplicate(key: string): boolean {
  const now = Date.now()
  // Purge old keys
  for (const [k, t] of recentKeys) {
    if (now - t > 5 * 60 * 1000) recentKeys.delete(k)
  }
  if (recentKeys.has(key)) return true
  recentKeys.set(key, now)
  return false
}

export async function POST(request: NextRequest) {
  if (!isMutationAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const raw = await request.json()
  const parsed = OrderSchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request body', details: parsed.error.issues }, { status: 400 })
  }
  const { ticker, accountId, idempotencyKey } = parsed.data

  if (isDuplicate(idempotencyKey)) {
    return Response.json({ error: 'Duplicate order' }, { status: 409 })
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
