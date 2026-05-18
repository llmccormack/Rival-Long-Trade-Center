import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db/client'
import { getCompleteFundamentals } from '@/lib/fmp/client'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import { applyGrahamCriteria } from '@/lib/graham/screener'
import { scoreBuyDecision } from '@/lib/philosophy/scorer'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 })
  }

  try {
    const positions = await prisma.paperPortfolioItem.findMany({
      where: { isOpen: true },
      include: { stock: true },
    })

    if (positions.length === 0) {
      return Response.json({ error: 'No open positions to review' }, { status: 400 })
    }

    // Get current data for each position
    const positionData = await Promise.all(
      positions.map(async (pos) => {
        try {
          const f = await getCompleteFundamentals(pos.stock.ticker)
          const iv = calculateIntrinsicValue(f, f.sharesOutstanding)
          const criteria = applyGrahamCriteria(f)
          const phil = scoreBuyDecision(f, criteria, iv)
          const currentValue = pos.shares * (f.price)
          const gainLossPct = ((f.price - pos.avgCostBasis) / pos.avgCostBasis) * 100
          return {
            ticker: pos.stock.ticker,
            sector: f.sector,
            currentMOS: iv.marginOfSafety,
            currentScore: phil.total,
            signal: phil.signal,
            gainLossPct,
            currentValue,
            vetoCount: phil.vetoedBy.length,
            conviction: pos.conviction,
            mosAtPurchase: pos.mosAtPurchase,
          }
        } catch {
          return {
            ticker: pos.stock.ticker,
            sector: pos.stock.sector ?? 'Unknown',
            currentMOS: pos.mosAtPurchase ?? 0,
            currentScore: pos.philosophyScore ?? 0,
            signal: 'UNKNOWN',
            gainLossPct: 0,
            currentValue: pos.shares * pos.avgCostBasis,
            vetoCount: 0,
            conviction: pos.conviction,
            mosAtPurchase: pos.mosAtPurchase,
          }
        }
      })
    )

    // Sector concentration
    const sectorCounts: Record<string, number> = {}
    positionData.forEach(p => {
      sectorCounts[p.sector ?? 'Unknown'] = (sectorCounts[p.sector ?? 'Unknown'] ?? 0) + 1
    })

    const totalValue = positionData.reduce((s, p) => s + p.currentValue, 0)
    const winners = positionData.filter(p => p.gainLossPct > 0).length
    const deteriorated = positionData.filter(p => p.currentMOS < 10 && (p.mosAtPurchase ?? 0) >= 30)
    const vetoed = positionData.filter(p => p.vetoCount > 0)

    const portfolioSummary = positionData.map(p =>
      `${p.ticker}: Score ${p.currentScore}/100, MOS ${p.currentMOS.toFixed(1)}%, P&L ${p.gainLossPct >= 0 ? '+' : ''}${p.gainLossPct.toFixed(1)}%, Signal: ${p.signal}${p.vetoCount > 0 ? ` ⚠ ${p.vetoCount} veto(s)` : ''}`
    ).join('\n')

    const prompt = `You are a value investing portfolio manager reviewing a paper trading portfolio built on Graham/Buffett principles. Give actionable advice.

PORTFOLIO (${positions.length} positions, ~$${(totalValue/1000).toFixed(0)}k total):
${portfolioSummary}

SECTOR CONCENTRATION: ${Object.entries(sectorCounts).map(([s,n]) => `${s}: ${n}`).join(', ')}
WINNERS: ${winners}/${positions.length} | DETERIORATED (MOS <10%): ${deteriorated.map(p=>p.ticker).join(', ') || 'None'} | VETOED: ${vetoed.map(p=>p.ticker).join(', ') || 'None'}

Provide a portfolio review in exactly these sections:

## Overall Assessment
[2 sentences: is this a well-constructed value portfolio? What's the biggest strength?]

## Positions to Consider Selling
[List any positions where MOS has shrunk, score dropped, or vetoes appeared. Be specific with tickers.]

## Concentration Risks
[Any sector overweight? Any single position dominating? Flag it.]

## Positions to Add To
[Which holdings still have good MOS and score — worth adding on dips?]

## Portfolio Grade
[A/B/C/D grade with a one-sentence justification]`

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 700,
      system: 'You are a value investing portfolio manager. Be direct, specific, and actionable. Reference specific tickers.',
      messages: [{ role: 'user', content: prompt }],
    })

    const review = (message.content[0] as { type: string; text: string }).text

    return Response.json({
      review,
      positionCount: positions.length,
      generatedAt: new Date().toISOString(),
    })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
