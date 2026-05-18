import type { StockFundamentals, IntrinsicValueResult } from '@/types'

// Graham Number = sqrt(22.5 × EPS × Book Value Per Share)
// The 22.5 factor = 15 (max P/E) × 1.5 (max P/B) — Graham's formula from The Intelligent Investor
export function calculateGrahamNumber(eps: number, bookValuePerShare: number): number | undefined {
  if (eps <= 0 || bookValuePerShare <= 0) return undefined
  return Math.sqrt(22.5 * eps * bookValuePerShare)
}

// Estimate sustainable EPS growth from 10-year history
function estimateGrowthRate(epsHistory: { year: number; value: number }[]): number {
  const positive = epsHistory.filter((v) => v.value > 0)
  if (positive.length < 2) return 0.03 // conservative fallback

  const sorted = [...positive].sort((a, b) => a.year - b.year)
  const first = sorted[0].value
  const last = sorted[sorted.length - 1].value
  const years = sorted[sorted.length - 1].year - sorted[0].year

  if (years === 0) return 0.03

  // CAGR
  const cagr = Math.pow(last / first, 1 / years) - 1

  // Cap growth rate conservatively — Graham/Buffett never assume heroic growth
  return Math.min(Math.max(cagr, 0), 0.12)
}

// Buffett's DCF using Owner Earnings
// Discount rate default = 9% (long-run equity return); terminal growth = 3%
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
    discountRate = 0.09,
    terminalGrowth = 0.03,
    years = 10,
  } = params

  const g = growthRate ?? 0.05
  let pv = 0
  let earnings = ownerEarnings

  for (let t = 1; t <= years; t++) {
    earnings *= 1 + g
    pv += earnings / Math.pow(1 + discountRate, t)
  }

  // Terminal value (Gordon Growth Model)
  const terminalValue = (earnings * (1 + terminalGrowth)) / (discountRate - terminalGrowth)
  const pvTerminal = terminalValue / Math.pow(1 + discountRate, years)

  return {
    dcfValue: pv + pvTerminal,
    growthRateUsed: g,
    discountRateUsed: discountRate,
    terminalGrowth,
  }
}

// Composite intrinsic value: weighted average of Graham Number and DCF
// If only one method is available, use it alone
export function calculateIntrinsicValue(
  fundamentals: StockFundamentals,
  sharesOutstanding?: number
): IntrinsicValueResult {
  const price = fundamentals.price

  let grahamNumber: number | undefined
  if (fundamentals.eps && fundamentals.bookValuePerShare) {
    grahamNumber = calculateGrahamNumber(fundamentals.eps, fundamentals.bookValuePerShare)
  }

  let dcfResult:
    | { dcfValue: number; growthRateUsed: number; discountRateUsed: number; terminalGrowth: number }
    | undefined

  const ownerEarnings = fundamentals.ownerEarnings
  if (ownerEarnings && ownerEarnings > 0 && sharesOutstanding && sharesOutstanding > 0) {
    const ownerEarningsPerShare = ownerEarnings / sharesOutstanding
    const growthRate = fundamentals.epsHistory
      ? estimateGrowthRate(fundamentals.epsHistory)
      : 0.05

    dcfResult = calculateDCF({
      ownerEarnings: ownerEarningsPerShare,
      growthRate,
    })
  }

  // Determine composite intrinsic value
  let intrinsicValue: number
  if (grahamNumber && dcfResult) {
    // Weight DCF more heavily (60%) as it accounts for earnings power
    intrinsicValue = grahamNumber * 0.4 + dcfResult.dcfValue * 0.6
  } else if (dcfResult) {
    intrinsicValue = dcfResult.dcfValue
  } else if (grahamNumber) {
    intrinsicValue = grahamNumber
  } else {
    // No valid calculation possible
    return {
      currentPrice: price,
      intrinsicValue: 0,
      marginOfSafety: 0,
      isBuySignal: false,
    }
  }

  // Margin of Safety = (Intrinsic Value - Price) / Intrinsic Value
  const marginOfSafety =
    intrinsicValue > 0 ? ((intrinsicValue - price) / intrinsicValue) * 100 : 0

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
  }
}
