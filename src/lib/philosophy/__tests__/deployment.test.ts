import { describe, it, expect } from 'vitest'
import { computeSleeveRebalance, type SleeveInput } from '../deployment'

const base: SleeveInput = {
  totalCapital: 100_000,
  targetInvestedPct: 80,
  minCashReservePct: 15,
  individualDeployed: 20_000,
  currentSleeveValue: 0,
  currentSleeveShares: 0,
  etfPrice: 100,
}

describe('computeSleeveRebalance', () => {
  it('buys the ETF to reach the invested target when cash is idle', () => {
    const a = computeSleeveRebalance(base)
    expect(a.action).toBe('buy')
    // target 80k invested, 20k in names → sleeve should target ~60k
    expect(a.targetSleeveValue).toBeGreaterThan(55_000)
    expect(a.targetSleeveValue).toBeLessThanOrEqual(60_000)
    expect(a.shares).toBe(600)
  })

  it('never breaches the cash reserve', () => {
    // target 95% but reserve 15% → deployable capped at 85%
    const a = computeSleeveRebalance({ ...base, targetInvestedPct: 95, individualDeployed: 0 })
    expect(a.targetSleeveValue).toBeLessThanOrEqual(85_000)
  })

  it('trims the sleeve when individual names now cover the target', () => {
    const a = computeSleeveRebalance({
      ...base,
      individualDeployed: 75_000,       // names grew
      currentSleeveValue: 40_000,       // old sleeve too big now
      currentSleeveShares: 400,
    })
    expect(a.action).toBe('sell')
    expect(a.shares).toBeGreaterThan(0)
    expect(a.dollarDelta).toBeLessThan(0)
  })

  it('holds when already within one share of target', () => {
    const a = computeSleeveRebalance({ ...base, individualDeployed: 20_000, currentSleeveValue: 60_000, currentSleeveShares: 600 })
    expect(a.action).toBe('hold')
  })

  it('holds when individual names already exceed the target (no negative sleeve)', () => {
    const a = computeSleeveRebalance({ ...base, individualDeployed: 90_000, currentSleeveValue: 0, currentSleeveShares: 0 })
    expect(a.action).toBe('hold')
    expect(a.targetSleeveValue).toBe(0)
  })

  it('holds gracefully with no ETF price', () => {
    expect(computeSleeveRebalance({ ...base, etfPrice: 0 }).action).toBe('hold')
  })
})
