import { describe, it, expect } from 'vitest'
import { allocateCapital, type AllocationInput } from '../capital-allocator'

const base: AllocationInput = {
  totalCapital: 100_000,
  conviction: 'strong_buy',
  marginOfSafety: 35,
  philosophyScore: 75,
  price: 50,
  maxPositionPct: 10,
  openPositionCount: 3,
  maxPositions: 15,
}

describe('allocateCapital', () => {
  it('allocates for a strong buy', () => {
    const a = allocateCapital(base)
    expect(a.canAllocate).toBe(true)
    expect(a.shares).toBeGreaterThan(0)
  })

  it('blocks NEW positions in freefall', () => {
    const a = allocateCapital({ ...base, inFreefall: true })
    expect(a.canAllocate).toBe(false)
    expect(a.reason).toMatch(/[Ff]alling knife/)
  })

  it('still allows adding to an EXISTING position in freefall (without the boost)', () => {
    const a = allocateCapital({
      ...base,
      inFreefall: true,
      existingPositionValue: 3_000,
      avgCostBasis: 60,
      piotroskiFScore: 7,
    })
    expect(a.canAllocate).toBe(true)
    expect(a.rationale).toMatch(/WITHHELD/)
  })

  it('withholds the averaging-down boost when the thesis is deteriorating (F < 5)', () => {
    const healthy = allocateCapital({ ...base, existingPositionValue: 2_000, avgCostBasis: 60, piotroskiFScore: 7 })
    const sick = allocateCapital({ ...base, existingPositionValue: 2_000, avgCostBasis: 60, piotroskiFScore: 3 })
    expect(sick.rationale).toMatch(/WITHHELD/)
    expect(sick.dollarAmount).toBeLessThanOrEqual(healthy.dollarAmount)
  })

  it('halves the position for quality-mode entries (sizeMultiplier 0.5)', () => {
    // maxPositionPct raised so the per-position cap doesn't bind — when it
    // binds, the full-size allocation is clipped and halving the raw size
    // legitimately produces more than half the clipped amount.
    const uncapped = { ...base, maxPositionPct: 25 }
    const full = allocateCapital(uncapped)
    const half = allocateCapital({ ...uncapped, sizeMultiplier: 0.5 })
    expect(half.dollarAmount).toBeLessThan(full.dollarAmount)
    // within one share of exactly half
    expect(Math.abs(half.dollarAmount * 2 - full.dollarAmount)).toBeLessThanOrEqual(2 * base.price)
  })

  it('enforces the sector concentration cap', () => {
    const a = allocateCapital({
      ...base,
      stockSector: 'Energy',
      sectorExposure: { Energy: 30_000 },
      maxSectorPct: 30,
    })
    expect(a.canAllocate).toBe(false)
    expect(a.reason).toMatch(/[Ss]ector/)
  })

  it('enforces the cash reserve floor', () => {
    const a = allocateCapital({ ...base, deployedCapital: 85_000, minCashReservePct: 15 })
    expect(a.canAllocate).toBe(false)
    expect(a.reason).toMatch(/[Cc]ash reserve/)
  })

  it('refuses to deploy for watchlist-level conviction', () => {
    const a = allocateCapital({ ...base, conviction: 'watchlist' })
    expect(a.canAllocate).toBe(false)
  })
})
