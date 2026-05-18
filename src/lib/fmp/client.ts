import axios, { AxiosInstance } from 'axios'
import type { StockFundamentals, YearlyValue } from '@/types'
import { detectCyclicality, normalizeEps } from '@/lib/graham/intrinsic-value'

const BASE_URL = 'https://financialmodelingprep.com/api/v3'

// ─── In-memory TTL cache ───────────────────────────────────────────────────────
// Persists across requests on Railway's always-on server.
// Prevents redundant FMP API calls for the same ticker within the window.

interface CacheEntry<T> { data: T; expiresAt: number }
class TTLCache {
  private store = new Map<string, CacheEntry<unknown>>()
  get<T>(key: string): T | null {
    const entry = this.store.get(key)
    if (!entry || Date.now() > entry.expiresAt) { this.store.delete(key); return null }
    return entry.data as T
  }
  set<T>(key: string, data: T, ttlMs: number) {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs })
  }
}

const cache = new TTLCache()
const FUNDAMENTALS_TTL = 4 * 60 * 60 * 1000  // 4 hours
const NEWS_TTL         = 30 * 60 * 1000        // 30 minutes

// ─── Rate limiter ─────────────────────────────────────────────────────────────

class FMPRateLimiter {
  private queue: Array<() => Promise<unknown>> = []
  private running = 0
  private readonly maxConcurrent = 3
  private readonly minDelayMs = 334

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try { resolve(await fn()) } catch (e) { reject(e) }
      })
      this.drain()
    })
  }

  private async drain() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) return
    this.running++
    const task = this.queue.shift()!
    await task()
    await new Promise((r) => setTimeout(r, this.minDelayMs))
    this.running--
    this.drain()
  }
}

const rateLimiter = new FMPRateLimiter()

function createClient(): AxiosInstance {
  return axios.create({
    baseURL: BASE_URL,
    params: { apikey: process.env.FMP_API_KEY },
    timeout: 15000,
  })
}

const fmp = createClient()

async function get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  return rateLimiter.schedule(async () => {
    const res = await fmp.get<T>(path, { params })
    return res.data
  })
}

// ─── Profile ──────────────────────────────────────────────────────────────────

interface FMPProfile {
  symbol: string
  companyName: string
  sector: string
  industry: string
  exchangeShortName: string
  price: number
  mktCap: number
  beta: number
}

export async function getProfile(ticker: string): Promise<FMPProfile | null> {
  const data = await get<FMPProfile[]>(`/profile/${ticker.toUpperCase()}`)
  return data?.[0] ?? null
}

// ─── Income Statement ─────────────────────────────────────────────────────────

interface FMPIncomeStatement {
  date: string
  calendarYear: string
  period: string
  revenue: number
  grossProfit: number
  operatingIncome: number
  ebitda: number
  netIncome: number
  eps: number
  epsdiluted: number
  dividendPerShareTTM?: number
}

export async function getIncomeStatements(ticker: string, limit = 10): Promise<FMPIncomeStatement[]> {
  return get<FMPIncomeStatement[]>(`/income-statement/${ticker.toUpperCase()}`, { limit })
}

// ─── Balance Sheet ────────────────────────────────────────────────────────────

interface FMPBalanceSheet {
  date: string
  calendarYear: string
  totalAssets: number
  totalLiabilities: number
  totalStockholdersEquity: number
  bookValuePerShare: number
  totalCurrentAssets: number
  totalCurrentLiabilities: number
  longTermDebt: number
  shortTermDebt: number
  totalDebt: number
  cashAndCashEquivalents: number
  commonStock: number
  retainedEarnings: number
}

export async function getBalanceSheets(ticker: string, limit = 10): Promise<FMPBalanceSheet[]> {
  return get<FMPBalanceSheet[]>(`/balance-sheet-statement/${ticker.toUpperCase()}`, { limit })
}

// ─── Cash Flow ────────────────────────────────────────────────────────────────

interface FMPCashFlow {
  date: string
  calendarYear: string
  operatingCashFlow: number
  capitalExpenditure: number
  freeCashFlow: number
  depreciationAndAmortization: number
}

export async function getCashFlows(ticker: string, limit = 10): Promise<FMPCashFlow[]> {
  return get<FMPCashFlow[]>(`/cash-flow-statement/${ticker.toUpperCase()}`, { limit })
}

// ─── Key Metrics ──────────────────────────────────────────────────────────────

interface FMPKeyMetrics {
  date: string
  calendarYear: string
  peRatio: number
  pbRatio: number
  debtToEquity: number
  currentRatio: number
  roe: number
  roic: number
  dividendYield: number
  priceToBookRatio: number
  enterpriseValueOverEBITDA: number
  // Extended fields FMP provides
  earningsYield: number                // EBIT / EV — Greenblatt Magic Formula
  priceToFreeCashFlowsRatio: number    // P/FCF — Dreman
  priceToOperatingCashFlowsRatio: number // P/OCF
  enterpriseValue: number
  pegRatio: number                     // Lynch
}

export async function getKeyMetrics(ticker: string, limit = 10): Promise<FMPKeyMetrics[]> {
  return get<FMPKeyMetrics[]>(`/key-metrics/${ticker.toUpperCase()}`, { limit })
}

// ─── Dividend History ─────────────────────────────────────────────────────────

interface FMPDividend {
  date: string
  adjDividend: number
  dividend: number
  label: string
  recordDate: string
  paymentDate: string
  declarationDate: string
}

export async function getDividendHistory(ticker: string): Promise<FMPDividend[]> {
  return get<FMPDividend[]>(`/historical-price-full/stock_dividend/${ticker.toUpperCase()}`)
    .then((d: any) => d?.historical ?? [])
}

// ─── Quote ────────────────────────────────────────────────────────────────────

interface FMPQuote {
  symbol: string
  price: number
  changesPercentage: number
  change: number
  marketCap: number
  sharesOutstanding: number
  eps: number
  pe: number
}

export async function getQuote(ticker: string): Promise<FMPQuote | null> {
  const data = await get<FMPQuote[]>(`/quote/${ticker.toUpperCase()}`)
  return data?.[0] ?? null
}

// ─── News ─────────────────────────────────────────────────────────────────────

export interface FMPNewsItem {
  symbol: string
  publishedDate: string
  title: string
  image: string
  site: string
  text: string
  url: string
}

// Keywords that trigger a hard-veto alert — management/accounting events that
// permanently impair trust per Fisher Point 14, SA management integrity, BL 2002.
const HARD_VETO_KEYWORDS = [
  'sec investigation', 'sec charges', 'fraud', 'accounting irregularit',
  'restatement', 'restate', 'material weakness', 'going concern',
  'bankruptcy', 'chapter 11', 'doj investigation', 'class action',
  'insider trading', 'audit failure', 'whistleblower', 'delisted',
  'ponzi', 'embezzlement', 'earnings manipulation',
]

// Keywords that signal moat/business disruption — Munger circle of competence,
// BL 1985 franchise value, BL 2017 moat widening.
const DISRUPTION_KEYWORDS = [
  'market share loss', 'losing customers', 'major competitor', 'disrupted',
  'obsolete', 'regulatory ban', 'product recall', 'patent expiry',
  'disruptive technology', 'losing ground',
]

export interface NewsAnalysis {
  items: FMPNewsItem[]
  hardVetoFlags: string[]   // titles of items matching hard-veto keywords
  disruptionFlags: string[] // titles of items matching disruption keywords
  sentiment: 'negative' | 'neutral' | 'positive'
}

export async function getTickerNews(ticker: string, limit = 15): Promise<NewsAnalysis> {
  const cacheKey = `news:${ticker.toUpperCase()}`
  const cached = cache.get<NewsAnalysis>(cacheKey)
  if (cached) return cached

  let items: FMPNewsItem[] = []
  try {
    items = await get<FMPNewsItem[]>('/stock_news', {
      tickers: ticker.toUpperCase(),
      limit,
    })
  } catch {
    // news is best-effort; don't block fundamentals on failure
  }

  // FIX #14: Negation-aware keyword detection.
  // Old code fired on "Company X avoids SEC investigation" or "no fraud found."
  // Now checks for negation words within 35 chars before the veto keyword.
  const NEGATION_PREFIXES = [
    'no ', 'not ', 'avoids ', 'avoid ', 'cleared ', 'clears ', 'dismisses ', 'dismissed ',
    'denies ', 'denied ', 'denying ', 'rejects ', 'rejected ', 'without ', 'finds no ',
    'found no ', 'no evidence of ', 'ruled out ', 'no sign of ', 'acquitted ',
  ]

  function hasKeywordWithoutNegation(text: string, keyword: string): boolean {
    let pos = text.indexOf(keyword)
    while (pos !== -1) {
      const context = text.substring(Math.max(0, pos - 40), pos)
      const negated = NEGATION_PREFIXES.some(neg => context.endsWith(neg) || context.includes(neg))
      if (!negated) return true
      pos = text.indexOf(keyword, pos + 1)
    }
    return false
  }

  const hardVetoFlags: string[] = []
  const disruptionFlags: string[] = []

  for (const item of items) {
    const combined = `${item.title} ${item.text ?? ''}`.toLowerCase()
    if (HARD_VETO_KEYWORDS.some((kw) => hasKeywordWithoutNegation(combined, kw))) {
      hardVetoFlags.push(item.title)
    }
    if (DISRUPTION_KEYWORDS.some((kw) => combined.includes(kw))) {
      disruptionFlags.push(item.title)
    }
  }

  // Simple sentiment heuristic: hard-veto flags dominate; otherwise count
  // negative/positive signal words in recent headlines.
  const negativeWords = ['decline', 'miss', 'warning', 'cut', 'fall', 'drop', 'loss', 'concern', 'risk', 'weak']
  const positiveWords = ['beat', 'record', 'growth', 'strong', 'raise', 'upgrade', 'expansion', 'profit', 'exceed']
  let negCount = 0, posCount = 0
  for (const item of items.slice(0, 8)) {
    const t = item.title.toLowerCase()
    negativeWords.forEach((w) => { if (t.includes(w)) negCount++ })
    positiveWords.forEach((w) => { if (t.includes(w)) posCount++ })
  }

  const sentiment: NewsAnalysis['sentiment'] =
    hardVetoFlags.length > 0 ? 'negative'
    : negCount > posCount + 2 ? 'negative'
    : posCount > negCount + 2 ? 'positive'
    : 'neutral'

  const result: NewsAnalysis = { items, hardVetoFlags, disruptionFlags, sentiment }
  cache.set(cacheKey, result, NEWS_TTL)
  return result
}

// ─── Screener ─────────────────────────────────────────────────────────────────

interface FMPScreenerResult {
  symbol: string
  companyName: string
  marketCap: number
  sector: string
  industry: string
  beta: number
  price: number
  lastAnnualDividend: number
  volume: number
  exchangeShortName: string
  country: string
  isEtf: boolean
  isFund: boolean
  isActivelyTrading: boolean
}

export async function screenStocks(params: {
  marketCapMoreThan?: number
  marketCapLessThan?: number
  betaLessThan?: number
  dividendMoreThan?: number
  exchange?: string
  limit?: number
}): Promise<FMPScreenerResult[]> {
  return get<FMPScreenerResult[]>('/stock-screener', {
    ...params,
    limit: params.limit ?? 250,
    isActivelyTrading: true,
    isEtf: false,
    isFund: false,
    country: 'US',
  })
}

// ─── Composite Fundamentals ───────────────────────────────────────────────────

export async function getCompleteFundamentals(ticker: string): Promise<StockFundamentals> {
  const cacheKey = `fundamentals:${ticker.toUpperCase()}`
  const cached = cache.get<StockFundamentals>(cacheKey)
  if (cached) return cached

  const [profile, incomeStmts, balanceSheets, cashFlows, keyMetrics, dividends, quote] =
    await Promise.all([
      getProfile(ticker),
      getIncomeStatements(ticker, 10),
      getBalanceSheets(ticker, 10),
      getCashFlows(ticker, 10),
      getKeyMetrics(ticker, 10),
      getDividendHistory(ticker),
      getQuote(ticker),
    ])

  const latest = {
    income: incomeStmts[0],
    balance: balanceSheets[0],
    cashFlow: cashFlows[0],
    metrics: keyMetrics[0],
  }

  const price = quote?.price ?? profile?.price ?? 0
  const shares = quote?.sharesOutstanding ?? 0

  // FIX #2: Owner Earnings uses maintenance CapEx, not total CapEx.
  // Buffett 1986 letter: owner earnings = net income + D&A - *maintenance* CapEx.
  // Maintenance CapEx = spending to maintain current earning power = min(CapEx, D&A).
  // Growth CapEx (total - maintenance) is optional spending, not a cost of owning the business.
  const da = latest.cashFlow?.depreciationAndAmortization ?? 0
  const totalCapEx = Math.abs(latest.cashFlow?.capitalExpenditure ?? 0)
  const maintenanceCapEx = Math.min(totalCapEx, da)
  const ownerEarnings =
    latest.income && latest.cashFlow
      ? latest.income.netIncome + da - maintenanceCapEx
      : undefined

  // FIX #13: Use working capital (current assets - current liabilities) consistently.
  // Old code subtracted totalLiabilities (all debt) which is NCAV, a different metric.
  // Graham's Ch.14 debt test uses working capital; NCAV is the separate net-net screen.
  const netCurrentAssets =
    latest.balance
      ? latest.balance.totalCurrentAssets - latest.balance.totalCurrentLiabilities
      : undefined

  // Net cash = cash - total debt (Klarman liquidation floor)
  const netCash =
    latest.balance
      ? (latest.balance.cashAndCashEquivalents ?? 0) - (latest.balance.totalDebt ?? latest.balance.longTermDebt ?? 0)
      : undefined

  // Margins
  const operatingMargin =
    latest.income?.revenue && latest.income.revenue > 0
      ? latest.income.operatingIncome / latest.income.revenue
      : undefined
  const grossMargin =
    latest.income?.revenue && latest.income.revenue > 0
      ? latest.income.grossProfit / latest.income.revenue
      : undefined
  const ebitMargin =
    latest.income?.revenue && latest.income.revenue > 0
      ? latest.income.operatingIncome / latest.income.revenue  // EBIT ≈ operating income
      : undefined

  // Operating margin trend (Fisher Point 5): compare last 3 years vs prior 4 years
  const opMarginHistory: YearlyValue[] = incomeStmts
    .filter((s) => s.revenue > 0)
    .map((s) => ({ year: parseInt(s.calendarYear), value: s.operatingIncome / s.revenue }))
    .filter((v) => !isNaN(v.year))
    .reverse()

  let operatingMarginTrend: 'improving' | 'declining' | 'stable' = 'stable'
  if (opMarginHistory.length >= 5) {
    const recent = opMarginHistory.slice(-3).map((v) => v.value)
    const prior  = opMarginHistory.slice(-7, -3).map((v) => v.value)
    if (recent.length && prior.length) {
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length
      const priorAvg  = prior.reduce((a, b) => a + b, 0) / prior.length
      if (recentAvg > priorAvg * 1.05) operatingMarginTrend = 'improving'
      else if (recentAvg < priorAvg * 0.95) operatingMarginTrend = 'declining'
    }
  }

  // PEG: P/E ÷ EPS growth rate
  // Use FMP's field if available; otherwise compute from history
  let peg = latest.metrics?.pegRatio ?? undefined
  if (!peg && quote?.pe && quote.pe > 0) {
    const epsHist = incomeStmts
      .map((s) => ({ year: parseInt(s.calendarYear), value: s.epsdiluted }))
      .filter((v) => !isNaN(v.year) && v.value > 0)
      .reverse()
    if (epsHist.length >= 2) {
      const first = epsHist[0].value
      const last  = epsHist[epsHist.length - 1].value
      const years = epsHist[epsHist.length - 1].year - epsHist[0].year
      if (years > 0 && first > 0) {
        const cagr = (Math.pow(last / first, 1 / years) - 1) * 100
        if (cagr > 0) peg = quote.pe / cagr
      }
    }
  }

  // FIX #5: Use nullish coalescing (??) not logical OR (||).
  // earningsYield = 0 is a valid (meaningful) value for a breakeven company.
  // `0 || undefined` silently drops it; `0 ?? undefined` preserves it.
  const earningsYield = latest.metrics?.earningsYield ?? undefined

  const priceToFreeCashFlow      = latest.metrics?.priceToFreeCashFlowsRatio ?? undefined
  const priceToOperatingCashFlow = latest.metrics?.priceToOperatingCashFlowsRatio ?? undefined

  // Build history arrays
  const epsHistory: YearlyValue[] = incomeStmts
    .map((s) => ({ year: parseInt(s.calendarYear), value: s.epsdiluted }))
    .filter((v) => !isNaN(v.year) && v.value != null)
    .reverse()

  const revenueHistory: YearlyValue[] = incomeStmts
    .map((s) => ({ year: parseInt(s.calendarYear), value: s.revenue }))
    .filter((v) => !isNaN(v.year) && v.value != null)
    .reverse()

  const fcfHistory: YearlyValue[] = cashFlows
    .map((s) => ({ year: parseInt(s.calendarYear), value: s.freeCashFlow }))
    .filter((v) => !isNaN(v.year) && v.value != null)
    .reverse()

  const bookValueHistory: YearlyValue[] = balanceSheets
    .map((s) => ({ year: parseInt(s.calendarYear), value: s.bookValuePerShare }))
    .filter((v) => !isNaN(v.year) && v.value != null)
    .reverse()

  const roicHistory: YearlyValue[] = keyMetrics
    .map((m) => ({ year: parseInt(m.calendarYear), value: m.roic }))
    .filter((v) => !isNaN(v.year) && v.value != null)
    .reverse()

  const dividendYears = new Set(dividends.map((d) => new Date(d.date).getFullYear())).size

  const dividendHistory: YearlyValue[] = dividends
    .reduce((acc: YearlyValue[], d) => {
      const year = new Date(d.date).getFullYear()
      const existing = acc.find((v) => v.year === year)
      if (existing) existing.value += d.dividend
      else acc.push({ year, value: d.dividend })
      return acc
    }, [])
    .sort((a, b) => a.year - b.year)
    .slice(-10)

  const result: StockFundamentals = {
    ticker: ticker.toUpperCase(),
    name: profile?.companyName ?? ticker,
    sector: profile?.sector,
    industry: profile?.industry,
    exchange: profile?.exchangeShortName,
    price,
    marketCap: profile?.mktCap ?? quote?.marketCap,
    sharesOutstanding: shares,

    pe: latest.metrics?.peRatio ?? quote?.pe,
    pb: latest.metrics?.pbRatio,
    eps: latest.income?.epsdiluted ?? quote?.eps,
    bookValuePerShare: latest.balance?.bookValuePerShare,
    peg,
    earningsYield,
    priceToFreeCashFlow,
    priceToOperatingCashFlow,
    enterpriseValue: latest.metrics?.enterpriseValue,
    ebitMargin,

    currentRatio: latest.metrics?.currentRatio,
    debtToEquity: latest.metrics?.debtToEquity,
    longTermDebt: latest.balance?.longTermDebt,
    totalDebt: latest.balance?.totalDebt,
    currentAssets: latest.balance?.totalCurrentAssets,
    currentLiabilities: latest.balance?.totalCurrentLiabilities,
    netCurrentAssets,
    netCash,

    roe: latest.metrics?.roe,
    roic: latest.metrics?.roic,
    netIncome: latest.income?.netIncome,
    revenue: latest.income?.revenue,
    grossProfit: latest.income?.grossProfit,
    operatingIncome: latest.income?.operatingIncome,
    grossMargin,
    operatingMargin,
    operatingMarginTrend,

    operatingCashFlow: latest.cashFlow?.operatingCashFlow,
    capitalExpenditures: latest.cashFlow?.capitalExpenditure,
    maintenanceCapEx,
    freeCashFlow: latest.cashFlow?.freeCashFlow,
    depreciation: latest.cashFlow?.depreciationAndAmortization,
    ownerEarnings,

    dividendPerShare: latest.income?.dividendPerShareTTM,
    dividendYield: latest.metrics?.dividendYield,

    epsHistory,
    revenueHistory,
    fcfHistory,
    dividendHistory,
    bookValueHistory,
    operatingMarginHistory: opMarginHistory,
    roicHistory,

    // FIX #9: Cyclical businesses need normalized earnings to avoid peak-cycle traps
    isCyclical: epsHistory.length >= 5 ? detectCyclicality(epsHistory) : false,
    normalizedEps: epsHistory.length >= 5 ? normalizeEps(epsHistory) : undefined,
  }

  cache.set(cacheKey, result, FUNDAMENTALS_TTL)
  return result
}

// ─── Insider Transactions ─────────────────────────────────────────────────────
export interface InsiderTransaction {
  symbol: string
  filingDate: string
  transactionDate: string
  reportingName: string
  transactionType: string  // 'P-Purchase' | 'S-Sale' | etc
  securitiesTransacted: number
  price: number
  securitiesOwned: number
  typeOfOwner: string  // 'director' | 'officer' | 'other'
}

const INSIDER_TTL = 6 * 60 * 60 * 1000  // 6 hours

export async function getInsiderTransactions(ticker: string, limit = 20): Promise<InsiderTransaction[]> {
  const cacheKey = `insider:${ticker.toUpperCase()}`
  const cached = cache.get<InsiderTransaction[]>(cacheKey)
  if (cached) return cached
  try {
    const data = await get<InsiderTransaction[]>(`/insider-trading`, { symbol: ticker.toUpperCase(), limit })
    const result = Array.isArray(data) ? data : []
    cache.set(cacheKey, result, INSIDER_TTL)
    return result
  } catch { return [] }
}

// ─── Earnings Calendar ────────────────────────────────────────────────────────
export interface EarningsEvent {
  date: string
  symbol: string
  eps: number | null
  epsEstimated: number | null
  revenue: number | null
  revenueEstimated: number | null
  time: string  // 'bmo' | 'amc' | 'dmh'
  fiscalDateEnding: string
}

export async function getEarningsCalendar(ticker: string): Promise<EarningsEvent[]> {
  const cacheKey = `earnings:${ticker.toUpperCase()}`
  const cached = cache.get<EarningsEvent[]>(cacheKey)
  if (cached) return cached
  try {
    const data = await get<EarningsEvent[]>(`/historical/earning_calendar/${ticker.toUpperCase()}`, { limit: 8 })
    const result = Array.isArray(data) ? data : []
    cache.set(cacheKey, result, FUNDAMENTALS_TTL)
    return result
  } catch { return [] }
}

// ─── Historical Valuation Bands ───────────────────────────────────────────────
export interface ValuationBand {
  year: number
  pe: number | null
  pb: number | null
  ps: number | null
  pfcf: number | null
}

export async function getHistoricalValuationBands(ticker: string): Promise<ValuationBand[]> {
  const cacheKey = `valbands:${ticker.toUpperCase()}`
  const cached = cache.get<ValuationBand[]>(cacheKey)
  if (cached) return cached
  try {
    const data = await get<any[]>(`/key-metrics/${ticker.toUpperCase()}`, { limit: 10 })
    const result = (Array.isArray(data) ? data : []).map((m: any) => ({
      year: parseInt(m.calendarYear ?? m.date?.slice(0,4)),
      pe: m.peRatio ?? null,
      pb: m.pbRatio ?? null,
      ps: m.priceToSalesRatio ?? null,
      pfcf: m.priceToFreeCashFlowsRatio ?? null,
    })).filter((v: ValuationBand) => !isNaN(v.year)).reverse()
    cache.set(cacheKey, result, FUNDAMENTALS_TTL)
    return result
  } catch { return [] }
}

// ─── Stock Peers ──────────────────────────────────────────────────────────────
export interface StockPeer {
  symbol: string
}

export async function getStockPeers(ticker: string): Promise<string[]> {
  const cacheKey = `peers:${ticker.toUpperCase()}`
  const cached = cache.get<string[]>(cacheKey)
  if (cached) return cached
  try {
    const data = await get<any>(`/stock_peers`, { symbol: ticker.toUpperCase() })
    const peers: string[] = data?.[0]?.peersList ?? []
    cache.set(cacheKey, peers, FUNDAMENTALS_TTL)
    return peers.slice(0, 6)
  } catch { return [] }
}

// ─── Historical Price (for performance chart vs SPY) ─────────────────────────
export interface DailyPrice {
  date: string
  close: number
}

const PRICE_TTL = 60 * 60 * 1000  // 1 hour

export async function getHistoricalPrices(ticker: string, from: string, to: string): Promise<DailyPrice[]> {
  const cacheKey = `prices:${ticker.toUpperCase()}:${from}:${to}`
  const cached = cache.get<DailyPrice[]>(cacheKey)
  if (cached) return cached
  try {
    const data = await get<any>(`/historical-price-full/${ticker.toUpperCase()}`, { from, to })
    const result: DailyPrice[] = (data?.historical ?? []).map((d: any) => ({ date: d.date, close: d.close })).reverse()
    cache.set(cacheKey, result, PRICE_TTL)
    return result
  } catch { return [] }
}
