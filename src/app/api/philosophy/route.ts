import { NextRequest } from 'next/server'
import { getCompleteFundamentals } from '@/lib/fmp/client'
import { applyGrahamCriteria } from '@/lib/graham/screener'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import { scoreBuyDecision } from '@/lib/philosophy/scorer'
import { scoreSellDecision } from '@/lib/philosophy/sell-scorer'
import { ALL_PRINCIPLES } from '@/lib/philosophy/principles'

// GET /api/philosophy?ticker=KO — full philosophy audit for a stock
export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get('ticker')

  // Return all principles if no ticker specified
  if (!ticker) {
    return Response.json({
      count: ALL_PRINCIPLES.length,
      principles: ALL_PRINCIPLES,
    })
  }

  try {
    const fundamentals = await getCompleteFundamentals(ticker.toUpperCase())
    const criteria = applyGrahamCriteria(fundamentals)
    const iv = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding)

    const buyScore = scoreBuyDecision(fundamentals, criteria, iv)
    const sellAssessment = scoreSellDecision(fundamentals, iv)

    return Response.json({
      ticker: ticker.toUpperCase(),
      price: fundamentals.price,
      intrinsicValue: iv.intrinsicValue,
      marginOfSafety: iv.marginOfSafety,
      buyScore: {
        total: buyScore.total,
        conviction: buyScore.conviction,
        signal: buyScore.signal,
        categoryScores: buyScore.categoryScores,
        vetoedBy: buyScore.vetoedBy.map(p => ({ id: p.id, title: p.title, rule: p.rule })),
        triggeredPrinciples: buyScore.triggeredPrinciples.map(t => ({
          id: t.principle.id,
          title: t.principle.title,
          source: t.principle.source,
          category: t.principle.category,
          score: t.score,
          weight: t.principle.weight,
          note: t.note,
        })),
        auditTrail: buyScore.auditTrail,
      },
      sellAssessment: {
        shouldSell: sellAssessment.shouldSell,
        urgency: sellAssessment.urgency,
        reason: sellAssessment.reason,
        signals: sellAssessment.signals,
        vetoSell: sellAssessment.vetoSell,
      },
    })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
