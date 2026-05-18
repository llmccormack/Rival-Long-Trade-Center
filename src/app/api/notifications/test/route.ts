import { sendTradeNotification } from '@/lib/notifications/email'
import { pushTestNotification } from '@/lib/notifications/push'

export async function POST() {
  const results: Record<string, unknown> = {}

  // Test ntfy push
  if (process.env.NTFY_TOPIC) {
    results.push = await pushTestNotification()
  }

  // Test email via Resend
  if (process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL) {
    try {
      await sendTradeNotification({
        type: 'buy',
        ticker: 'TEST',
        shares: 100,
        price: 42.50,
        score: 72,
        mos: 34.5,
        conviction: 'BUY',
      })
      results.email = { ok: true, sentTo: process.env.NOTIFY_EMAIL }
    } catch (err: any) {
      results.email = { ok: false, error: err.message }
    }
  }

  if (Object.keys(results).length === 0) {
    return Response.json({
      ok: false,
      error: 'No notification channels configured. Add NTFY_TOPIC and/or RESEND_API_KEY + NOTIFY_EMAIL to Railway.',
    })
  }

  return Response.json({ ok: true, results })
}
