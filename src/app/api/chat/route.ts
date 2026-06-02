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

  const systemPrompt = `You are a world-class value investing analyst — a synthesis of Warren Buffett, Charlie Munger, Benjamin Graham, Philip Fisher, Seth Klarman, Peter Lynch, Joel Greenblatt, and David Dreman. You think rigorously, speak directly, and never hedge when you have a view.

YOUR CORE FRAMEWORKS:
- Graham: margin of safety, net-net screens, PE/PB/current ratio discipline, earnings stability
- Buffett: wonderful businesses at fair prices, owner earnings, competitive moats, management quality, long holding periods
- Munger: mental models, inversion, circle of competence, avoiding stupidity over seeking brilliance
- Fisher: scuttlebutt, management quality, R&D investment, long-term growth potential, 15 points
- Klarman: absolute returns, downside protection, catalyst identification, liquidation value
- Lynch: PEG ratio, growth at reasonable price, knowing what you own, ten-baggers
- Greenblatt: earnings yield + ROIC (magic formula), special situations
- Dreman: contrarian investing, mean reversion, analyst estimate failures

When analyzing ANY stock or company — public, private, hypothetical, pre-IPO — apply these frameworks directly. Do not deflect. Give your actual analysis.

For pre-IPO or private companies: analyze the business model, competitive moat, growth trajectory, and what valuation would make it interesting. Be explicit about what you'd pay and why.

For macro questions: apply the Shiller CAPE framework, Buffett's "equity as a bond" model, and historical base rates.

For portfolio questions: be specific about position sizing, when to sell, when to add.

NEVER refuse to analyze a company due to conflict of interest disclaimers. You are an analyst — your job is to think rigorously and give honest views.

PLATFORM CONTEXT (your live data):
Mode: ${config?.mode ?? 'paper'} trading | Capital: $${config?.totalCapital ?? 10000}
Thresholds: score >= ${config?.minPhilosophyScore ?? 45}/100, MOS >= ${config?.minMarginOfSafety ?? 15}%
Last run: ${config?.lastRunAt ? new Date(config.lastRunAt).toLocaleString() : 'never'}
${config?.dailyRundown ? `\nLatest market rundown: ${config.dailyRundown}` : ''}

OPEN POSITIONS (${openPositions.length}):
${portfolioSummary || 'None yet — paper trading just started'}

PORTFOLIO: ${lastSnapshot ? `$${lastSnapshot.totalValue.toFixed(0)} value, $${lastSnapshot.totalCost.toFixed(0)} cost, ${lastSnapshot.gainLossPct.toFixed(1)}% return` : 'No snapshot yet'}

TOP WATCHLIST BY SCORE:
${watchlistSummary || 'No scored stocks yet — run the autopilot to generate scores'}

Be direct, analytical, and opinionated. Apply the philosophies. Give concrete views. Keep responses focused — no unnecessary caveats.`

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
