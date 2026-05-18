// ntfy.sh push notifications — completely free, no API key needed
// Subscribe to your topic in the ntfy app (iOS/Android/Web)
// Env vars:
//   NTFY_TOPIC   — e.g. "rival-abc123" (make it hard to guess)
//   NTFY_SERVER  — optional, defaults to https://ntfy.sh
//   NTFY_TOKEN   — optional, for private/auth-protected topics

function getNtfyUrl(): string | null {
  const topic = process.env.NTFY_TOPIC
  if (!topic) return null
  const server = process.env.NTFY_SERVER ?? 'https://ntfy.sh'
  return `${server.replace(/\/$/, '')}/${topic}`
}

interface NtfyPayload {
  title: string
  message: string
  priority?: 1 | 2 | 3 | 4 | 5  // 1=min, 3=default, 5=urgent
  tags?: string[]                  // emoji shortcodes e.g. ['chart_with_upwards_trend']
  click?: string                   // URL to open on click
}

async function notify(payload: NtfyPayload): Promise<void> {
  const url = getNtfyUrl()
  if (!url) return

  const headers: Record<string, string> = {
    'Title': payload.title,
    'Priority': String(payload.priority ?? 3),
    'Content-Type': 'text/plain',
  }
  if (payload.tags?.length) headers['Tags'] = payload.tags.join(',')
  if (payload.click) headers['Click'] = payload.click
  if (process.env.NTFY_TOKEN) headers['Authorization'] = `Bearer ${process.env.NTFY_TOKEN}`

  await fetch(url, { method: 'POST', headers, body: payload.message })
}

export async function pushTradeNotification(opts: {
  type: 'buy' | 'sell'
  ticker: string
  shares: number
  price: number
  score?: number
  mos?: number
  conviction?: string
  reason?: string
}): Promise<void> {
  const isBuy = opts.type === 'buy'
  try {
    await notify({
      title: isBuy
        ? `📈 Paper Buy: ${opts.ticker}`
        : `📉 Position Closed: ${opts.ticker}`,
      message: isBuy
        ? `${opts.shares} shares @ $${opts.price.toFixed(2)}\nScore: ${opts.score ?? '—'}/100 · MOS: ${opts.mos?.toFixed(1) ?? '—'}%\nConviction: ${opts.conviction ?? '—'}`
        : `${opts.shares} shares @ $${opts.price.toFixed(2)}\n${opts.reason ?? 'Position closed'}`,
      priority: isBuy ? 3 : 4,
      tags: isBuy ? ['chart_with_upwards_trend'] : ['chart_with_downwards_trend'],
    })
  } catch { /* best-effort */ }
}

export async function pushRunSummary(opts: {
  buys: number
  sells: number
  vetoed: number
  newWatchlist: string[]
  mode: string
}): Promise<void> {
  if (opts.buys === 0 && opts.sells === 0 && opts.newWatchlist.length === 0) return
  try {
    const lines = [
      `Mode: ${opts.mode}`,
      opts.buys > 0 ? `✅ ${opts.buys} buy${opts.buys > 1 ? 's' : ''} executed` : null,
      opts.sells > 0 ? `🔴 ${opts.sells} position${opts.sells > 1 ? 's' : ''} closed` : null,
      opts.vetoed > 0 ? `🚫 ${opts.vetoed} vetoed` : null,
      opts.newWatchlist.length > 0 ? `👀 Added to watchlist: ${opts.newWatchlist.join(', ')}` : null,
    ].filter(Boolean).join('\n')

    await notify({
      title: `🤖 Autopilot: ${opts.buys}B · ${opts.sells}S · ${opts.newWatchlist.length} added`,
      message: lines,
      priority: opts.buys > 0 || opts.sells > 0 ? 4 : 3,
      tags: ['robot'],
    })
  } catch { /* best-effort */ }
}

export async function pushVetoAlert(opts: {
  ticker: string
  reason: string
  isHeld: boolean
}): Promise<void> {
  try {
    await notify({
      title: opts.isHeld
        ? `🚨 URGENT: ${opts.ticker} position sold — veto triggered`
        : `⚠️ ${opts.ticker} blocked by veto`,
      message: opts.reason,
      priority: opts.isHeld ? 5 : 4,
      tags: opts.isHeld ? ['rotating_light'] : ['warning'],
    })
  } catch { /* best-effort */ }
}

export async function pushTestNotification(): Promise<{ ok: boolean; topic?: string; error?: string }> {
  const url = getNtfyUrl()
  if (!url) return { ok: false, error: 'NTFY_TOPIC not configured' }
  try {
    await notify({
      title: '✅ Rival Automations connected',
      message: 'Push notifications are working. You\'ll get alerts for every trade, sell, and daily run summary.',
      priority: 3,
      tags: ['white_check_mark'],
    })
    return { ok: true, topic: process.env.NTFY_TOPIC }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}
