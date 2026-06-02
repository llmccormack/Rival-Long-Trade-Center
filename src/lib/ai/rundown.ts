import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface RundownContext {
  ranAt: string
  mode: string
  macro: {
    sp500Cape?: number
    marketTemperature?: string
    treasury10yr?: string
    effectiveMinScore?: number
  } | null
  watchlistTotal: number
  watchlistScanned: number
  buys: number
  sells: number
  skipped: number
  vetoed: number
  capitalDeployed: number
  topResults: Array<{ ticker: string; action: string; score?: number; mos?: number; reason?: string }>
  portfolioValue?: number
  portfolioCost?: number
  portfolioGainPct?: number
  openPositions?: number
}

export async function generateRundown(ctx: RundownContext): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) return ''

  const topBuys = ctx.topResults.filter(r => r.action.includes('BUY')).slice(0, 5)
  const topScored = ctx.topResults
    .filter(r => r.score !== undefined)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 5)

  const prompt = `You are a value investing analyst assistant. Generate a concise daily market rundown based on the autopilot system's activity today.

Data:
- Run time: ${ctx.ranAt}
- Market temperature: ${ctx.macro?.marketTemperature ?? 'unknown'} (S&P 500 CAPE: ${ctx.macro?.sp500Cape ?? 'n/a'})
- 10Y Treasury yield: ${ctx.macro?.treasury10yr ?? 'n/a'}
- Effective min score threshold: ${ctx.macro?.effectiveMinScore ?? 'n/a'}/100
- Watchlist: ${ctx.watchlistScanned} stocks analyzed (of ${ctx.watchlistTotal} total)
- Results: ${ctx.buys} buys, ${ctx.sells} sells, ${ctx.vetoed} vetoed, ${ctx.skipped} skipped
- Capital deployed today: $${ctx.capitalDeployed.toFixed(0)}
${ctx.openPositions !== undefined ? `- Open positions: ${ctx.openPositions}` : ''}
${ctx.portfolioGainPct !== undefined ? `- Portfolio return: ${ctx.portfolioGainPct.toFixed(1)}% vs cost basis` : ''}
${topBuys.length > 0 ? `- Buys today: ${topBuys.map(b => `${b.ticker} (score: ${b.score}, MOS: ${b.mos?.toFixed(1)}%)`).join(', ')}` : '- No buys today'}
${topScored.length > 0 ? `- Highest scored (not bought): ${topScored.map(s => `${s.ticker} ${s.score}/100 MOS ${s.mos?.toFixed(1)}%`).join(', ')}` : ''}

Write a 3-4 sentence daily rundown in the style of a disciplined value investor. Be direct and analytical. Mention:
1. Market conditions and what they mean for value investing right now
2. What the system found or didn't find today and why
3. Which stocks (if any) are closest to qualifying for a buy
Keep it under 100 words. No bullet points — flowing prose only.`

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })
    return (msg.content[0] as any).text ?? ''
  } catch {
    return ''
  }
}
