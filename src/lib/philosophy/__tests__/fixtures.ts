// Shared test fixtures — a "known-good value stock" that every module should
// approve of, with overrides to break one property at a time.

import type { StockFundamentals, GrahamCriteria, IntrinsicValueResult } from '@/types'
import type { PhilosophyScore } from '../scorer'

export function fund(overrides: Partial<StockFundamentals> = {}): StockFundamentals {
  const epsHistory = Array.from({ length: 10 }, (_, i) => ({ year: 2016 + i, value: 2.5 + i * 0.25 }))
  return {
    ticker: 'TEST',
    name: 'Test Industrials Co',
    sector: 'Industrials',
    industry: 'Machinery',
    price: 50,
    marketCap: 5_000_000_000,
    sharesOutstanding: 100_000_000,
    pe: 10,
    pb: 1.2,
    eps: 5,
    bookValuePerShare: 40,
    earningsYield: 0.12,
    priceToFreeCashFlow: 10,
    currentRatio: 2.5,
    debtToEquity: 0.3,
    longTermDebt: 1_000_000_000,
    totalDebt: 1_200_000_000,
    currentAssets: 3_000_000_000,
    currentLiabilities: 1_200_000_000,
    totalAssets: 10_000_000_000,
    totalLiabilities: 4_000_000_000,
    netCurrentAssets: 1_800_000_000,
    netCash: -200_000_000,
    roe: 0.18,
    roic: 0.16,
    netIncome: 500_000_000,
    revenue: 5_000_000_000,
    grossProfit: 2_000_000_000,
    operatingIncome: 800_000_000,
    grossMargin: 0.4,
    operatingMargin: 0.16,
    operatingMarginTrend: 'stable',
    operatingCashFlow: 600_000_000,
    freeCashFlow: 500_000_000,
    depreciation: 100_000_000,
    ownerEarnings: 550_000_000,
    epsHistory,
    piotroskiFScore: 7,
    piotroskiMax: 9,
    altmanZ: 3.5,
    momentum3mo: 0.02,
    priceVs6moLowPct: 0.15,
    inFreefall: false,
    businessTier: 'good',
    shareCountCagr5yr: -0.01,
    ...overrides,
  }
}

export function criteria(overrides: Partial<GrahamCriteria> = {}): GrahamCriteria {
  return {
    passedPE: true,
    passedPB: true,
    passedGrahamProduct: true,
    passedCurrentRatio: true,
    passedDebtToAssets: true,
    passedEpsGrowth: true,
    passedDividends: false,
    passedNoDeficit: true,
    overallPass: true,
    peValue: 10,
    pbValue: 1.2,
    currentRatioValue: 2.5,
    epsGrowthValue: 6,
    dividendYears: 10,
    ...overrides,
  }
}

export function ivRes(overrides: Partial<IntrinsicValueResult> = {}): IntrinsicValueResult {
  return {
    grahamNumber: 67.08,
    dcfValue: 95,
    intrinsicValue: 85,
    currentPrice: 50,
    marginOfSafety: 41.2,
    isBuySignal: true,
    ownerEarnings: 550_000_000,
    expectedCagr10yr: 0.12,
    bearCaseMos: 15,
    ...overrides,
  }
}

export function philosophy(overrides: Partial<PhilosophyScore> = {}): PhilosophyScore {
  return {
    total: 70,
    conviction: 'watchlist',
    signal: 'PASS',
    categoryScores: {} as PhilosophyScore['categoryScores'],
    triggeredPrinciples: [],
    vetoedBy: [],
    auditTrail: [],
    risks: [],
    ...overrides,
  }
}
