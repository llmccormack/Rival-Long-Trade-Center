// Yahoo Finance pre-screener — completely free, no API key
// Pulls from Yahoo's predefined value screens + sector universe
// Returns a deduplicated list of candidates filtered by basic value criteria
// These candidates then go through FMP for full philosophy scoring

const YF_BASE = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved'
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
}

export interface YahooCandidate {
  symbol: string
  name: string
  pe: number | null
  pb: number | null
  marketCap: number
  sector: string | null
  source: string
}

async function fetchScreen(screenId: string, count = 100, offset = 0): Promise<YahooCandidate[]> {
  try {
    const url = `${YF_BASE}?scrIds=${screenId}&count=${count}&offset=${offset}`
    const res = await fetch(url, { headers: YF_HEADERS, next: { revalidate: 3600 } })
    if (!res.ok) return []

    const data = await res.json()
    const quotes: any[] = data?.finance?.result?.[0]?.quotes ?? []

    return quotes
      .filter(q => q.quoteType === 'EQUITY' && q.symbol && !q.symbol.includes('.'))
      .map(q => ({
        symbol: q.symbol,
        name: q.shortName ?? q.longName ?? q.symbol,
        pe: q.trailingPE ?? null,
        pb: q.priceToBook ?? null,
        marketCap: q.marketCap ?? 0,
        sector: q.sector ?? null,
        source: screenId,
      }))
  } catch {
    return []
  }
}

// Supplement with sector-based tickers for broader coverage
// Focus on sectors where Graham/value investing works best
const VALUE_SECTOR_UNIVERSE = [
  // Financials — banks, insurance (often trade below book)
  'JPM','BAC','WFC','C','USB','TFC','PNC','MTB','CFG','FITB','HBAN','KEY','RF','ZION',
  'BK','STT','NTRS','AFL','MET','PRU','ALL','TRV','CB','HIG','L','LNC','UNM',
  // Industrials — capex-heavy, often cyclical value
  'GE','HON','MMM','CAT','DE','EMR','ITW','PH','ROK','DOV','FTV','XYL','ROP',
  'UPS','FDX','CSX','NSC','UNP','WAB','GWW','MSC','AOS',
  // Energy — cyclical value, dividends
  'XOM','CVX','COP','EOG','MPC','VLO','PSX','OXY','DVN','HAL','SLB','BKR',
  'KMI','WMB','OKE','EPD','ET','MMP',
  // Healthcare — defensive value
  'JNJ','ABT','MDT','BMY','MRK','PFE','ABBV','CVS','CI','HUM','MCK','CAH','ABC',
  'BDX','BAX','ZBH','SYK','BSX',
  // Consumer Staples — boring but durable
  'KO','PEP','PG','WMT','COST','KR','SYY','MKC','GIS','K','CPB','HRL','CAG',
  'CLX','CL','KMB','CHD',
  // Materials — asset-heavy, often below book
  'LIN','APD','DD','DOW','LYB','ECL','NEM','FCX','NUE','STLD','RS',
  // Utilities — regulated, dividend payers
  'NEE','DUK','SO','D','AEP','EXC','SRE','PCG','ES','FE','ETR','WEC','XEL',
  // Technology (value-ish) — mature, cash generative
  'AAPL','MSFT','CSCO','INTC','IBM','QCOM','TXN','AMAT','KLAC','LRCX','MU',
  'ORCL','HPE','HPQ','DELL','WDC','STX',
  // Small/mid cap value names
  'ORI','VLYFC','BEN','IVZ','AMG','AMP','LPLA','SF','RJF','EVR',
  'POR','AVA','NWE','SR','MGEE',
]

export async function getMarketCandidates(options: {
  maxPE?: number
  maxPB?: number
  minMarketCapM?: number
} = {}): Promise<YahooCandidate[]> {
  const { maxPE = 18, maxPB = 2.0, minMarketCapM = 300 } = options
  const minMarketCap = minMarketCapM * 1_000_000

  // Fetch from multiple Yahoo predefined value screens in parallel
  const [largeCaps, growthValue, losers] = await Promise.all([
    fetchScreen('undervalued_large_caps', 100),
    fetchScreen('undervalued_growth_stocks', 100),
    fetchScreen('day_losers', 100),   // Templeton: buy at maximum pessimism
  ])

  // Merge Yahoo screen results + sector universe
  const allCandidates = new Map<string, YahooCandidate>()

  for (const c of [...largeCaps, ...growthValue, ...losers]) {
    if (!allCandidates.has(c.symbol)) allCandidates.set(c.symbol, c)
  }

  // Add sector universe tickers (no PE/PB yet — will be filtered by FMP)
  for (const symbol of VALUE_SECTOR_UNIVERSE) {
    if (!allCandidates.has(symbol)) {
      allCandidates.set(symbol, {
        symbol,
        name: symbol,
        pe: null,
        pb: null,
        marketCap: 0,
        sector: null,
        source: 'sector_universe',
      })
    }
  }

  // Filter: for stocks where we have Yahoo data, apply value pre-filter
  // For sector universe stocks with no data, pass through to FMP for full check
  const filtered = [...allCandidates.values()].filter(c => {
    if (c.source === 'sector_universe') return true  // always pass through

    if (c.marketCap > 0 && c.marketCap < minMarketCap) return false
    if (c.pe !== null && c.pe > maxPE) return false
    if (c.pe !== null && c.pe <= 0) return false     // loss-making
    if (c.pb !== null && c.pb > maxPB) return false

    return true
  })

  return filtered.sort((a, b) => {
    // Yahoo screener stocks (with data) first, sector universe after
    if (a.source !== 'sector_universe' && b.source === 'sector_universe') return -1
    if (a.source === 'sector_universe' && b.source !== 'sector_universe') return 1
    return (a.pe ?? 99) - (b.pe ?? 99)  // lowest P/E first
  })
}
