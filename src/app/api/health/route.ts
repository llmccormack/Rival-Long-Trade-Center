import { prisma } from '@/lib/db/client'

export async function GET() {
  let db = false
  try {
    await prisma.$queryRaw`SELECT 1`
    db = true
  } catch {}

  return Response.json({
    status: db ? 'ok' : 'degraded',
    db,
    fmp: !!process.env.FMP_API_KEY,
    claude: !!process.env.ANTHROPIC_API_KEY,
    ntfy: !!process.env.NTFY_TOPIC,
    schwab: !!(process.env.SCHWAB_CLIENT_ID && process.env.SCHWAB_CLIENT_SECRET),
    ts: new Date().toISOString(),
  }, { status: db ? 200 : 503 })
}
