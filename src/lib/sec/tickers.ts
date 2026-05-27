// SEC EDGAR full US ticker universe
// Source: https://www.sec.gov/files/company_tickers_exchange.json
// Free, official, no API key needed. Updated daily by SEC.
// ~5,000 exchange-listed US common stocks across NYSE, Nasdaq, NYSE American.

interface SecTicker {
  ticker: string
  name: string
  exchange: string
}

let _cache: { data: SecTicker[]; expiresAt: number } | null = null
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days — list doesn't change often

// Ticker suffixes that indicate non-common-stock securities to exclude
const EXCLUDE_SUFFIXES = ['W', 'WS', 'WA', 'WB', 'U', 'R', 'RT', 'P', 'A', 'B']

function isCommonStock(ticker: string): boolean {
  // Exclude indices, ETFs signaled by ^ prefix
  if (ticker.startsWith('^')) return false
  // Exclude tickers with dots (preferred shares, foreign ordinaries: BRK.A, BRK.B)
  // Actually keep these — BRK.B is valid but our DB uses BRK-B format
  // Exclude obvious warrants/units by suffix pattern
  const upper = ticker.toUpperCase()
  for (const suffix of EXCLUDE_SUFFIXES) {
    if (upper.endsWith(suffix) && upper.length > suffix.length + 1) return false
  }
  // Keep only reasonable ticker lengths
  if (ticker.length > 6) return false
  return true
}

export async function getSecTickers(): Promise<SecTicker[]> {
  if (_cache && Date.now() < _cache.expiresAt) return _cache.data

  try {
    const res = await fetch('https://www.sec.gov/files/company_tickers_exchange.json', {
      headers: { 'User-Agent': 'RivalLongTradeCenter contact@rivalautomations.com' },
      next: { revalidate: 0 },
    })
    if (!res.ok) throw new Error(`SEC EDGAR fetch failed: ${res.status}`)

    const json = await res.json()
    // Format: { fields: ["cik","name","ticker","exchange"], data: [[cik, name, ticker, exchange], ...] }
    const fields: string[] = json.fields
    const rows: any[][] = json.data

    const tickerIdx = fields.indexOf('ticker')
    const nameIdx = fields.indexOf('name')
    const exchangeIdx = fields.indexOf('exchange')

    // Keep only major US exchanges
    const VALID_EXCHANGES = new Set(['Nasdaq', 'NYSE', 'NYSE MKT', 'NYSE American', 'NYSE Arca', 'CBOE'])

    const tickers: SecTicker[] = rows
      .filter(row => {
        const exchange = row[exchangeIdx]
        const ticker = row[tickerIdx]
        return exchange && VALID_EXCHANGES.has(exchange) && ticker && isCommonStock(ticker)
      })
      .map(row => ({
        ticker: (row[tickerIdx] as string).toUpperCase().replace('.', '-'), // BRK.B → BRK-B
        name: row[nameIdx] as string,
        exchange: row[exchangeIdx] as string,
      }))

    // Deduplicate by ticker
    const seen = new Set<string>()
    const unique = tickers.filter(t => {
      if (seen.has(t.ticker)) return false
      seen.add(t.ticker)
      return true
    })

    _cache = { data: unique, expiresAt: Date.now() + CACHE_TTL }
    return unique
  } catch {
    return _cache?.data ?? []
  }
}
