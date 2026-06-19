import { getMarketCandidates } from '@/lib/yahoo/screener'
import { getCompleteFundamentals } from '@/lib/fmp/client'
import { applyGrahamCriteria } from '@/lib/graham/screener'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import { scoreBuyDecision } from '@/lib/philosophy/scorer'
import { upsertStockScore } from '@/lib/philosophy/persist-score'
import { prisma } from '@/lib/db/client'

// GET /api/screener/market-scan
// Runs Yahoo Finance pre-screen → FMP deep analysis → philosophy scoring
// Optionally auto-promotes qualifying stocks to watchlist
export async function GET(req: Request) {
  const url = new URL(req.url)
  const maxPE = Number(url.searchParams.get('maxPE') ?? 18)
  const maxPB = Number(url.searchParams.get('maxPB') ?? 2.0)
  const minMarketCapM = Number(url.searchParams.get('minMarketCapM') ?? 300)
  const autoPromote = url.searchParams.get('autoPromote') === 'true'
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 40), 60)

  // Step 1: Yahoo Finance pre-screen (free, no API key)
  const candidates = await getMarketCandidates({ maxPE, maxPB, minMarketCapM })
  const toAnalyse = candidates.slice(0, limit)

  const results: any[] = []
  const promoted: string[] = []
  let fmpCalls = 0

  // Step 2: FMP deep analysis + philosophy scoring
  for (const candidate of toAnalyse) {
    try {
      const fundamentals = await getCompleteFundamentals(candidate.symbol)
      fmpCalls++

      const criteria = applyGrahamCriteria(fundamentals)
      const iv = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding)
      const philosophy = scoreBuyDecision(fundamentals, criteria, iv)

      const result = {
        ticker: candidate.symbol,
        name: fundamentals.name,
        sector: fundamentals.sector,
        price: fundamentals.price,
        marketCap: fundamentals.marketCap,
        pe: fundamentals.pe,
        pb: fundamentals.pb,
        mos: Math.round(iv.marginOfSafety * 10) / 10,
        intrinsicValue: Math.round(iv.intrinsicValue * 100) / 100,
        philosophyScore: philosophy.total,
        signal: philosophy.signal,
        conviction: philosophy.conviction,
        grahamPass: criteria.overallPass,
        vetoCount: philosophy.vetoedBy.length,
        source: candidate.source,
        topNotes: philosophy.auditTrail.filter(l =>
          l.startsWith('PASS') || l.startsWith('FAIL')
        ).slice(0, 3),
      }

      results.push(result)

      // Persist to score leaderboard (fire-and-forget)
      upsertStockScore({
        ticker:        candidate.symbol,
        name:          fundamentals.name,
        sector:        fundamentals.sector,
        price:         fundamentals.price,
        score:         philosophy.total,
        mos:           iv.marginOfSafety,
        intrinsicValue: iv.intrinsicValue,
        grahamNumber:  iv.grahamNumber,
        pe:            fundamentals.pe,
        pb:            fundamentals.pb,
        signal:        philosophy.signal,
        conviction:    philosophy.conviction,
        vetoCount:     philosophy.vetoedBy.length,
        vetoReasons:   philosophy.vetoedBy.map((p: any) => p.title),
        source:        'scan',
      }).catch(() => {})

      // Step 3: Auto-promote to watchlist if it qualifies
      if (
        autoPromote &&
        philosophy.vetoedBy.length === 0 &&
        philosophy.total >= 55 &&
        iv.marginOfSafety >= 30
      ) {
        try {
          const stock = await prisma.stock.upsert({
            where: { ticker: candidate.symbol },
            create: {
              ticker: candidate.symbol,
              name: fundamentals.name,
              sector: fundamentals.sector,
              industry: fundamentals.industry,
              exchange: fundamentals.exchange,
            },
            update: { name: fundamentals.name },
          })
          await prisma.watchlistItem.upsert({
            where: { stockId: stock.id },
            create: {
              stockId: stock.id,
              targetPrice: iv.intrinsicValue * 0.7,
              notes: `Auto-promoted by market scan. Score: ${philosophy.total}/100, MOS: ${iv.marginOfSafety.toFixed(1)}%`,
              isActive: true,
            },
            update: { isActive: true },
          })
          promoted.push(candidate.symbol)
        } catch {
          // DB unavailable — skip promotion
        }
      }

      // Small delay to respect FMP rate limits
      await new Promise(r => setTimeout(r, 200))
    } catch {
      // Skip tickers where FMP has no data
    }
  }

  // Sort: buy signals first, then by philosophy score
  results.sort((a, b) => {
    if (a.signal === 'BUY' && b.signal !== 'BUY') return -1
    if (a.signal !== 'BUY' && b.signal === 'BUY') return 1
    return b.philosophyScore - a.philosophyScore
  })

  return Response.json({
    scannedAt: new Date().toISOString(),
    candidatesFromYahoo: candidates.length,
    analysed: results.length,
    fmpCallsUsed: fmpCalls,
    buySignals: results.filter(r => r.signal === 'BUY').length,
    grahamPasses: results.filter(r => r.grahamPass).length,
    autoPromoted: promoted,
    results,
  })
}
