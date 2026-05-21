import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'
import { isMutationAuthorized } from '@/lib/auth/api'

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
    const body = await request.json()
    const config = await prisma.autopilotConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...body },
      update: body,
    })
    return Response.json(config)
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
