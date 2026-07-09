import { prisma } from '@/lib/db/client'

// ─── Dead-man's switch ─────────────────────────────────────────────────────────
// If the Railway cron silently dies, nothing else in the system would ever
// notice — the user discovers it weeks later ("it hasn't done anything").
// /api/health is pinged by the UI KeepAlive (every 10 min while a tab is open)
// and can be pinged by a free uptime monitor (e.g. UptimeRobot → this URL).
// When the autopilot hasn't run in >2 weekdays, push an ntfy alert, deduped
// to once per 24h via lastStallAlertAt.

function weekdaysBetween(from: Date, to: Date): number {
  let count = 0
  const d = new Date(from)
  while (d < to) {
    d.setDate(d.getDate() + 1)
    const day = d.getDay()
    if (day !== 0 && day !== 6) count++
  }
  return count
}

async function checkAutopilotStalled(): Promise<{ stalled: boolean; lastRunAt: Date | null }> {
  try {
    const config = await prisma.autopilotConfig.findUnique({ where: { id: 'singleton' } })
    if (!config?.lastRunAt) return { stalled: false, lastRunAt: null }
    if (!config.isEnabled) return { stalled: false, lastRunAt: config.lastRunAt }  // disabled on purpose ≠ stalled

    const stalled = weekdaysBetween(config.lastRunAt, new Date()) > 2
    if (!stalled) return { stalled: false, lastRunAt: config.lastRunAt }

    const lastAlert = config.lastStallAlertAt?.getTime() ?? 0
    if (Date.now() - lastAlert > 24 * 60 * 60 * 1000) {
      const topic = process.env.NTFY_TOPIC
      if (topic) {
        await fetch(`https://ntfy.sh/${topic}`, {
          method: 'POST',
          headers: { Title: 'Graham Capital: autopilot STALLED', Priority: 'high', Tags: 'rotating_light' },
          body: `No autopilot run since ${config.lastRunAt.toISOString().slice(0, 10)} (>2 weekdays). Check the Railway cron job.`,
        }).catch(() => {})
      }
      await prisma.autopilotConfig.update({
        where: { id: 'singleton' },
        data: { lastStallAlertAt: new Date() },
      }).catch(() => {})
    }
    return { stalled: true, lastRunAt: config.lastRunAt }
  } catch {
    return { stalled: false, lastRunAt: null }
  }
}

export async function GET() {
  let db = false
  try {
    await prisma.$queryRaw`SELECT 1`
    db = true
  } catch {}

  const autopilot = db ? await checkAutopilotStalled() : { stalled: false, lastRunAt: null }

  return Response.json({
    status: db ? (autopilot.stalled ? 'stalled' : 'ok') : 'degraded',
    db,
    autopilotStalled: autopilot.stalled,
    lastAutopilotRun: autopilot.lastRunAt,
    fmp: !!process.env.FMP_API_KEY,
    claude: !!process.env.ANTHROPIC_API_KEY,
    ntfy: !!process.env.NTFY_TOPIC,
    schwab: !!(process.env.SCHWAB_CLIENT_ID && process.env.SCHWAB_CLIENT_SECRET),
    auth: !!process.env.APP_PASSWORD,
    ts: new Date().toISOString(),
  }, { status: db ? 200 : 503 })
}
