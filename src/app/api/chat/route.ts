import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db/client'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const { messages } = await request.json()
  if (!Array.isArray(messages)) return Response.json({ error: 'messages required' }, { status: 400 })

  // Gather platform context
  const [config, openPositions, topWatchlist, lastSnapshot] = await Promise.all([
    prisma.autopilotConfig.findUnique({ where: { id: 'singleton' } }).catch(() => null),
    prisma.paperPortfolioItem.findMany({
      where: { isOpen: true },
      include: { stock: true },
      orderBy: { firstPurchased: 'desc' },
      take: 20,
    }).catch(() => []),
    prisma.watchlistItem.findMany({
      where: { isActive: true, lastScore: { not: null } },
      include: { stock: { include: { intrinsicValues: { orderBy: { calculatedAt: 'desc' }, take: 1 } } } },
      orderBy: { lastScore: 'desc' },
      take: 15,
    }).catch(() => []),
    prisma.portfolioSnapshot.findFirst({ orderBy: { date: 'desc' } }).catch(() => null),
  ])

  const portfolioSummary = openPositions.map(p => {
    const currentVal = p.shares * (p.currentPrice ?? p.avgCostBasis)
    const cost = p.shares * p.avgCostBasis
    const ret = ((currentVal - cost) / cost * 100).toFixed(1)
    return `${p.stock.ticker}: ${p.shares} shares @ $${p.avgCostBasis.toFixed(2)} avg cost, current ~$${(p.currentPrice ?? p.avgCostBasis).toFixed(2)}, return: ${ret}%`
  }).join('\n')

  const watchlistSummary = topWatchlist.map(w => {
    const iv = w.stock.intrinsicValues?.[0]
    return `${w.stock.ticker}: score ${w.lastScore ?? 'unscored'}/100, MOS ${w.lastMos?.toFixed(1) ?? '?'}%, price $${iv?.currentPrice?.toFixed(2) ?? '?'}, last action: ${w.lastAction ?? 'none'}`
  }).join('\n')

  const systemPrompt = `You are a value investing analyst. You think clearly, write concisely, and give direct answers.

STYLE RULES — follow these strictly:
- Answer the question asked. Don't pad with background theory unless it's directly relevant.
- Never list out investing principles or name-drop philosophers as a way to structure a response. Synthesise the thinking and just give the conclusion.
- No bullet-point dumps. Use bullets only when comparing 3+ distinct items — otherwise prose.
- No caveats, disclaimers, or "it depends" hedges unless the ambiguity is genuinely important.
- Keep responses short. If the answer is one paragraph, write one paragraph.
- Numbers and specifics beat adjectives. "$42 intrinsic value vs $38 price = 10% MOS" beats "fairly valued with limited upside".

YOUR KNOWLEDGE: Graham/Buffett value methodology — margin of safety, earnings stability, owner earnings, moats, PE/PB/current ratio discipline, FCF quality, accruals. Apply this knowledge silently — don't announce which framework you're using.

PLATFORM CONTEXT:
Mode: ${config?.mode ?? 'paper'} trading | Capital: $${config?.totalCapital ?? 10000}
Buy thresholds: score ≥ ${config?.minPhilosophyScore ?? 45}/100, MOS ≥ ${config?.minMarginOfSafety ?? 15}%
Last autopilot run: ${config?.lastRunAt ? new Date(config.lastRunAt).toLocaleString() : 'never'}
${config?.dailyRundown ? `Market rundown: ${config.dailyRundown}` : ''}

OPEN POSITIONS (${openPositions.length}):
${portfolioSummary || 'None — paper trading not yet started'}

PORTFOLIO: ${lastSnapshot ? `$${lastSnapshot.totalValue.toFixed(0)} value, $${lastSnapshot.totalCost.toFixed(0)} cost, ${lastSnapshot.gainLossPct.toFixed(1)}% return` : 'No snapshot yet'}

WATCHLIST (top by score):
${watchlistSummary || 'No scored stocks yet — run the autopilot first'}`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      system: systemPrompt,
      messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
    })

    return Response.json({
      role: 'assistant',
      content: (response.content[0] as any).text ?? '',
    })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
