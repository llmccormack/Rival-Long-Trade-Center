// Market candidate discovery — uses FMP stock screener API with custom value criteria.
//
// Replaces the previous Yahoo predefined-screen approach, which was unreliable:
//   - Yahoo's "aggressive_small_caps" and "undervalued_growth_stocks" screens are
//     Yahoo's own curated lists, not our value criteria.
//   - Predefined screens change composition without notice.
//   - PEG-based screens conflict with Graham methodology.
//
// FMP /stock-screener allows direct custom filtering (PE, PB, marketCap, etc.)
// so we get exactly the universe our strategy targets.
//
// Two passes:
//   Pass 1 — Deep value:    PE ≤ 15, PB ≤ 1.5  (classic Graham)
//   Pass 2 — Wider value:   PE ≤ 20, PB ≤ 2.5  (Buffett "fair price" zone)
// Results are deduplicated and sorted by PE ascending (cheapest first).
// Budget: 2 FMP API calls per scan.

const FMP_BASE = 'https://financialmodelingprep.com/api/v3'

export interface YahooCandidate {
  symbol:    string
  name:      string
  price:     number
  pe:        number | null
  pb:        number | null
  marketCap: number
  eps:       number | null
  bookValue: number | null
  sector:    string | null
  source:    string
}

interface FMPScreenerResult {
  symbol:        string
  companyName:   string
  price:         number
  marketCap:     number
  beta:          number | null
  volume:        number | null
  lastAnnualDividend: number | null
  exchange:      string
  exchangeShortName: string
  country:       string
  isEtf:         boolean
  isActivelyTrading: boolean
  sector:        string | null
  industry:      string | null
}

async function fetchFMPScreen(params: Record<string, string | number>, source: string): Promise<YahooCandidate[]> {
  const apiKey = process.env.FMP_API_KEY
  if (!apiKey) return []

  const query = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    isEtf: 'false',
    isActivelyTrading: 'true',
    country: 'US',
    limit: '250',
    apikey: apiKey,
  })

  try {
    const res = await fetch(`${FMP_BASE}/stock-screener?${query}`, {
      next: { revalidate: 0 },
    })
    if (!res.ok) return []
    const data: FMPScreenerResult[] = await res.json()
    if (!Array.isArray(data)) return []

    return data
      .filter(r => r.symbol && !r.symbol.includes('.') && !r.symbol.includes('-') && r.price > 0)
      .map(r => ({
        symbol:    r.symbol,
        name:      r.companyName ?? r.symbol,
        price:     r.price,
        pe:        null,  // screener endpoint doesn't return PE — FMP deep analysis fills this
        pb:        null,  // same — filled by getCompleteFundamentals
        marketCap: r.marketCap ?? 0,
        eps:       null,
        bookValue: null,
        sector:    r.sector ?? null,
        source,
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
  const { maxPE = 20, maxPB = 2.5, minMarketCapM = 300 } = options
  const minMarketCap = minMarketCapM * 1_000_000

  // Run both passes in parallel
  const [deepValue, widerValue] = await Promise.all([
    // Pass 1: classic Graham deep value
    fetchFMPScreen({
      marketCapMoreThan: minMarketCap,
      peRatioLowerThan: Math.min(maxPE, 15),
      priceToBookLowerThan: Math.min(maxPB, 1.5),
    }, 'fmp_deep_value'),

    // Pass 2: wider Buffett "fair price" zone
    fetchFMPScreen({
      marketCapMoreThan: minMarketCap,
      peRatioLowerThan: maxPE,
      priceToBookLowerThan: maxPB,
    }, 'fmp_wider_value'),
  ])

  // Deduplicate — deep value pass takes priority (it's the better source)
  const seen = new Map<string, YahooCandidate>()
  for (const c of [...deepValue, ...widerValue]) {
    if (!seen.has(c.symbol)) seen.set(c.symbol, c)
  }

  const all = [...seen.values()].filter(c => c.price > 0 && c.marketCap >= minMarketCap)

  // Deep value candidates first, then wider — within each group order doesn't matter
  // since FMP deep analysis re-ranks by philosophy score anyway
  const deepSet = new Set(deepValue.map(c => c.symbol))
  return [
    ...all.filter(c => deepSet.has(c.symbol)),
    ...all.filter(c => !deepSet.has(c.symbol)),
  ]
}
