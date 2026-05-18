export interface StockFundamentals {
  ticker: string
  name: string
  sector?: string
  industry?: string
  exchange?: string
  price: number
  marketCap?: number
  sharesOutstanding?: number

  // Valuation
  pe?: number
  pb?: number
  eps?: number
  bookValuePerShare?: number
  peg?: number                       // Lynch: P/E ÷ EPS growth rate
  earningsYield?: number             // Greenblatt: EBIT / EV (decimal)
  priceToFreeCashFlow?: number       // Dreman: P/FCF
  priceToOperatingCashFlow?: number  // Dreman: P/OCF
  enterpriseValue?: number
  ebitMargin?: number                // EBIT / Revenue

  // Balance Sheet Health
  currentRatio?: number
  debtToEquity?: number
  longTermDebt?: number
  currentAssets?: number
  currentLiabilities?: number
  netCurrentAssets?: number
  netCash?: number                   // Cash - Total Debt (Klarman liquidation floor)
  totalDebt?: number

  // Profitability
  roe?: number
  roic?: number
  netIncome?: number
  revenue?: number
  grossProfit?: number
  operatingIncome?: number
  grossMargin?: number
  operatingMargin?: number
  operatingMarginTrend?: 'improving' | 'declining' | 'stable'  // Fisher Point 5

  // Cash Flow
  operatingCashFlow?: number
  capitalExpenditures?: number
  maintenanceCapEx?: number          // min(CapEx, D&A) — Buffett owner earnings proxy
  freeCashFlow?: number
  depreciation?: number
  ownerEarnings?: number

  // Cyclicality
  normalizedEps?: number             // average EPS over cycle (used when isCyclical)
  isCyclical?: boolean               // coeff of variation of EPS > 0.4

  // Shiller CAPE (per-stock)
  shillerEps?: number                // 10-year CPI-adjusted avg EPS (Shiller denominator)
  capeRatio?: number                 // price / shillerEps — stock-level CAPE

  // NCAV / Net-Net screen (Graham's deepest value method)
  totalLiabilities?: number          // total liabilities (for NCAV)
  ncav?: number                      // current assets − total liabilities
  ncavPerShare?: number              // NCAV / shares outstanding
  isNetNet?: boolean                 // price < 0.67 × ncavPerShare (Graham two-thirds rule)

  // Management capital allocation quality
  shareCountCagr5yr?: number         // 5-yr CAGR of shares out (negative = buybacks)
  isDiluting?: boolean               // shareCountCagr5yr > 1% — management diluting holders

  // Business quality tier (drives sell threshold)
  businessTier?: BusinessTier

  // Owner earnings yield vs treasury spread (Buffett's equity-bond comparison)
  ownerEarningsYield?: number        // owner earnings per share / price (decimal)
  treasuryYield10yr?: number         // injected from macro context (decimal, e.g. 0.045)
  ownerEarningsSpread?: number       // ownerEarningsYield − treasuryYield10yr

  // Dividends
  dividendPerShare?: number
  dividendYield?: number

  // History (10 years)
  epsHistory?: YearlyValue[]
  revenueHistory?: YearlyValue[]
  fcfHistory?: YearlyValue[]
  dividendHistory?: YearlyValue[]
  bookValueHistory?: YearlyValue[]
  operatingMarginHistory?: YearlyValue[]
  roicHistory?: YearlyValue[]
  sharesHistory?: YearlyValue[]      // for share count trend analysis
}

// Business quality tier — drives sell threshold and conviction ceiling
// Buffett: wonderful companies warrant infinite patience; mediocre ones should be sold at par
export type BusinessTier = 'wonderful' | 'good' | 'adequate' | 'mediocre'

export interface YearlyValue {
  year: number
  value: number
}

export interface GrahamCriteria {
  passedPE: boolean
  passedPB: boolean
  passedGrahamProduct: boolean       // pe × pb ≤ 22.5 (Graham Ch.14 — the actual rule)
  passedCurrentRatio: boolean
  passedDebtToAssets: boolean
  passedEpsGrowth: boolean
  passedDividends: boolean           // soft signal only — not required for overallPass
  passedNoDeficit: boolean
  overallPass: boolean

  peValue?: number
  pbValue?: number
  currentRatioValue?: number
  debtToAssetsValue?: number
  epsGrowthValue?: number
  dividendYears?: number
  normalizedEpsGrowth?: number       // regression-based, used when isCyclical
}

export interface IntrinsicValueResult {
  grahamNumber?: number
  dcfValue?: number
  intrinsicValue: number
  currentPrice: number
  marginOfSafety: number
  isBuySignal: boolean
  ownerEarnings?: number
  growthRateUsed?: number
  discountRateUsed?: number
  terminalGrowth?: number
  // Shiller / forward-looking
  expectedCagr10yr?: number          // Buffett's question: what return am I locking in?
  shillerCapePriceTarget?: number    // fair value at Shiller's 20× long-run CAPE
}

export interface ScreenedStock {
  ticker: string
  name: string
  price: number
  criteria: GrahamCriteria
  intrinsicValue?: IntrinsicValueResult
  fundamentals: Partial<StockFundamentals>
}

export interface PortfolioPosition {
  id: string
  ticker: string
  name: string
  shares: number
  avgCostBasis: number
  currentPrice: number
  currentValue: number
  costBasis: number
  gainLoss: number
  gainLossPct: number
  intrinsicValue?: number
  marginOfSafety?: number
  firstPurchased: Date
}

export interface PortfolioSummary {
  totalValue: number
  totalCostBasis: number
  totalGainLoss: number
  totalGainLossPct: number
  positions: PortfolioPosition[]
  healthScore: number
  cashBalance?: number
}

export interface WatchlistEntry {
  id: string
  ticker: string
  name: string
  currentPrice: number
  targetPrice?: number
  intrinsicValue?: number
  marginOfSafety?: number
  isBuySignal: boolean
  addedAt: Date
  notes?: string
}

export interface Alert {
  id: string
  ticker: string
  type: 'margin_of_safety' | 'screener_pass' | 'fundamental_change'
  message: string
  severity: 'info' | 'warning' | 'buy'
  isRead: boolean
  createdAt: Date
}

export interface SchwabOrderRequest {
  ticker: string
  shares: number
  orderType: 'MARKET' | 'LIMIT'
  limitPrice?: number
  accountId: string
}

export interface SchwabPosition {
  ticker: string
  shares: number
  marketValue: number
  averagePrice: number
}

export interface SchwabAccount {
  accountId: string
  accountNumber: string
  type: string
  balance: {
    cashBalance: number
    totalValue: number
  }
  positions: SchwabPosition[]
}

export interface ApiError {
  error: string
  message: string
  status?: number
}

export type MetricTrend = 'up' | 'down' | 'flat'

export interface MetricCard {
  label: string
  value: string | number
  trend?: MetricTrend
  good?: boolean
  description?: string
}
