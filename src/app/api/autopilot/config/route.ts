import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'
import { isMutationAuthorized } from '@/lib/auth/api'
import { z } from 'zod'

const ConfigSchema = z.object({
  isEnabled: z.boolean().optional(),
  mode: z.enum(['paper', 'live']).optional(),
  minPhilosophyScore: z.number().min(0).max(100).optional(),
  minMarginOfSafety: z.number().min(0).max(100).optional(),
  maxPositionPct: z.number().min(1).max(50).optional(),
  totalCapital: z.number().min(100).optional(),
  maxPositions: z.number().min(1).max(100).optional(),
  discountRate: z.number().min(1).max(30).optional(),
  minCashReservePct: z.number().min(0).max(80).optional(),
  maxSectorPct: z.number().min(5).max(100).optional(),
  autoDiscovery: z.boolean().optional(),
  dailyAnalysisLimit: z.number().min(5).max(100).optional(),
  schwabAccountId: z.string().optional(),
}).strict()

export async function GET() {
  try {
    const config = await prisma.autopilotConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    })
    return Response.json(config)
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  if (!isMutationAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const raw = await request.json()
    const parsed = ConfigSchema.safeParse(raw)
    if (!parsed.success) {
      return Response.json({ error: 'Invalid request body', details: parsed.error.issues }, { status: 400 })
    }
    const body = parsed.data
    const config = await prisma.autopilotConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...body },
      update: body,
    })
    try {
      await prisma.auditLog.create({ data: { action: 'config_change', actor: 'ui', details: body as any } })
    } catch { /* audit failures must not crash main flow */ }
    return Response.json(config)
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
