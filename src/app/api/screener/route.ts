import { NextRequest } from 'next/server'
import { screenStocks } from '@/lib/fmp/client'
import { getCompleteFundamentals } from '@/lib/fmp/client'
import { applyGrahamCriteria, calculateGrahamScore } from '@/lib/graham/screener'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import type { ScreenedStock } from '@/types'

// Runs the Graham Chapter 14 screen against a batch of stocks
// This is intentionally slow — fundamental investing doesn't need speed
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100)
  const minMarketCap = parseInt(searchParams.get('minMarketCap') ?? '1000000000') // $1B default

  try {
    // Pull candidate list from FMP screener
    const candidates = await screenStocks({
      marketCapMoreThan: minMarketCap,
      dividendMoreThan: 0, // Must pay dividends
      limit,
    })

    const results: ScreenedStock[] = []

    // Analyse each candidate (rate-limited by FMP client)
    for (const candidate of candidates.slice(0, limit)) {
      try {
        const fundamentals = await getCompleteFundamentals(candidate.symbol)
        const criteria = applyGrahamCriteria(fundamentals)
        const intrinsicValue = criteria.overallPass || calculateGrahamScore(criteria) >= 57
          ? calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding)
          : undefined

        results.push({
          ticker: candidate.symbol,
          name: fundamentals.name,
          price: fundamentals.price,
          criteria,
          intrinsicValue,
          fundamentals: {
            pe: fundamentals.pe,
            pb: fundamentals.pb,
            currentRatio: fundamentals.currentRatio,
            debtToEquity: fundamentals.debtToEquity,
            roe: fundamentals.roe,
            roic: fundamentals.roic,
            dividendYield: fundamentals.dividendYield,
            sector: fundamentals.sector,
          },
        })
      } catch {
        // Skip tickers with insufficient data
      }
    }

    // Sort: passing stocks first, then by Graham score
    results.sort((a, b) => {
      if (a.criteria.overallPass && !b.criteria.overallPass) return -1
      if (!a.criteria.overallPass && b.criteria.overallPass) return 1
      return calculateGrahamScore(b.criteria) - calculateGrahamScore(a.criteria)
    })

    return Response.json({ count: results.length, results })
  } catch (err: any) {
    return Response.json(
      { error: 'Screener failed', message: err.message },
      { status: 500 }
    )
  }
}
