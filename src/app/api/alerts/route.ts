import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'

export async function GET() {
  const alerts = await prisma.alert.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return Response.json(alerts)
}

export async function PATCH(request: NextRequest) {
  const { id } = await request.json()
  await prisma.alert.update({ where: { id }, data: { isRead: true } })
  return Response.json({ success: true })
}
