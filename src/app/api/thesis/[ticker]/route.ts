import Anthropic from '@anthropic-ai/sdk'
import { getCompleteFundamentals, getInsiderTransactions, getEarningsCalendar } from '@/lib/fmp/client'
import { applyGrahamCriteria } from '@/lib/graham/screener'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import { scoreBuyDecision } from '@/lib/philosophy/scorer'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 })
  }

  const { ticker } = await params
  const sym = ticker.toUpperCase()

  try {
    const [fundamentals, insider, earnings] = await Promise.all([
      getCompleteFundamentals(sym),
      getInsiderTransactions(sym, 10),
      getEarningsCalendar(sym),
    ])

    const criteria = applyGrahamCriteria(fundamentals)
    const iv = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding)
    const philosophy = scoreBuyDecision(fundamentals, criteria, iv)

    // Find next earnings date
    const today = new Date()
    const nextEarnings = earnings.find(e => new Date(e.date) >= today)

    // Insider buying summary
    const recentBuys = insider.filter(t => t.transactionType?.includes('P')).slice(0, 3)

    const context = `
STOCK: ${sym} — ${fundamentals.name}
SECTOR: ${fundamentals.sector} | INDUSTRY: ${fundamentals.industry}
PRICE: $${fundamentals.price} | MARKET CAP: $${fundamentals.marketCap != null ? (fundamentals.marketCap / 1e9).toFixed(1) + 'B' : 'N/A'}

VALUATION:
- P/E: ${fundamentals.pe?.toFixed(1) ?? 'N/A'} | P/B: ${fundamentals.pb?.toFixed(1) ?? 'N/A'}
- Intrinsic Value: $${iv.intrinsicValue.toFixed(2)}
- Margin of Safety: ${iv.marginOfSafety.toFixed(1)}%
- Signal: ${philosophy.signal} | Score: ${philosophy.total}/100 | Conviction: ${philosophy.conviction}

QUALITY:
- ROIC: ${fundamentals.roic !== undefined ? (fundamentals.roic * 100).toFixed(1) + '%' : 'N/A'}
- ROE: ${fundamentals.roe !== undefined ? (fundamentals.roe * 100).toFixed(1) + '%' : 'N/A'}
- Operating Margin Trend: ${fundamentals.operatingMarginTrend}
- Current Ratio: ${fundamentals.currentRatio?.toFixed(2) ?? 'N/A'}
- Debt/Equity: ${fundamentals.debtToEquity?.toFixed(2) ?? 'N/A'}

PHILOSOPHY GATE RESULTS:
- Graham Criteria: ${criteria.overallPass ? 'PASS' : 'FAIL'}
- Hard Vetoes: ${philosophy.vetoedBy.length > 0 ? philosophy.vetoedBy.map((v: any) => v.title).join(', ') : 'None'}
- Top Signals: ${philosophy.auditTrail.filter((l: string) => l.startsWith('PASS') || l.startsWith('FAIL')).slice(0, 5).join(' | ')}

CATALYSTS:
- Next Earnings: ${nextEarnings ? nextEarnings.date : 'Not found'}
- Recent Insider Buys: ${recentBuys.length > 0 ? recentBuys.map(b => `${b.reportingName} bought ${b.securitiesTransacted?.toLocaleString()} shares`).join('; ') : 'None in recent filings'}
`.trim()

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      system: `You are a value investing analyst trained on Benjamin Graham, Warren Buffett, Charlie Munger, Peter Lynch, and Seth Klarman. Write concise, data-driven investment theses. Be direct — state clearly whether this is worth investing in and why. Use the provided data only. Never recommend specific position sizes or give financial advice disclaimers.`,
      messages: [{
        role: 'user',
        content: `Write a 4-paragraph investment thesis for ${sym} based on this data:\n\n${context}\n\nStructure: (1) Business quality & moat, (2) Valuation case, (3) Key risks & what could go wrong, (4) Verdict — buy / watch / avoid and why.`,
      }],
    })

    const thesis = (message.content[0] as { type: string; text: string }).text

    return Response.json({ ticker: sym, thesis, generatedAt: new Date().toISOString() })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
