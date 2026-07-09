// ─── Trade Post-Mortem ────────────────────────────────────────────────────────
//
// Every closed trade gets a written verdict: did the thesis play out, was the
// thesis wrong, or was the exit the mistake? The thesis recorded AT PURCHASE
// is compared against what actually happened — no hindsight rewriting.
// Aggregated verdicts are the evidence base for tuning the engine's thresholds.

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db/client'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const VERDICTS = ['thesis_played_out', 'thesis_wrong', 'exit_discipline', 'exit_premature', 'inconclusive'] as const

interface ClosedPositionLike {
  shares: number
  avgCostBasis: number
  firstPurchased: Date
  philosophyScore: number | null
  conviction: string | null
  mosAtPurchase: number | null
  dividendsEarned: number
  auditTrail: string[]
  entryMode?: string
  stock: { ticker: string }
}

export async function recordPostMortem(
  pos: ClosedPositionLike,
  closePrice: number,
  closeReason: string
): Promise<void> {
  const closedAt = new Date()
  const holdingDays = Math.max(1, Math.round((closedAt.getTime() - pos.firstPurchased.getTime()) / 86_400_000))
  const cost = pos.shares * pos.avgCostBasis
  const proceeds = pos.shares * closePrice
  const returnPct = cost > 0 ? ((proceeds + pos.dividendsEarned - cost) / cost) * 100 : 0
  const thesis = pos.auditTrail.slice(0, 8)

  let verdict: string = 'inconclusive'
  let lessons = 'AI post-mortem unavailable.'

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const prompt = `You are reviewing a closed paper trade for a value-investing system. Compare the ORIGINAL thesis (recorded at purchase, before the outcome was known) against what happened. Be brutally honest — the point is to learn, not to feel good.

TRADE:
- Ticker: ${pos.stock.ticker} | Entry mode: ${pos.entryMode ?? 'value'}
- Bought at $${pos.avgCostBasis.toFixed(2)} (score ${pos.philosophyScore ?? '?'}/100, conviction ${pos.conviction ?? '?'}, MOS at purchase ${pos.mosAtPurchase?.toFixed(1) ?? '?'}%)
- Sold at $${closePrice.toFixed(2)} after ${holdingDays} days | Total return incl. dividends: ${returnPct.toFixed(1)}%
- Sell trigger: ${closeReason}

ORIGINAL THESIS (verbatim audit trail at purchase):
${thesis.map(t => `- ${t}`).join('\n')}

Respond with ONLY a JSON object:
{"verdict": "<one of: thesis_played_out | thesis_wrong | exit_discipline | exit_premature | inconclusive>", "lessons": "<2-3 blunt sentences: what this trade teaches about the entry criteria, the sell trigger, or the sizing. Name the specific criterion involved.>"}

Verdict guide: thesis_played_out = bought cheap for the stated reason and it worked. thesis_wrong = the stated reason was refuted by events. exit_discipline = the sell rule correctly protected capital. exit_premature = the sell rule fired but the thesis was intact (we sold a winner early). inconclusive = too short a holding or outcome dominated by market beta.`

      const msg = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { verdict?: string; lessons?: string }
        if (parsed.verdict && (VERDICTS as readonly string[]).includes(parsed.verdict)) verdict = parsed.verdict
        if (parsed.lessons) lessons = parsed.lessons
      }
    } catch { /* verdict stays inconclusive — the row is still recorded */ }
  }

  await prisma.tradePostMortem.create({
    data: {
      ticker: pos.stock.ticker,
      entryMode: pos.entryMode ?? 'value',
      openedAt: pos.firstPurchased,
      closedAt,
      holdingDays,
      returnPct: Math.round(returnPct * 100) / 100,
      dividendsEarned: Math.round(pos.dividendsEarned * 100) / 100,
      closeReason: closeReason.slice(0, 300),
      thesisAtPurchase: thesis,
      verdict,
      lessons,
    },
  })
}
