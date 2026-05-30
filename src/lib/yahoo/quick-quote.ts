// Lightweight Yahoo Finance quote fetcher for pre-filtering SEC EDGAR tickers.
//
// Fetches minimal data (price, PE, PB, marketCap, quoteType) using yahoo-finance2's
// quoteSummary — no API key required. Used by Tier 2 discovery to pre-filter 50
// tickers/day before adding value candidates to the watchlist.
//
// Concurrency limited to 5 parallel requests to avoid Yahoo rate limiting.
// 200ms delay between batches as a courtesy.

import YahooFinance from 'yahoo-finance2'

let _yf: InstanceType<typeof YahooFinance> | null = null
function yf(): InstanceType<typeof YahooFinance> {
  if (!_yf) _yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] })
  return _yf
}

export interface QuickQuote {
  ticker: string
  name: string
  price: number
  marketCap: number
  pe: number | null
  pb: number | null
  quoteType: string
  sector: string | null
}

async function fetchOneQuote(ticker: string): Promise<QuickQuote | null> {
  try {
    const summary = await (yf() as any).quoteSummary(ticker, {
      modules: ['price', 'summaryDetail', 'defaultKeyStatistics'],
    }, { validateResult: false })

    const price = summary?.price
    if (!price?.regularMarketPrice) return null

    return {
      ticker,
      name:       price.shortName ?? price.longName ?? ticker,
      price:      price.regularMarketPrice ?? 0,
      marketCap:  price.marketCap ?? 0,
      pe:         summary?.summaryDetail?.trailingPE ?? null,
      pb:         summary?.defaultKeyStatistics?.priceToBook ?? null,
      quoteType:  price.quoteType ?? '',
      sector:     null, // not cheaply available in these modules
    }
  } catch {
    return null
  }
}

// Fetch quotes for multiple tickers with a concurrency limit.
// Returns only the tickers that had valid price data.
export async function getQuickQuotes(tickers: string[], concurrency = 5): Promise<QuickQuote[]> {
  const results: QuickQuote[] = []

  for (let i = 0; i < tickers.length; i += concurrency) {
    const batch   = tickers.slice(i, i + concurrency)
    const settled = await Promise.allSettled(batch.map(t => fetchOneQuote(t)))

    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value)
    }

    // Small courtesy delay between batches
    if (i + concurrency < tickers.length) {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  return results
}
