import type { StockFundamentals, GrahamCriteria } from '@/types'

// Graham Chapter 14 — Defensive Investor Criteria
// Source: The Intelligent Investor, Benjamin Graham

const CRITERIA = {
  MAX_PE: 15,
  MAX_PB: 1.5,
  MIN_CURRENT_RATIO: 2,
  MIN_EPS_GROWTH_ANNUAL: 0.03, // 3% per year over 10 years
  MIN_DIVIDEND_YEARS: 20,
  MAX_LONG_TERM_DEBT_TO_NET_CURRENT_ASSETS: 1, // LTD ≤ Net Current Assets
}

function calculateEpsCAGR(epsHistory: { year: number; value: number }[]): number | undefined {
  const sorted = [...epsHistory].filter((v) => v.value != null).sort((a, b) => a.year - b.year)
  if (sorted.length < 2) return undefined

  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const years = last.year - first.year
  if (years === 0 || first.value <= 0) return undefined

  return Math.pow(last.value / first.value, 1 / years) - 1
}

function hasNoEarningsDeficit(epsHistory: { year: number; value: number }[]): boolean {
  const recent = [...epsHistory].sort((a, b) => b.year - a.year).slice(0, 10)
  return recent.every((v) => v.value > 0)
}

function countDividendYears(dividendHistory: { year: number; value: number }[]): number {
  return dividendHistory.filter((d) => d.value > 0).length
}

export function applyGrahamCriteria(fundamentals: StockFundamentals): GrahamCriteria {
  const {
    pe,
    pb,
    currentRatio,
    longTermDebt,
    currentAssets,
    currentLiabilities,
    epsHistory,
    dividendHistory,
  } = fundamentals

  // 1. P/E ≤ 15
  const passedPE = pe != null && pe > 0 && pe <= CRITERIA.MAX_PE

  // 2. P/B ≤ 1.5
  const passedPB = pb != null && pb > 0 && pb <= CRITERIA.MAX_PB

  // 3. Current Ratio ≥ 2
  const passedCurrentRatio = currentRatio != null && currentRatio >= CRITERIA.MIN_CURRENT_RATIO

  // 4. Long-term debt ≤ Net Current Assets
  // Net Current Assets = Current Assets - Total Current Liabilities
  const netCurrentAssets =
    currentAssets != null && currentLiabilities != null
      ? currentAssets - currentLiabilities
      : undefined
  const passedDebtToAssets =
    longTermDebt != null &&
    netCurrentAssets != null &&
    longTermDebt <= netCurrentAssets * CRITERIA.MAX_LONG_TERM_DEBT_TO_NET_CURRENT_ASSETS
  const debtToAssetsValue =
    netCurrentAssets && netCurrentAssets > 0 && longTermDebt != null
      ? longTermDebt / netCurrentAssets
      : undefined

  // 5. EPS growth ≥ 3% annually over 10 years + no deficit
  let passedEpsGrowth = false
  let epsGrowthValue: number | undefined
  let passedNoDeficit = false

  if (epsHistory && epsHistory.length > 0) {
    const cagr = calculateEpsCAGR(epsHistory)
    epsGrowthValue = cagr !== undefined ? cagr * 100 : undefined
    passedEpsGrowth = cagr != null && cagr >= CRITERIA.MIN_EPS_GROWTH_ANNUAL
    passedNoDeficit = hasNoEarningsDeficit(epsHistory)
  }

  // 6. Dividends paid for ≥ 20 consecutive years
  let dividendYears = 0
  let passedDividends = false
  if (dividendHistory && dividendHistory.length > 0) {
    dividendYears = countDividendYears(dividendHistory)
    passedDividends = dividendYears >= CRITERIA.MIN_DIVIDEND_YEARS
  }

  const overallPass =
    passedPE &&
    passedPB &&
    passedCurrentRatio &&
    passedDebtToAssets &&
    passedEpsGrowth &&
    passedDividends &&
    passedNoDeficit

  return {
    passedPE,
    passedPB,
    passedCurrentRatio,
    passedDebtToAssets,
    passedEpsGrowth,
    passedDividends,
    passedNoDeficit,
    overallPass,
    peValue: pe ?? undefined,
    pbValue: pb ?? undefined,
    currentRatioValue: currentRatio ?? undefined,
    debtToAssetsValue,
    epsGrowthValue,
    dividendYears,
  }
}

// Returns 0-100 score representing how many criteria pass, for watchlist sorting
export function calculateGrahamScore(criteria: GrahamCriteria): number {
  const flags = [
    criteria.passedPE,
    criteria.passedPB,
    criteria.passedCurrentRatio,
    criteria.passedDebtToAssets,
    criteria.passedEpsGrowth,
    criteria.passedDividends,
    criteria.passedNoDeficit,
  ]
  const passed = flags.filter(Boolean).length
  return Math.round((passed / flags.length) * 100)
}

export { CRITERIA }
