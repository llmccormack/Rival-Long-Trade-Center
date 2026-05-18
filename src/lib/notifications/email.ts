// Resend email notifications — free tier: 3,000/month
// Sends alerts for: paper buys, paper sells, full-run summaries, news vetoes
// Requires RESEND_API_KEY + NOTIFY_EMAIL env vars

import { Resend } from 'resend'

function getResend() {
  if (!process.env.RESEND_API_KEY) return null
  return new Resend(process.env.RESEND_API_KEY)
}

const FROM = 'Rival Automations <notifications@rival-automations.com>'

function getTo(): string | null {
  return process.env.NOTIFY_EMAIL ?? null
}

export interface TradeNotification {
  type: 'buy' | 'sell'
  ticker: string
  shares: number
  price: number
  score?: number
  mos?: number
  conviction?: string
  reason?: string
}

export interface RunSummaryNotification {
  buys: number
  sells: number
  vetoed: number
  skipped: number
  newWatchlist: string[]
  results: Array<{ ticker: string; action: string; reason?: string; score?: number; mos?: number }>
  mode: string
}

export interface VetoNotification {
  ticker: string
  reason: string
  isHeld: boolean  // true = we hold it and should sell
}

function html(body: string) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, sans-serif; background: #09090b; color: #e4e4e7; margin: 0; padding: 0; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 32px 24px; }
  .brand { font-size: 11px; font-weight: 700; letter-spacing: 0.15em; color: #7c3aed; text-transform: uppercase; margin-bottom: 24px; }
  h1 { font-size: 20px; font-weight: 700; color: #f4f4f5; margin: 0 0 8px; }
  .sub { font-size: 13px; color: #71717a; margin-bottom: 24px; }
  .card { background: #18181b; border: 1px solid #27272a; border-radius: 10px; padding: 16px 20px; margin-bottom: 12px; }
  .metric { display: flex; justify-content: space-between; margin-bottom: 8px; }
  .metric .label { font-size: 11px; color: #52525b; text-transform: uppercase; letter-spacing: 0.08em; }
  .metric .value { font-size: 13px; font-weight: 600; font-family: monospace; color: #e4e4e7; }
  .badge { display: inline-block; border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: 700; }
  .buy { background: #052e16; color: #4ade80; border: 1px solid #14532d; }
  .sell { background: #450a0a; color: #f87171; border: 1px solid #7f1d1d; }
  .veto { background: #450a0a; color: #f87171; border: 1px solid #7f1d1d; }
  .skip { background: #1c1917; color: #78716c; border: 1px solid #292524; }
  .footer { font-size: 11px; color: #3f3f46; margin-top: 32px; }
  a { color: #7c3aed; }
</style></head>
<body><div class="wrap">
  <div class="brand">⚡ Rival Automations</div>
  ${body}
  <div class="footer">Systematic Value Intelligence · Paper Trading Mode · <a href="#">View Portfolio</a></div>
</div></body>
</html>`
}

export async function sendTradeNotification(trade: TradeNotification): Promise<void> {
  const resend = getResend()
  const to = getTo()
  if (!resend || !to) return

  const isBuy = trade.type === 'buy'
  const subject = isBuy
    ? `📈 Paper Buy: ${trade.shares} × ${trade.ticker} @ $${trade.price.toFixed(2)}`
    : `📉 Paper Sell: ${trade.ticker} @ $${trade.price.toFixed(2)}`

  const body = `
    <h1>${isBuy ? 'Paper Buy Executed' : 'Position Closed'}</h1>
    <div class="sub">${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}</div>
    <div class="card">
      <div class="metric"><span class="label">Ticker</span><span class="value" style="font-size:18px;color:#f4f4f5">${trade.ticker}</span></div>
      <div class="metric"><span class="label">Action</span><span class="badge ${isBuy ? 'buy' : 'sell'}">${isBuy ? 'PAPER BUY' : 'PAPER SELL'}</span></div>
      <div class="metric"><span class="label">Shares</span><span class="value">${trade.shares}</span></div>
      <div class="metric"><span class="label">Price</span><span class="value">$${trade.price.toFixed(2)}</span></div>
      ${trade.score != null ? `<div class="metric"><span class="label">Philosophy Score</span><span class="value" style="color:#a78bfa">${trade.score}/100</span></div>` : ''}
      ${trade.mos != null ? `<div class="metric"><span class="label">Margin of Safety</span><span class="value" style="color:#4ade80">${trade.mos.toFixed(1)}%</span></div>` : ''}
      ${trade.conviction ? `<div class="metric"><span class="label">Conviction</span><span class="value">${trade.conviction}</span></div>` : ''}
      ${trade.reason ? `<div class="metric"><span class="label">Reason</span><span class="value" style="color:#a1a1aa;font-size:12px">${trade.reason}</span></div>` : ''}
    </div>
  `

  try {
    await resend.emails.send({ from: FROM, to, subject, html: html(body) })
  } catch { /* notifications are best-effort */ }
}

export async function sendRunSummary(summary: RunSummaryNotification): Promise<void> {
  const resend = getResend()
  const to = getTo()
  if (!resend || !to) return

  if (summary.buys === 0 && summary.sells === 0 && summary.newWatchlist.length === 0) return

  const subject = `🤖 Autopilot Run: ${summary.buys} buys · ${summary.sells} sells · ${summary.newWatchlist.length} added to watchlist`

  const tradeRows = summary.results
    .filter(r => r.action.includes('BUY') || r.action.includes('SELL'))
    .map(r => `
      <div class="card" style="padding:12px 16px">
        <div class="metric">
          <span class="value" style="font-size:15px">${r.ticker}</span>
          <span class="badge ${r.action.includes('BUY') ? 'buy' : r.action.includes('SELL') ? 'sell' : r.action === 'VETOED' ? 'veto' : 'skip'}">${r.action}</span>
        </div>
        ${r.score != null ? `<div class="metric"><span class="label">Score</span><span class="value" style="color:#a78bfa">${r.score}/100</span></div>` : ''}
        ${r.mos != null ? `<div class="metric"><span class="label">MOS</span><span class="value" style="color:#4ade80">${r.mos.toFixed(1)}%</span></div>` : ''}
        ${r.reason ? `<div style="font-size:11px;color:#52525b;margin-top:4px">${r.reason}</div>` : ''}
      </div>
    `).join('')

  const body = `
    <h1>Full Autopilot Run Complete</h1>
    <div class="sub">${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })} · ${summary.mode} mode</div>
    <div class="card">
      <div class="metric"><span class="label">Buys</span><span class="value" style="color:#4ade80">${summary.buys}</span></div>
      <div class="metric"><span class="label">Sells</span><span class="value" style="color:#f87171">${summary.sells}</span></div>
      <div class="metric"><span class="label">Vetoed</span><span class="value" style="color:#ef4444">${summary.vetoed}</span></div>
      <div class="metric"><span class="label">Skipped</span><span class="value" style="color:#71717a">${summary.skipped}</span></div>
      ${summary.newWatchlist.length > 0 ? `<div class="metric"><span class="label">Added to Watchlist</span><span class="value" style="color:#a78bfa">${summary.newWatchlist.join(', ')}</span></div>` : ''}
    </div>
    ${tradeRows}
  `

  try {
    await resend.emails.send({ from: FROM, to, subject, html: html(body) })
  } catch { /* best-effort */ }
}

export async function sendVetoAlert(veto: VetoNotification): Promise<void> {
  const resend = getResend()
  const to = getTo()
  if (!resend || !to) return

  const subject = veto.isHeld
    ? `🚨 URGENT: ${veto.ticker} position flagged — ${veto.reason.slice(0, 60)}`
    : `⚠️ ${veto.ticker} watchlist veto — ${veto.reason.slice(0, 60)}`

  const body = `
    <h1 style="color:${veto.isHeld ? '#ef4444' : '#f59e0b'}">${veto.isHeld ? '🚨 Position Veto Alert' : '⚠️ Watchlist Veto'}</h1>
    <div class="sub">${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}</div>
    <div class="card" style="border-color:${veto.isHeld ? '#7f1d1d' : '#78350f'}">
      <div class="metric"><span class="label">Ticker</span><span class="value" style="font-size:18px">${veto.ticker}</span></div>
      <div class="metric"><span class="label">Status</span><span class="badge veto">${veto.isHeld ? 'POSITION SOLD' : 'BLOCKED'}</span></div>
      <div style="margin-top:12px;font-size:13px;color:#a1a1aa">${veto.reason}</div>
    </div>
    ${veto.isHeld ? '<p style="font-size:13px;color:#f87171">This position has been automatically closed to protect capital.</p>' : ''}
  `

  try {
    await resend.emails.send({ from: FROM, to, subject, html: html(body) })
  } catch { /* best-effort */ }
}
