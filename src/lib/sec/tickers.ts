// SEC EDGAR company_tickers.json — full list of all US public companies
// Source: https://www.sec.gov/files/company_tickers.json
// Free, official, no API key needed. ~10,000 tickers.
// SEC requires a User-Agent header identifying your app.
//
// Also supports the exchange-specific endpoint (company_tickers_exchange.json)
// which gives ~5,000 exchange-listed stocks with exchange metadata.
// We use the full ticker list for Tier 2 discovery (50/day pre-filtered),
// and the exchange list for Tier 1 bulk seeding.

export interface SecTicker {
  cik?: number
  ticker: string
  name: string
  exchange?: string
}

// ── Full ticker list cache (company_tickers.json ~10k) ───────────────────────
let _fullCache: SecTicker[] | null = null
let _fullCacheExpiry = 0

export async function getSecTickers(): Promise<SecTicker[]> {
  if (_fullCache && Date.now() < _fullCacheExpiry) return _fullCache

  try {
    // Try the exchange-specific list first (better quality, has exchange field)
    const res = await fetch('https://www.sec.gov/files/company_tickers_exchange.json', {
      headers: {
        'User-Agent': 'value-investing-platform contact@rivalautomations.com',
        'Accept-Encoding': 'gzip, deflate',
      },
      next: { revalidate: 0 },
    })

    if (res.ok) {
      const json = await res.json()
      // Format: { fields: ["cik","name","ticker","exchange"], data: [[cik, name, ticker, exchange], ...] }
      const fields: string[] = json.fields
      const rows: any[][] = json.data

      const tickerIdx   = fields.indexOf('ticker')
      const nameIdx     = fields.indexOf('name')
      const exchangeIdx = fields.indexOf('exchange')
      const cikIdx      = fields.indexOf('cik')

      const VALID_EXCHANGES = new Set(['Nasdaq', 'NYSE', 'NYSE MKT', 'NYSE American', 'NYSE Arca', 'CBOE'])

      const tickers: SecTicker[] = rows
        .filter(row => {
          const exchange = row[exchangeIdx]
          const ticker   = row[tickerIdx]
          return (
            exchange &&
            VALID_EXCHANGES.has(exchange) &&
            ticker &&
            isCommonStock(ticker)
          )
        })
        .map(row => ({
          cik:      row[cikIdx] as number,
          ticker:   (row[tickerIdx] as string).toUpperCase().replace('.', '-'), // BRK.B → BRK-B
          name:     row[nameIdx] as string,
          exchange: row[exchangeIdx] as string,
        }))

      // Deduplicate by ticker
      const seen = new Set<string>()
      const unique = tickers.filter(t => {
        if (seen.has(t.ticker)) return false
        seen.add(t.ticker)
        return true
      })

      _fullCache = unique
      _fullCacheExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
      return unique
    }
  } catch {
    // fall through to full ticker list
  }

  // Fallback: company_tickers.json (broader ~10k, no exchange field)
  try {
    const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: {
        'User-Agent': 'value-investing-platform contact@rivalautomations.com',
        'Accept-Encoding': 'gzip, deflate',
      },
      next: { revalidate: 0 },
    })

    if (!res.ok) throw new Error(`SEC EDGAR fetch failed: ${res.status}`)

    const json = await res.json() as Record<string, { cik_str: number; ticker: string; title: string }>

    // Filter to clean US equity tickers only:
    // - No dots (removes some foreign ADR classes)
    // - No spaces
    // - 1-5 chars (removes warrants, units, rights which are longer)
    // - No digits in ticker (removes preferred share series like BRKB1)
    const tickers: SecTicker[] = Object.values(json)
      .map(e => ({
        cik:    e.cik_str,
        ticker: e.ticker.toUpperCase(),
        name:   e.title,
      }))
      .filter(e =>
        e.ticker.length >= 1 &&
        e.ticker.length <= 5 &&
        !e.ticker.includes('.') &&
        !e.ticker.includes(' ') &&
        !/\d/.test(e.ticker)
      )

    _fullCache = tickers
    _fullCacheExpiry = Date.now() + 24 * 60 * 60 * 1000 // 24 hours (less reliable endpoint)
    return tickers
  } catch {
    return _fullCache ?? []
  }
}

// ── Helper: exclude non-common-stock securities ───────────────────────────────
const EXCLUDE_SUFFIXES = ['W', 'WS', 'WA', 'WB', 'U', 'R', 'RT', 'P']

function isCommonStock(ticker: string): boolean {
  if (ticker.startsWith('^')) return false
  if (ticker.length > 6) return false
  const upper = ticker.toUpperCase()
  for (const suffix of EXCLUDE_SUFFIXES) {
    if (upper.endsWith(suffix) && upper.length > suffix.length + 1) return false
  }
  return true
}

// ── Daily batch selector ──────────────────────────────────────────────────────
// Get a deterministic daily batch of tickers not yet in the watchlist.
// Uses the calendar day number as offset so each day picks up where
// the previous left off — cycling through the full universe over time.
export function getDailyBatch(
  allTickers: SecTicker[],
  alreadyWatched: Set<string>,
  batchSize: number
): SecTicker[] {
  // Filter to tickers not yet on the watchlist
  const unseen = allTickers.filter(t => !alreadyWatched.has(t.ticker))
  if (unseen.length === 0) return []

  // Deterministic offset: advances by batchSize each day
  const dayN  = Math.floor(Date.now() / (24 * 60 * 60 * 1000))
  const start = (dayN * batchSize) % unseen.length

  // Wrap-around slice so we always return exactly batchSize (or fewer if universe is small)
  const batch = [
    ...unseen.slice(start, start + batchSize),
    ...unseen.slice(0, Math.max(0, start + batchSize - unseen.length)),
  ]
  return batch.slice(0, batchSize)
}
