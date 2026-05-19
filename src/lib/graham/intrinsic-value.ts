import type { StockFundamentals, IntrinsicValueResult } from '@/types'

// Graham Number = sqrt(22.5 × EPS × Book Value Per Share)
// 22.5 = 15 (max P/E) × 1.5 (max P/B) — Graham, The Intelligent Investor
export function calculateGrahamNumber(eps: number, bookValuePerShare: number): number | undefined {
  if (eps <= 0 || bookValuePerShare <= 0) return undefined
  return Math.sqrt(22.5 * eps * bookValuePerShare)
}

// ─── Growth Rate Estimation ────────────────────────────────────────────────────
//
// FIX #3: Old code used simple CAGR from the first positive year to last positive
// year. This cherry-picks the start point — if a company lost money in 2013-2015
// then recovered to $0.10 EPS in 2016 and grew to $1.50 today, CAGR shows 40%.
//
// New approach: log-linear regression across all positive-EPS years (handles gaps
// without cherry-picking) + mean-reversion blend toward long-run 7% equity mean.

function estimateGrowthRate(epsHistory: { year: number; value: number }[]): number {
  const data = [...epsHistory]
    .filter(v => v.value > 0)
    .sort((a, b) => a.year - b.year)
    .slice(-10)  // at most last 10 years

  if (data.length < 2) return 0.03

  if (data.length === 2) {
    // Only two data points — simple CAGR but capped conservatively
    const years = data[1].year - data[0].year
    if (years <= 0) return 0.03
    const cagr = Math.pow(data[1].value / data[0].value, 1 / years) - 1
    return Math.min(Math.max(cagr * 0.6 + 0.07 * 0.4, 0), 0.12)
  }

  // Log-linear regression: ln(EPS) = a + b * year
  // slope b is the continuously-compounded annual growth rate
  const n = data.length
  const xMean = data.reduce((s, d) => s + d.year, 0) / n
  const yMean = data.reduce((s, d) => s + Math.log(d.value), 0) / n
  const num = data.reduce((s, d) => s + (d.year - xMean) * (Math.log(d.value) - yMean), 0)
  const den = data.reduce((s, d) => s + Math.pow(d.year - xMean, 2), 0)

  if (den === 0) return 0.03

  const continuousRate = num / den
  const historicalGrowth = Math.exp(continuousRate) - 1  // discrete annual

  // Mean-revert toward long-run equity earnings growth (7%)
  // Weight: 60% historical regression, 40% long-run mean
  // This prevents projecting a cyclical recovery spike or a one-decade boom forward
  const LONG_RUN_MEAN = 0.07
  const blended = historicalGrowth * 0.6 + LONG_RUN_MEAN * 0.4

  return Math.min(Math.max(blended, 0), 0.12)
}

// ─── Cyclicality Detection ─────────────────────────────────────────────────────
//
// FIX #9: Energy, mining, steel, and auto companies look cheap (P/E 5) at peak
// cycle earnings — classic value trap. Use normalized (cycle-average) earnings
// when earnings volatility is high.

export function detectCyclicality(epsHistory: { year: number; value: number }[]): boolean {
  const values = epsHistory.filter(h => h.value > 0).map(h => h.value)
  if (values.length < 5) return false
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  if (mean <= 0) return false
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length
  const coeffOfVariation = Math.sqrt(variance) / mean
  return coeffOfVariation > 0.4  // >40% variation = cyclical
}

export function normalizeEps(epsHistory: { year: number; value: number }[]): number | undefined {
  const recentPositive = [...epsHistory]
    .sort((a, b) => b.year - a.year)
    .slice(0, 7)
    .filter(v => v.value > 0)
  if (recentPositive.length < 3) return undefined
  return recentPositive.reduce((s, v) => s + v.value, 0) / recentPositive.length
}

// ─── Buffett DCF (Owner Earnings) ─────────────────────────────────────────────
//
// FIX #15: Discount rate is now a parameter (default 0.10).
// At ~4.5% risk-free, equity risk premium ~5% → ~9.5-10% for high-quality stocks.
// The old hard-coded 0.09 was appropriate at near-zero rates; 0.10 is more
// realistic today and is configurable from autopilot settings.

export function calculateDCF(params: {
  ownerEarnings: number
  growthRate?: number
  discountRate?: number
  terminalGrowth?: number
  years?: number
}): {
  dcfValue: number
  growthRateUsed: number
  discountRateUsed: number
  terminalGrowth: number
} {
  const {
    ownerEarnings,
    growthRate,
    discountRate = 0.10,   // Updated default — see note above
    terminalGrowth = 0.03,
    years = 10,
  } = params

  const g = growthRate ?? 0.05

  if (discountRate <= terminalGrowth) {
    // Degenerate case — Gordon Growth Model blows up
    return { dcfValue: 0, growthRateUsed: g, discountRateUsed: discountRate, terminalGrowth }
  }

  let pv = 0
  let earnings = ownerEarnings

  for (let t = 1; t <= years; t++) {
    earnings *= 1 + g
    pv += earnings / Math.pow(1 + discountRate, t)
  }

  // Terminal value: perpetuity growing at terminalGrowth starting year 11
  const terminalValue = (earnings * (1 + terminalGrowth)) / (discountRate - terminalGrowth)
  const pvTerminal = terminalValue / Math.pow(1 + discountRate, years)

  return {
    dcfValue: pv + pvTerminal,
    growthRateUsed: g,
    discountRateUsed: discountRate,
    terminalGrowth,
  }
}

// ─── Composite Intrinsic Value ─────────────────────────────────────────────────
//
// Weighting is now sector-aware:
// - Capital-light / technology: book value is largely intangible → weight DCF 80%
// - Asset-heavy / traditional: Graham Number is more meaningful → weight 40/60
//
// Cyclical businesses: use normalizedEps for the Graham Number calculation if
// available, to avoid valuing at peak-cycle earnings.

function isCapitalLight(sector?: string): boolean {
  const lightSectors = ['technology', 'communication', 'software', 'healthcare', 'financial services', 'media']
  const s = (sector ?? '').toLowerCase()
  return lightSectors.some(ls => s.includes(ls))
}

// Tier-aware discount rate adjustment.
// A wonderful business (high ROIC, expanding moat, no debt) is fundamentally
// less risky than an adequate one. Discounting both at 10% misprices the best
// opportunities — wonderful businesses deserve a lower required return, which
// correctly produces a higher IV and a longer justified holding period.
const TIER_DISCOUNT_ADJ: Record<string, number> = {
  wonderful: -0.020,   // 10% base → 8.0%
  good:      -0.005,   // 10% base → 9.5%
  adequate:   0.000,   // 10% base → 10.0% (neutral)
  mediocre:  +0.025,   // 10% base → 12.5%
}

export function calculateIntrinsicValue(
  fundamentals: StockFundamentals,
  sharesOutstanding?: number,
  discountRate?: number
): IntrinsicValueResult {
  const price = fundamentals.price

  // Apply tier-aware discount rate adjustment on top of the user-configured base.
  // If no explicit rate passed, default to 10% then adjust by tier.
  const baseDiscount = discountRate ?? 0.10
  const tierAdj = TIER_DISCOUNT_ADJ[fundamentals.businessTier ?? 'adequate'] ?? 0
  const effectiveDiscountRate = Math.max(0.06, Math.min(0.18, baseDiscount + tierAdj))

  // For cyclical businesses, use normalized EPS in the Graham Number
  // Prefer Shiller EPS (10-year real average) over single-year trailing EPS
  const shillerOrNormalizedEps =
    fundamentals.isCyclical && fundamentals.normalizedEps
      ? fundamentals.normalizedEps
      : (fundamentals.shillerEps ?? fundamentals.eps)

  const epsForGraham = shillerOrNormalizedEps

  let grahamNumber: number | undefined
  if (epsForGraham && fundamentals.bookValuePerShare) {
    grahamNumber = calculateGrahamNumber(epsForGraham, fundamentals.bookValuePerShare)
  }

  let dcfResult:
    | { dcfValue: number; growthRateUsed: number; discountRateUsed: number; terminalGrowth: number }
    | undefined

  const ownerEarnings = fundamentals.ownerEarnings
  let growthRate = 0.05

  if (ownerEarnings && ownerEarnings > 0 && sharesOutstanding && sharesOutstanding > 0) {
    const ownerEarningsPerShare = ownerEarnings / sharesOutstanding
    growthRate = fundamentals.epsHistory
      ? estimateGrowthRate(fundamentals.epsHistory)
      : 0.05

    dcfResult = calculateDCF({
      ownerEarnings: ownerEarningsPerShare,
      growthRate,
      discountRate: effectiveDiscountRate,
    })
  }

  // Composite weighting — sector-aware
  let intrinsicValue: number
  if (grahamNumber && dcfResult) {
    const dcfWeight = isCapitalLight(fundamentals.sector) ? 0.80 : 0.60
    const gnWeight  = 1 - dcfWeight
    intrinsicValue = grahamNumber * gnWeight + dcfResult.dcfValue * dcfWeight
  } else if (dcfResult) {
    intrinsicValue = dcfResult.dcfValue
  } else if (grahamNumber) {
    intrinsicValue = grahamNumber
  } else {
    return {
      currentPrice: price,
      intrinsicValue: 0,
      marginOfSafety: 0,
      isBuySignal: false,
    }
  }

  const marginOfSafety =
    intrinsicValue > 0 ? ((intrinsicValue - price) / intrinsicValue) * 100 : 0

  // ─── Buffett's 10-year expected CAGR ──────────────────────────────────────────
  // "I don't look to jump over 7-foot bars; I look around for 1-foot bars that
  //  I can step over." — Buffett. This answers: what annual return am I locking in?
  //
  // Formula: [(EPS_10yr × exit_PE) / current_price]^(1/10) − 1
  // Exit P/E: conservative mean-reversion toward 15. High P/E stocks face compression.
  let expectedCagr10yr: number | undefined
  const baseEps = fundamentals.shillerEps ?? fundamentals.eps
  if (baseEps && baseEps > 0 && price > 0) {
    const eps10 = baseEps * Math.pow(1 + growthRate, 10)
    const currentPE = fundamentals.pe ?? 15
    // Exit P/E: regress toward 15 (long-run market mean) — be conservative
    const exitPE = Math.max(10,
      currentPE > 30 ? 15 :
      currentPE > 20 ? currentPE * 0.75 :
      currentPE > 15 ? currentPE * 0.90 : currentPE
    )
    const projectedPrice = eps10 * exitPE
    const rawCagr = Math.pow(projectedPrice / price, 1 / 10) - 1
    expectedCagr10yr = Math.max(-0.25, Math.min(0.35, rawCagr))
  }

  // ─── Shiller mean-reversion price target ─────────────────────────────────────
  // Where would the stock trade if its CAPE reverted to the long-run fair value of 20×?
  // This is a 10-year anchor, not a near-term target.
  const shillerCapePriceTarget =
    fundamentals.shillerEps && fundamentals.shillerEps > 0
      ? fundamentals.shillerEps * 20   // Shiller's long-run fair CAPE ≈ 20
      : undefined

  return {
    grahamNumber,
    dcfValue: dcfResult?.dcfValue,
    intrinsicValue,
    currentPrice: price,
    marginOfSafety,
    isBuySignal: marginOfSafety >= 30,
    ownerEarnings,
    growthRateUsed: dcfResult?.growthRateUsed,
    discountRateUsed: dcfResult?.discountRateUsed,
    terminalGrowth: dcfResult?.terminalGrowth,
    expectedCagr10yr,
    shillerCapePriceTarget,
  }
}
