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

  const systemPrompt = `You are an AI investment analyst assistant for a value investing platform called Rival Automations. You have full context about the user's paper trading portfolio and stock analysis system.

PLATFORM CONTEXT:
Mode: ${config?.mode ?? 'paper'} trading
Total capital: $${config?.totalCapital ?? 10000}
Min philosophy score: ${config?.minPhilosophyScore ?? 55}/100
Min margin of safety: ${config?.minMarginOfSafety ?? 20}%
Last run: ${config?.lastRunAt ? new Date(config.lastRunAt).toLocaleString() : 'never'}
Last rundown: ${config?.dailyRundown ?? 'none yet'}

OPEN POSITIONS (${openPositions.length}):
${portfolioSummary || 'No open positions yet'}

PORTFOLIO SNAPSHOT:
${lastSnapshot ? `Total value: $${lastSnapshot.totalValue.toFixed(0)}, Cost: $${lastSnapshot.totalCost.toFixed(0)}, Return: ${lastSnapshot.gainLossPct.toFixed(1)}%` : 'No snapshot yet'}

TOP WATCHLIST STOCKS BY SCORE:
${watchlistSummary || 'No scored stocks yet'}

PHILOSOPHY ENGINE:
The platform scores stocks 0-100 based on principles from Graham, Buffett, Munger, Fisher, Klarman, Lynch, Greenblatt, and Dreman. A buy requires score >= ${config?.minPhilosophyScore ?? 55} AND margin of safety >= ${config?.minMarginOfSafety ?? 20}%. The macro overlay adjusts thresholds based on the S&P 500 Shiller CAPE ratio.

Answer questions about the portfolio, watchlist, stock analysis, value investing philosophy, and the autopilot system. Be direct and analytical. If you don't have specific data, say so. Keep responses concise but informative.`

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
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
