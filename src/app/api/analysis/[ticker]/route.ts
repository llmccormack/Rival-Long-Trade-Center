import Anthropic from '@anthropic-ai/sdk'
import { NextRequest } from 'next/server'
import { getCompleteFundamentals, getTickerNews, getInsiderTransactions } from '@/lib/fmp/client'
import { applyGrahamCriteria } from '@/lib/graham/screener'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import { scoreBuyDecision } from '@/lib/philosophy/scorer'
import { prisma } from '@/lib/db/client'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params

  try {
    const fundamentals = await getCompleteFundamentals(ticker.toUpperCase())
    const criteria = applyGrahamCriteria(fundamentals)
    const intrinsicValue = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding)

    // Persist intrinsic value calculation
    const stock = await prisma.stock.findUnique({ where: { ticker: ticker.toUpperCase() } })
    if (stock) {
      await prisma.intrinsicValue.create({
        data: {
          stockId: stock.id,
          currentPrice: fundamentals.price,
          grahamNumber: intrinsicValue.grahamNumber,
          dcfValue: intrinsicValue.dcfValue,
          intrinsicValue: intrinsicValue.intrinsicValue,
          marginOfSafety: intrinsicValue.marginOfSafety,
          isBuySignal: intrinsicValue.isBuySignal,
          ownerEarnings: intrinsicValue.ownerEarnings,
          growthRateUsed: intrinsicValue.growthRateUsed,
          discountRateUsed: intrinsicValue.discountRateUsed,
          terminalGrowth: intrinsicValue.terminalGrowth,
        },
      })

      // Persist screen result
      await prisma.screenResult.create({
        data: {
          stockId: stock.id,
          ...criteria,
        },
      })
    }

    const moatAnalysis = await prisma.moatAnalysis.findFirst({
      where: { ticker: ticker.toUpperCase() },
      orderBy: { generatedAt: 'desc' },
    }).catch(() => null)

    // Trigger async moat analysis in background if none exists and fundamentals are available
    if (!moatAnalysis && fundamentals.price > 0) {
      const news = await getTickerNews(ticker.toUpperCase()).catch(() => null)
      const philosophy = scoreBuyDecision(fundamentals, criteria, intrinsicValue, news ?? undefined)
      import('@/lib/ai/moat-analysis').then(({ analyzeMoat }) => {
        analyzeMoat(ticker.toUpperCase(), fundamentals.name, philosophy.total, intrinsicValue.marginOfSafety)
          .then(analysis => {
            if (analysis) {
              prisma.moatAnalysis.create({
                data: {
                  ticker: ticker.toUpperCase(),
                  companyName: fundamentals.name,
                  moatScore: analysis.moatScore,
                  moatType: analysis.moatType,
                  moatSources: analysis.moatSources,
                  managementScore: analysis.managementScore,
                  businessQuality: analysis.businessQuality,
                  thesis: analysis.thesis,
                  keyRisks: analysis.keyRisks,
                  catalysts: analysis.catalysts,
                  verdict: analysis.verdict,
                  confidence: analysis.confidence,
                },
              }).catch(() => {})
            }
          })
      }).catch(() => {})
    }

    return Response.json({ ticker: ticker.toUpperCase(), fundamentals, criteria, intrinsicValue, moatAnalysis })
  } catch (err: any) {
    return Response.json(
      { error: 'Analysis failed', message: err.message },
      { status: 500 }
    )
  }
}

export async function POST(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 })
  }

  const { ticker } = await params
  const sym = ticker.toUpperCase()

  const [fundamentals, news, insider] = await Promise.all([
    getCompleteFundamentals(sym),
    getTickerNews(sym).catch(() => null),
    getInsiderTransactions(sym, 8).catch(() => []),
  ])

  const criteria = applyGrahamCriteria(fundamentals)
  const iv = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding)
  const philosophy = scoreBuyDecision(fundamentals, criteria, iv, news ?? undefined)

  const auditHighlights = philosophy.auditTrail
    .filter((l: string) => l.startsWith('PASS') || l.startsWith('FAIL') || l.startsWith('VETO'))
    .slice(0, 12)
    .join('\n')

  const insiderSummary = insider.length > 0
    ? insider.slice(0, 4).map(t => `${t.reportingName}: ${t.transactionType?.includes('P') ? 'BOUGHT' : 'SOLD'} ${t.securitiesTransacted?.toLocaleString()} shares on ${t.transactionDate?.slice(0,10)}`).join('\n')
    : 'No recent insider transactions'

  const prompt = `You are a senior value investing analyst. Provide a structured deep-dive analysis of ${sym} for an investor who uses Graham/Buffett principles. Be specific, data-driven, and direct. Do not give generic disclaimers.

DATA:
Company: ${fundamentals.name} (${fundamentals.sector})
Price: $${fundamentals.price} | Market Cap: $${fundamentals.marketCap ? (fundamentals.marketCap/1e9).toFixed(1)+'B' : 'N/A'}
Intrinsic Value: $${iv.intrinsicValue.toFixed(2)} | Margin of Safety: ${iv.marginOfSafety.toFixed(1)}%
Philosophy Score: ${philosophy.total}/100 | Signal: ${philosophy.signal} | Conviction: ${philosophy.conviction}
Vetoes: ${philosophy.vetoedBy.length > 0 ? philosophy.vetoedBy.map((v: any) => v.title).join(', ') : 'None'}

KEY METRICS:
P/E: ${fundamentals.pe?.toFixed(1) ?? 'N/A'} | P/B: ${fundamentals.pb?.toFixed(1) ?? 'N/A'} | ROIC: ${fundamentals.roic != null ? (fundamentals.roic*100).toFixed(1)+'%' : 'N/A'}
Current Ratio: ${fundamentals.currentRatio?.toFixed(2) ?? 'N/A'} | D/E: ${fundamentals.debtToEquity?.toFixed(2) ?? 'N/A'}
Operating Margin Trend: ${fundamentals.operatingMarginTrend} | Owner Earnings: ${fundamentals.ownerEarnings != null ? '$'+fundamentals.ownerEarnings.toFixed(0)+'M' : 'N/A'}
Graham Pass: ${criteria.overallPass ? 'YES' : 'NO'}

PHILOSOPHY AUDIT (what passed/failed):
${auditHighlights}

INSIDER ACTIVITY:
${insiderSummary}

NEWS SENTIMENT: ${news?.sentiment ?? 'N/A'}${news?.hardVetoFlags?.length ? '\nHARD VETO FLAGS: ' + news.hardVetoFlags.slice(0,2).join('; ') : ''}

Provide analysis in exactly these 5 sections:

## Business Quality
[2-3 sentences on the moat, competitive position, and earnings quality based on the data]

## Valuation Assessment
[2-3 sentences explaining whether the margin of safety is compelling, how the IV was derived, and if the price makes sense]

## What the Philosophy Engine Found
[Explain in plain English what the most important PASS and FAIL signals mean for this specific company — not generic definitions]

## Red Flags & Risks
[Specific risks from the data: debt levels, declining margins, veto signals, news flags. Be concrete.]

## Verdict
[One clear sentence: Buy / Watch / Avoid and the single most important reason why]`

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 800,
    system: 'You are a senior value investing analyst. Write concise, data-driven analysis. Never pad with disclaimers. Be specific about the numbers.',
    messages: [{ role: 'user', content: prompt }],
  })

  const analysis = (message.content[0] as { type: string; text: string }).text

  return Response.json({
    ticker: sym,
    analysis,
    score: philosophy.total,
    signal: philosophy.signal,
    mos: iv.marginOfSafety,
    generatedAt: new Date().toISOString(),
  })
}
