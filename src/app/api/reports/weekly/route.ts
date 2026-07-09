// ─── Weekly Investor Letter ───────────────────────────────────────────────────
//
// Sunday cron: POST /api/reports/weekly (Authorization: Bearer $CRON_SECRET)
// Generates a short investor letter in the spirit of a Berkshire shareholder
// letter — performance with honest income-inclusive accounting, what was
// bought/sold/skipped and WHY (from recorded data), thesis health, and one
// thing being watched. Stored in WeeklyLetter, emailed via Resend, pushed via
// ntfy, and readable in the chat (get_journal tool).

import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db/client'
import { isAuthorized } from '@/lib/auth/cron'
import { sendWeeklyLetter } from '@/lib/notifications/email'
import { getMarketContext } from '@/lib/macro/market-context'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function GET() {
  try {
    const letter = await prisma.weeklyLetter.findFirst({ orderBy: { generatedAt: 'desc' } })
    return Response.json(letter ?? { message: 'No letter generated yet' })
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [config, openPositions, closedThisWeek, boughtThisWeek, postMortems, snapshots, macro, shadowResolved] =
    await Promise.all([
      prisma.autopilotConfig.findUnique({ where: { id: 'singleton' } }),
      prisma.paperPortfolioItem.findMany({ where: { isOpen: true }, include: { stock: true } }),
      prisma.paperPortfolioItem.findMany({ where: { isOpen: false, closedAt: { gte: weekAgo } }, include: { stock: true } }),
      prisma.paperPortfolioItem.findMany({ where: { firstPurchased: { gte: weekAgo } }, include: { stock: true } }),
      prisma.tradePostMortem.findMany({ where: { createdAt: { gte: weekAgo } } }),
      prisma.portfolioSnapshot.findMany({ orderBy: { date: 'desc' }, take: 8 }),
      getMarketContext().catch(() => null),
      prisma.shadowDecision.findMany({ where: { return90d: { not: null } }, orderBy: { decidedAt: 'desc' }, take: 50 }),
    ])

  const totalCost = openPositions.reduce((s, p) => s + p.shares * p.avgCostBasis, 0)
  const totalValue = openPositions.reduce((s, p) => s + p.shares * (p.currentPrice ?? p.avgCostBasis), 0)
  const dividends = openPositions.reduce((s, p) => s + (p.dividendsEarned ?? 0), 0)
  const cashYield = (config as { cashYieldAccrued?: number } | null)?.cashYieldAccrued ?? 0
  const lastRun = config?.lastRunResult as Record<string, unknown> | null
  const shadowAvg = shadowResolved.length > 0
    ? shadowResolved.reduce((s, r) => s + (r.return90d ?? 0), 0) / shadowResolved.length
    : null

  const context = `PORTFOLIO (paper, $${config?.totalCapital ?? 10000} capital):
- ${openPositions.length} open positions | value $${totalValue.toFixed(0)} vs cost $${totalCost.toFixed(0)} (${totalCost > 0 ? (((totalValue - totalCost) / totalCost) * 100).toFixed(1) : 0}%)
- Dividends accrued: $${dividends.toFixed(2)} | T-bill yield on idle cash: $${cashYield.toFixed(2)}
- Holdings: ${openPositions.map(p => `${p.stock.ticker} (${(p as { entryMode?: string }).entryMode ?? 'value'}, ${p.currentPrice && p.avgCostBasis ? (((p.currentPrice - p.avgCostBasis) / p.avgCostBasis) * 100).toFixed(1) : '?'}%)`).join(', ') || 'none'}

THIS WEEK:
- Bought: ${boughtThisWeek.map(p => `${p.stock.ticker} @ $${p.avgCostBasis.toFixed(2)} (score ${p.philosophyScore})`).join(', ') || 'nothing'}
- Sold: ${closedThisWeek.map(p => `${p.stock.ticker} @ $${p.closePrice?.toFixed(2)} — ${p.closeReason?.slice(0, 60)}`).join('; ') || 'nothing'}
- Post-mortem verdicts: ${postMortems.map(m => `${m.ticker}: ${m.verdict} (${m.returnPct}%)`).join(', ') || 'none'}

MARKET: CAPE ${macro?.sp500Cape?.toFixed(1) ?? '?'} (${macro?.marketTemperature ?? '?'}), 10Y ${macro ? (macro.treasury10yr * 100).toFixed(2) : '?'}%
LAST RUN BLOCKERS: ${JSON.stringify(lastRun?.topBlockers ?? 'n/a')}
SHADOW BOOK: ${shadowResolved.length} resolved skips/vetoes, avg 90-day forward return ${shadowAvg !== null ? (shadowAvg * 100).toFixed(1) + '%' : 'n/a'}
RECENT SNAPSHOTS: ${snapshots.slice(0, 4).map(s => `${s.date.toISOString().slice(0, 10)}: $${s.totalValue.toFixed(0)}`).join(' | ')}`

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: `Write this week's investor letter for Graham Capital, a systematic Graham/Buffett value autopilot (paper trading). Audience: the owner. Voice: a disciplined value investor writing to partners — plain, candid, numbers over adjectives, zero hype. Think Buffett partnership letters, 250-400 words.

Cover, in flowing prose (a few short paragraphs, no headers or bullets):
1. Performance this week with the honest accounting (including dividends and cash yield — say if discipline, not stock picking, drove the result).
2. What was bought/sold and the recorded reasons; if nothing, what the top blockers were and whether patience is discipline or a data problem this week.
3. One insight from the post-mortems or shadow book if any exist.
4. One thing to watch next week.
Never invent data — only use what is below. If a section has no data, say so plainly in one clause and move on.

${context}`,
      }],
    })

    const content = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
    if (!content) return Response.json({ error: 'Empty letter generated' }, { status: 500 })

    const letter = await prisma.weeklyLetter.create({ data: { content } })

    await Promise.all([
      sendWeeklyLetter(content).catch(() => {}),
      process.env.NTFY_TOPIC
        ? fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
            method: 'POST',
            headers: { Title: 'Weekly Investor Letter', Tags: 'scroll' },
            body: content.slice(0, 500) + (content.length > 500 ? '…' : ''),
          }).catch(() => {})
        : Promise.resolve(),
    ])

    return Response.json({ ok: true, id: letter.id, content })
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Letter generation failed' }, { status: 500 })
  }
}
