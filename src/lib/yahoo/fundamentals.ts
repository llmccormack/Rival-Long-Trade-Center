// Yahoo Finance fundamentals fetcher — free, unlimited, no API key required
//
// Replaces the 7-call FMP getCompleteFundamentals() with a single quoteSummary
// call that returns all the same fields needed by scorer.ts, intrinsic-value.ts,
// and graham/screener.ts.
//
// API call budget: 1 Yahoo call per ticker (vs 7 FMP calls).
// Cache: 15-minute in-memory TTL (same as original FMP target).

import createYahooFinance from 'yahoo-finance2'
import type { StockFundamentals, YearlyValue, BusinessTier } from '@/types'
import { detectCyclicality, normalizeEps } from '@/lib/graham/intrinsic-value'
import { classifyBusinessQuality } from '@/lib/graham/business-quality'

// ─── Singleton ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _yf: any = null
function yf(): any {
  // createYahooFinance is the class constructor in v3
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!_yf) _yf = new (createYahooFinance as any)({ suppressNotices: ['yahooSurvey'] })
  return _yf
}

// ─── Cache ─────────────────────────────────────────────────────────────────────

const cache = new Map<string, { data: StockFundamentals; expiresAt: number }>()
const CACHE_TTL = 15 * 60 * 1000 // 15 minutes

// ─── Business tier inference ───────────────────────────────────────────────────

function inferBusinessTier(f: Partial<StockFundamentals>): BusinessTier {
  const roe    = f.roe ?? 0
  const roic   = f.roic ?? 0
  const margin = f.operatingMargin ?? 0
  const de     = f.debtToEquity ?? 0
  if (roe > 0.15 && roic > 0.12 && margin > 0.15 && de < 1.0) return 'wonderful'
  if (roe > 0.10 && roic > 0.08 && margin > 0.08) return 'good'
  if (roe > 0.04) return 'adequate'
  return 'mediocre'
}

// ─── Main export ───────────────────────────────────────────────────────────────

export async function getYahooFundamentals(ticker: string): Promise<StockFundamentals> {
  const key = ticker.toUpperCase()

  // Cache hit
  const cached = cache.get(key)
  if (cached && Date.now() < cached.expiresAt) return cached.data

  try {
    const summary = await yf().quoteSummary(key, {
      modules: [
        'price',
        'summaryDetail',
        'defaultKeyStatistics',
        'financialData',
        'assetProfile',
        'incomeStatementHistory',
        'balanceSheetHistory',
        'cashflowStatementHistory',
        'earnings',
      ],
    } as any, { validateResult: false } as any)

    // ── Convenience aliases ──────────────────────────────────────────────────
    const pr   = summary.price             as any
    const sd   = summary.summaryDetail     as any
    const ks   = summary.defaultKeyStatistics as any
    const fd   = summary.financialData     as any
    const ap   = summary.assetProfile      as any
    const ish  = summary.incomeStatementHistory as any
    const bsh  = summary.balanceSheetHistory   as any
    const cfh  = summary.cashflowStatementHistory as any

    // ── Price / identity ─────────────────────────────────────────────────────
    const price:      number          = pr?.regularMarketPrice ?? 0
    const name:       string          = pr?.shortName ?? pr?.longName ?? key
    const exchange:   string | undefined = pr?.exchangeName ?? undefined
    const marketCap:  number | undefined = pr?.marketCap ?? undefined
    const sector:     string | undefined = ap?.sector ?? undefined
    const industry:   string | undefined = ap?.industry ?? undefined

    // ── Valuation multiples ──────────────────────────────────────────────────
    const trailingPE = sd?.trailingPE
    const pe:   number | undefined = trailingPE && trailingPE > 0 ? trailingPE : undefined
    const pb:   number | undefined = ks?.priceToBook ?? undefined
    const eps:  number | undefined = ks?.trailingEps ?? undefined
    const bookValuePerShare: number | undefined = ks?.bookValue ?? undefined
    const pegRaw = ks?.pegRatio
    const peg: number | undefined = pegRaw && pegRaw > 0 ? pegRaw : undefined
    const sharesOutstanding: number | undefined = ks?.sharesOutstanding ?? undefined
    const enterpriseValue:   number | undefined = ks?.enterpriseValue   ?? undefined
    const netIncome:         number | undefined = ks?.netIncomeToCommon  ?? undefined

    // ── Dividend ─────────────────────────────────────────────────────────────
    const dividendYieldRaw = sd?.dividendYield  // already decimal (e.g. 0.03)
    const dividendYield: number | undefined    = dividendYieldRaw ?? undefined
    const dividendPerShare: number | undefined = sd?.dividendRate ?? undefined

    // ── Financial health ─────────────────────────────────────────────────────
    const currentRatio: number | undefined = fd?.currentRatio ?? undefined
    // Yahoo reports debtToEquity as a percentage (e.g. 150 = 1.5×); divide by 100
    const debtToEquityRaw = fd?.debtToEquity
    const debtToEquity: number | undefined =
      debtToEquityRaw != null ? debtToEquityRaw / 100 : undefined
    const roe:            number | undefined = fd?.returnOnEquity  ?? undefined
    const grossMargin:    number | undefined = fd?.grossMargins    ?? undefined
    const operatingMargin:number | undefined = fd?.operatingMargins ?? undefined
    const operatingCashFlow: number | undefined = fd?.operatingCashflow ?? undefined
    const freeCashFlow:      number | undefined = fd?.freeCashflow      ?? undefined
    const revenue:           number | undefined = fd?.totalRevenue       ?? undefined
    const totalDebt:         number | undefined = fd?.totalDebt          ?? undefined
    const grossProfit:       number | undefined = fd?.grossProfits       ?? undefined
    const totalCash:         number             = fd?.totalCash          ?? 0

    // ── Balance sheet (most recent annual) ───────────────────────────────────
    const balanceSheet = bsh?.balanceSheetStatements?.[0] as any
    const totalAssets:        number | undefined = balanceSheet?.totalAssets           ?? undefined
    const currentAssets:      number | undefined = balanceSheet?.totalCurrentAssets    ?? undefined
    const currentLiabilities: number | undefined = balanceSheet?.totalCurrentLiabilities ?? undefined
    const longTermDebt:       number | undefined = balanceSheet?.longTermDebt           ?? undefined
    const totalLiabilities:   number | undefined = balanceSheet?.totalLiab              ?? undefined

    // ── Cash flow (most recent annual) ──────────────────────────────────────
    const cfStmt0 = cfh?.cashflowStatements?.[0] as any
    const capexRaw     = cfStmt0?.capitalExpenditures ?? 0
    const capitalExpenditures: number | undefined =
      capexRaw != null ? Math.abs(capexRaw) : undefined
    const depreciation: number | undefined =
      cfStmt0?.depreciation ?? undefined
    // Fallback: use cashflow statement if financialData didn't have it
    const operatingCashFlowFinal: number | undefined =
      operatingCashFlow ?? cfStmt0?.totalCashFromOperatingActivities ?? undefined

    // ── Derived: net cash ─────────────────────────────────────────────────────
    const netCash: number | undefined =
      totalDebt != null ? totalCash - totalDebt : undefined

    // ── Derived: net current assets (working capital) ────────────────────────
    const netCurrentAssets: number | undefined =
      currentAssets != null && currentLiabilities != null
        ? currentAssets - currentLiabilities
        : undefined

    // ── Derived: NCAV ─────────────────────────────────────────────────────────
    const ncav: number | undefined =
      currentAssets != null && totalLiabilities != null
        ? currentAssets - totalLiabilities
        : undefined
    const ncavPerShare: number | undefined =
      ncav != null && sharesOutstanding && sharesOutstanding > 0
        ? ncav / sharesOutstanding
        : undefined
    const isNetNet: boolean =
      price > 0 && ncavPerShare != null && price < 0.67 * ncavPerShare

    // ── Derived: owner earnings (Buffett 1986) ────────────────────────────────
    const da            = depreciation ?? 0
    const capex         = capitalExpenditures ?? 0
    const maintenanceCapEx = Math.min(capex, da)
    const ownerEarnings: number | undefined =
      netIncome != null ? (netIncome + da - maintenanceCapEx) : undefined
    const ownerEarningsYield: number | undefined =
      ownerEarnings != null && price > 0 && sharesOutstanding && sharesOutstanding > 0
        ? (ownerEarnings / sharesOutstanding) / price
        : undefined

    // ── Derived: ROIC ─────────────────────────────────────────────────────────
    // Approximation: net income / (equity + long-term debt)
    const equity    = (totalAssets ?? 0) - (totalLiabilities ?? 0)
    const ltDebt    = longTermDebt ?? 0
    const roic: number | undefined =
      equity + ltDebt > 0 && netIncome != null
        ? netIncome / (equity + ltDebt)
        : undefined

    // ── Derived: earnings yield (Greenblatt) ─────────────────────────────────
    // EBIT / EV — use EBITDA from financialData as an approximation
    const ebitda = fd?.ebitda
    const earningsYield: number | undefined =
      enterpriseValue && enterpriseValue > 0 && ebitda
        ? ebitda / enterpriseValue
        : undefined

    // ── Derived: price to FCF ─────────────────────────────────────────────────
    const priceToFreeCashFlow: number | undefined =
      freeCashFlow && freeCashFlow > 0 && marketCap && marketCap > 0
        ? marketCap / freeCashFlow
        : undefined

    // ── Derived: ebit margin ─────────────────────────────────────────────────
    const ebitMargin: number | undefined =
      revenue && revenue > 0 && operatingMargin != null
        ? operatingMargin   // operating margin ≈ ebit margin
        : undefined

    // ── History arrays from income statement (up to 4 annual periods) ────────
    const incomeStmts: any[] = ish?.incomeStatementHistory ?? []

    const epsHistory: YearlyValue[] = incomeStmts
      .map((s: any) => ({
        year: new Date(s.endDate).getFullYear(),
        value: s.dilutedEps ?? s.basicEps ?? 0,
      }))
      .filter((v: YearlyValue) => v.value !== 0)
      .reverse()

    const revenueHistory: YearlyValue[] = incomeStmts
      .map((s: any) => ({
        year: new Date(s.endDate).getFullYear(),
        value: s.totalRevenue ?? 0,
      }))
      .filter((v: YearlyValue) => v.value !== 0)
      .reverse()

    const operatingIncomeHistory: number[] = incomeStmts
      .filter((s: any) => s.totalRevenue && s.totalRevenue > 0)
      .map((s: any) => s.totalOperatingIncome ?? 0)

    // Operating margin history (for operatingMarginTrend)
    const opMarginHistory: YearlyValue[] = incomeStmts
      .filter((s: any) => s.totalRevenue && s.totalRevenue > 0)
      .map((s: any) => ({
        year: new Date(s.endDate).getFullYear(),
        value: (s.totalOperatingIncome ?? 0) / s.totalRevenue,
      }))
      .filter((v: YearlyValue) => !isNaN(v.year))
      .reverse()

    // Operating margin trend
    let operatingMarginTrend: 'improving' | 'declining' | 'stable' = 'stable'
    if (opMarginHistory.length >= 3) {
      const recent = opMarginHistory.slice(-2).map((v) => v.value)
      const prior  = opMarginHistory.slice(0, -2).map((v) => v.value)
      if (recent.length && prior.length) {
        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length
        const priorAvg  = prior.reduce((a, b) => a + b, 0) / prior.length
        if (recentAvg > priorAvg * 1.05) operatingMarginTrend = 'improving'
        else if (recentAvg < priorAvg * 0.95) operatingMarginTrend = 'declining'
      }
    }

    // ── FCF history from cashflow statements ──────────────────────────────────
    const cfStmts: any[] = cfh?.cashflowStatements ?? []
    const fcfHistory: YearlyValue[] = cfStmts
      .map((s: any) => ({
        year: new Date(s.endDate).getFullYear(),
        value:
          (s.totalCashFromOperatingActivities ?? 0) -
          Math.abs(s.capitalExpenditures ?? 0),
      }))
      .reverse()

    // ── Shiller CAPE (per-stock) ──────────────────────────────────────────────
    // CPI-adjust available history at 3%/yr as proxy (full 10yr needs paid data)
    const currentYear = new Date().getFullYear()
    const shillerEpsData = epsHistory.filter((v) => v.value > 0).slice(-10)
    const shillerEps: number | undefined =
      shillerEpsData.length >= 3
        ? shillerEpsData.reduce(
            (s, v) => s + v.value * Math.pow(1.03, currentYear - v.year),
            0
          ) / shillerEpsData.length
        : undefined
    const capeRatio: number | undefined =
      shillerEps && shillerEps > 0 ? price / shillerEps : undefined

    // ── Cyclicality ───────────────────────────────────────────────────────────
    const isCyclical: boolean =
      epsHistory.length >= 5 ? detectCyclicality(epsHistory) : false
    const normalizedEpsVal: number | undefined =
      epsHistory.length >= 5 ? normalizeEps(epsHistory) : undefined

    // ── Assemble result ───────────────────────────────────────────────────────
    const partial: Partial<StockFundamentals> = {
      ticker: key,
      name,
      sector,
      industry,
      exchange,
      price,
      marketCap,
      sharesOutstanding,

      // Valuation
      pe,
      pb,
      eps,
      bookValuePerShare,
      peg,
      earningsYield,
      priceToFreeCashFlow,
      enterpriseValue,
      ebitMargin,

      // Balance sheet health
      currentRatio,
      debtToEquity,
      longTermDebt,
      currentAssets,
      currentLiabilities,
      totalAssets,
      netCurrentAssets,
      netCash,
      totalDebt,

      // Profitability
      roe,
      roic,
      netIncome,
      revenue,
      grossProfit,
      grossMargin,
      operatingMargin,
      operatingMarginTrend,

      // Cash flow
      operatingCashFlow: operatingCashFlowFinal,
      capitalExpenditures,
      maintenanceCapEx,
      freeCashFlow,
      depreciation,
      ownerEarnings,

      // Cyclicality
      isCyclical,
      normalizedEps: normalizedEpsVal,

      // Shiller
      shillerEps,
      capeRatio,

      // NCAV / net-net
      totalLiabilities,
      ncav,
      ncavPerShare,
      isNetNet,

      // Capital allocation (share count trend — not available from Yahoo annual data)
      // isDiluting left undefined; Yahoo quoteSummary doesn't expose multi-year shares history

      // Yield signals
      ownerEarningsYield,

      // Dividends
      dividendPerShare,
      dividendYield,

      // History
      epsHistory,
      revenueHistory,
      fcfHistory,
      operatingMarginHistory: opMarginHistory,
    }

    // Business quality tier — use classifyBusinessQuality for consistency with FMP path
    // Falls back to inferBusinessTier if the classifier needs more data
    let businessTier: BusinessTier
    try {
      businessTier = classifyBusinessQuality(partial as StockFundamentals).tier
    } catch {
      businessTier = inferBusinessTier(partial)
    }

    const result: StockFundamentals = {
      ...(partial as StockFundamentals),
      businessTier,
    }

    cache.set(key, { data: result, expiresAt: Date.now() + CACHE_TTL })
    return result

  } catch {
    // quoteSummary failed — return a minimal stub so the caller's price guard
    // (if price <= 0 skip) handles this gracefully without crashing.
    const stub: StockFundamentals = { ticker: key, name: key, price: 0 }
    return stub
  }
}
