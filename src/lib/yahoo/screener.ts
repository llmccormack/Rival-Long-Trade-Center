// Yahoo Finance discovery screener — completely free, no API key required
//
// Uses yahoo-finance2 which handles cookies/crumbs automatically.
// Pulls from multiple Yahoo predefined screens for broad value coverage:
//   undervalued_large_caps   ~91 stocks   (PE < 20, PB < 2.5)
//   undervalued_growth_stocks ~211 stocks  (GARP: PEG < 1)
//   aggressive_small_caps    ~369 stocks  (small cap with value characteristics)
//   portfolio_anchors        ~249 stocks  (high quality, durable businesses)
//
// Returns deduplicated candidates with enough data to do a basic value pre-filter
// using ONLY Yahoo data — no FMP calls needed for discovery. The autopilot buy
// phase then does full FMP analysis on the resulting watchlist items.
//
// API call budget: 0 FMP calls. All Yahoo, all free.

import YahooFinance from 'yahoo-finance2'

let _yf: InstanceType<typeof YahooFinance> | null = null
function yf(): InstanceType<typeof YahooFinance> {
  if (!_yf) _yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] })
  return _yf
}

// Screens ordered by Graham relevance: deep value first, GARP second
const DISCOVERY_SCREENS = [
  'undervalued_large_caps',
  'undervalued_growth_stocks',
  'aggressive_small_caps',
  'portfolio_anchors',
]

export interface YahooCandidate {
  symbol: string
  name: string
  price: number
  pe: number | null
  pb: number | null
  marketCap: number
  eps: number | null      // TTM EPS — used for Graham Number approximation
  bookValue: number | null // book value per share — used for Graham Number
  sector: string | null
  source: string
}

async function fetchScreen(screenId: string, count = 250): Promise<YahooCandidate[]> {
  try {
    const r = await yf().screener(
      { scrIds: screenId, count } as any,
      { validateResult: false } as any
    )
    const quotes: any[] = r?.quotes ?? []
    return quotes
      .filter(q => q.quoteType === 'EQUITY' && q.symbol && !q.symbol.includes('.'))
      .map(q => ({
        symbol: q.symbol as string,
        name: (q.shortName ?? q.longName ?? q.displayName ?? q.symbol) as string,
        price: (q.regularMarketPrice ?? 0) as number,
        pe: q.trailingPE as number | null ?? null,
        pb: q.priceToBook as number | null ?? null,
        marketCap: (q.marketCap ?? 0) as number,
        eps: q.epsTrailingTwelveMonths as number | null ?? null,
        bookValue: q.bookValue as number | null ?? null,
        sector: q.sector as string | null ?? null,
        source: screenId,
      }))
  } catch {
    return []
  }
}

export async function getMarketCandidates(options: {
  maxPE?: number
  maxPB?: number
  minMarketCapM?: number
} = {}): Promise<YahooCandidate[]> {
  const { maxPE = 30, maxPB = 4, minMarketCapM = 100 } = options
  const minMarketCap = minMarketCapM * 1_000_000

  // Fetch all screens in parallel
  const screenResults = await Promise.all(DISCOVERY_SCREENS.map(s => fetchScreen(s)))

  // Deduplicate by symbol — first screen that mentions a ticker wins
  const seen = new Map<string, YahooCandidate>()
  for (const batch of screenResults) {
    for (const c of batch) {
      if (!seen.has(c.symbol)) seen.set(c.symbol, c)
    }
  }

  // Basic value pre-filter using only Yahoo data
  // Intentionally loose — the buy phase does the real gatekeeping via FMP
  const filtered = [...seen.values()].filter(c => {
    if (c.price <= 0) return false
    if (c.marketCap > 0 && c.marketCap < minMarketCap) return false
    // Only apply PE/PB filter when Yahoo actually has the data
    if (c.pe !== null && c.pe <= 0) return false          // loss-making
    if (c.pe !== null && c.pe > maxPE) return false
    if (c.pb !== null && c.pb > maxPB) return false
    return true
  })

  // Sort: lowest PE first (deepest value candidates at top)
  return filtered.sort((a, b) => (a.pe ?? 99) - (b.pe ?? 99))
}
