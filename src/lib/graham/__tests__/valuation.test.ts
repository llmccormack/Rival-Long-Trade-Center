import { describe, it, expect } from 'vitest'
import { calculateGrahamNumber, calculateDCF, calculateIntrinsicValue } from '../intrinsic-value'
import { computePiotroskiFScore, computeAltmanZ } from '../quality-scores'
import { fund } from '../../philosophy/__tests__/fixtures'

describe('calculateGrahamNumber', () => {
  it('computes √(22.5 × EPS × BVPS)', () => {
    expect(calculateGrahamNumber(5, 40)).toBeCloseTo(Math.sqrt(4500), 4)
  })
  it('is undefined for non-positive inputs', () => {
    expect(calculateGrahamNumber(-1, 40)).toBeUndefined()
    expect(calculateGrahamNumber(5, 0)).toBeUndefined()
  })
})

describe('calculateDCF', () => {
  it('returns 0 in the degenerate Gordon-growth case (discount ≤ terminal)', () => {
    const r = calculateDCF({ ownerEarnings: 5, discountRate: 0.02, terminalGrowth: 0.03 })
    expect(r.dcfValue).toBe(0)
  })
  it('higher discount rate → lower value', () => {
    const low = calculateDCF({ ownerEarnings: 5, growthRate: 0.05, discountRate: 0.08 })
    const high = calculateDCF({ ownerEarnings: 5, growthRate: 0.05, discountRate: 0.12 })
    expect(high.dcfValue).toBeLessThan(low.dcfValue)
  })
})

describe('calculateIntrinsicValue — bear-case stress test', () => {
  it('bear-case MOS is strictly below base MOS for a growing business', () => {
    const iv = calculateIntrinsicValue(fund(), 100_000_000)
    expect(iv.intrinsicValue).toBeGreaterThan(0)
    expect(iv.bearCaseMos).toBeDefined()
    expect(iv.bearCaseMos!).toBeLessThan(iv.marginOfSafety)
  })
})

describe('computeAltmanZ', () => {
  it('matches the 1968 formula on hand-computed values', () => {
    const z = computeAltmanZ({
      income: { calendarYear: '2025', revenue: 80, grossProfit: 30, operatingIncome: 10, netIncome: 6 },
      balance: {
        calendarYear: '2025', totalAssets: 100, totalLiabilities: 40,
        totalCurrentAssets: 30, totalCurrentLiabilities: 15, longTermDebt: 20, retainedEarnings: 20,
      },
      marketCap: 90,
    })
    // 1.2(15/100) + 1.4(20/100) + 3.3(10/100) + 0.6(90/40) + 1.0(80/100) = 2.94
    expect(z).toBeCloseTo(2.94, 2)
  })
  it('is undefined without retained earnings or market cap', () => {
    expect(computeAltmanZ({ marketCap: 0 })).toBeUndefined()
  })
})

describe('computePiotroskiFScore', () => {
  const yr = (calendarYear: string, mult: number) => ({
    income: { calendarYear, revenue: 100 * mult, grossProfit: 40 * mult, operatingIncome: 15 * mult, netIncome: 10 * mult, weightedAverageShsOut: 100 / mult },
    balance: { calendarYear, totalAssets: 100, totalLiabilities: 40, totalCurrentAssets: 30 * mult, totalCurrentLiabilities: 15, longTermDebt: 20 / mult, retainedEarnings: 20 * mult },
    cash: { calendarYear, operatingCashFlow: 14 * mult },
  })
  it('scores an improving business highly', () => {
    const cur = yr('2025', 1.1), prev = yr('2024', 1.0)
    const r = computePiotroskiFScore([cur.income, prev.income], [cur.balance, prev.balance], [cur.cash, prev.cash])
    expect(r).toBeDefined()
    expect(r!.score).toBeGreaterThanOrEqual(7)
  })
  it('returns undefined when fewer than 5 components are computable', () => {
    const only = yr('2025', 1)
    const r = computePiotroskiFScore([only.income], [only.balance], [only.cash])
    expect(r).toBeUndefined()
  })
})
