import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'

export async function GET() {
  try {
    const alerts = await prisma.alert.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return Response.json(alerts)
  } catch {
    return Response.json([], { status: 200 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { id } = await request.json()
    await prisma.alert.update({ where: { id }, data: { isRead: true } })
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'DB unavailable' }, { status: 503 })
  }
}
