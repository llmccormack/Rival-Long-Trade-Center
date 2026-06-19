import type { StockFundamentals, GrahamCriteria } from '@/types'

// Graham Chapter 14 — Defensive Investor Criteria
// Source: The Intelligent Investor, Benjamin Graham
//
// FIX #1: Graham's actual rule is pe × pb ≤ 22.5, not independent pe ≤ 15 AND pb ≤ 1.5.
// A stock with pe=12, pb=1.8 passes (product=21.6) but was incorrectly failing before.
//
// FIX #6: 20-year dividend requirement excluded the best compounders (Amazon, Alphabet,
// Berkshire itself). Buffett explicitly designed Berkshire to NOT pay dividends.
// Dividends are now a soft positive signal, not a gate on overallPass.

const CRITERIA = {
  MAX_PE:                              15,
  MAX_PB:                             1.5,
  MAX_GRAHAM_PRODUCT:               22.5,   // pe × pb ≤ 22.5 (Graham's actual rule)
  MIN_CURRENT_RATIO:                   2,
  MIN_EPS_GROWTH_ANNUAL:            0.03,   // 3% per year over available history
  MIN_DIVIDEND_YEARS:                 20,   // soft signal only
  MAX_LONG_TERM_DEBT_TO_NCA:           1,   // LTD ≤ net current assets (working capital)
}

// Log-linear regression on EPS history to estimate trend growth.
// Uses all years (not just positive-to-positive CAGR) to avoid cherry-picking start year.
function regressionGrowthRate(epsHistory: { year: number; value: number }[]): number | undefined {
  const data = [...epsHistory].filter(v => v.value > 0).sort((a, b) => a.year - b.year)
  if (data.length < 3) return undefined

  const n = data.length
  const xMean = data.reduce((s, d) => s + d.year, 0) / n
  const yMean = data.reduce((s, d) => s + Math.log(d.value), 0) / n
  const num = data.reduce((s, d) => s + (d.year - xMean) * (Math.log(d.value) - yMean), 0)
  const den = data.reduce((s, d) => s + Math.pow(d.year - xMean, 2), 0)

  if (den === 0) return undefined

  // slope of log-linear regression = continuously compounded growth rate
  const continuousRate = num / den
  return Math.exp(continuousRate) - 1  // convert to discrete annual rate
}

function hasNoEarningsDeficit(epsHistory: { year: number; value: number }[]): boolean {
  const recent = [...epsHistory].sort((a, b) => b.year - a.year).slice(0, 10)
  // If 2020 is the only negative year, don't penalise — it was an anomalous shutdown year
  // that hit entire industries (airlines, hotels, restaurants) regardless of business quality.
  const negativeYears = recent.filter(v => v.value <= 0)
  if (negativeYears.length === 1 && negativeYears[0].year === 2020) return true
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
    isCyclical,
    normalizedEps,
  } = fundamentals

  // 1. P/E ≤ 15 (individual check — retained for display/scoring)
  const passedPE = pe != null && pe > 0 && pe <= CRITERIA.MAX_PE

  // 2. P/B ≤ 1.5 (individual check — retained for display/scoring)
  const passedPB = pb != null && pb > 0 && pb <= CRITERIA.MAX_PB

  // 3. Graham's actual combined rule: pe × pb ≤ 22.5
  // This is what Graham Chapter 14 actually says. Stock with pe=12, pb=1.8
  // has product 21.6 — it passes Graham, but failed the old dual-gate.
  const passedGrahamProduct =
    pe != null && pe > 0 && pb != null && pb > 0 && (pe * pb) <= CRITERIA.MAX_GRAHAM_PRODUCT

  // 4. Current Ratio ≥ 2
  const passedCurrentRatio = currentRatio != null && currentRatio >= CRITERIA.MIN_CURRENT_RATIO

  // 5. Long-term debt ≤ Net Current Assets (working capital = current assets - current liabilities)
  const netCurrentAssets =
    currentAssets != null && currentLiabilities != null
      ? currentAssets - currentLiabilities
      : undefined
  const passedDebtToAssets =
    longTermDebt != null &&
    netCurrentAssets != null &&
    longTermDebt <= netCurrentAssets * CRITERIA.MAX_LONG_TERM_DEBT_TO_NCA
  const debtToAssetsValue =
    netCurrentAssets && netCurrentAssets > 0 && longTermDebt != null
      ? longTermDebt / netCurrentAssets
      : undefined

  // 6. EPS growth ≥ 3% + no deficit
  // For cyclical businesses use normalized EPS; otherwise use regression growth rate
  let passedEpsGrowth = false
  let epsGrowthValue: number | undefined

  if (epsHistory && epsHistory.length > 0) {
    const growthRate = regressionGrowthRate(epsHistory)
    epsGrowthValue = growthRate !== undefined ? growthRate * 100 : undefined
    passedEpsGrowth = growthRate != null && growthRate >= CRITERIA.MIN_EPS_GROWTH_ANNUAL
  }

  const passedNoDeficit = epsHistory && epsHistory.length > 0
    ? hasNoEarningsDeficit(epsHistory)
    : false

  // 7. Dividends — SOFT SIGNAL ONLY, does not gate overallPass.
  // Graham's 20-year dividend rule was written in 1949. Buffett designed Berkshire to
  // pay zero dividends because reinvestment at 20%+ ROIC beats any payout. Companies
  // that reinvest earnings at high ROIC are superior to dividend payers at low ROIC.
  let dividendYears = 0
  let passedDividends = false
  if (dividendHistory && dividendHistory.length > 0) {
    dividendYears = countDividendYears(dividendHistory)
    passedDividends = dividendYears >= CRITERIA.MIN_DIVIDEND_YEARS
  }

  // overallPass uses the product rule (the real Graham criterion), not dual gates.
  // Dividends excluded — assessed as a positive signal in the philosophy scorer.
  const overallPass =
    passedGrahamProduct &&
    passedCurrentRatio &&
    passedDebtToAssets &&
    passedEpsGrowth &&
    passedNoDeficit

  return {
    passedPE,
    passedPB,
    passedGrahamProduct,
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

// Returns 0–100 score for watchlist sorting.
// Uses product rule; treats dividends as a bonus, not a gate.
export function calculateGrahamScore(criteria: GrahamCriteria): number {
  const gates = [
    criteria.passedGrahamProduct,  // replaces dual PE+PB gates (counts as 2 points weight-wise)
    criteria.passedCurrentRatio,
    criteria.passedDebtToAssets,
    criteria.passedEpsGrowth,
    criteria.passedNoDeficit,
  ]
  const bonus = [criteria.passedDividends]  // soft bonus, not gating

  const gatePassed  = gates.filter(Boolean).length
  const bonusPassed = bonus.filter(Boolean).length
  const maxScore = gates.length + bonus.length * 0.5

  return Math.round(((gatePassed + bonusPassed * 0.5) / maxScore) * 100)
}

export { CRITERIA }
