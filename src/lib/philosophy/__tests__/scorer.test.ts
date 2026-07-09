import { describe, it, expect } from 'vitest'
import { scoreBuyDecision } from '../scorer'
import { fund, criteria, ivRes } from './fixtures'

describe('scoreBuyDecision', () => {
  it('scores a strong value stock as BUY with no vetoes', () => {
    const s = scoreBuyDecision(fund(), criteria(), ivRes())
    expect(s.vetoedBy).toHaveLength(0)
    expect(s.total).toBeGreaterThanOrEqual(60)
    expect(s.signal).toBe('BUY')
  })

  it('missing data LOWERS the score — the old denominator bug let it raise scores', () => {
    const full = scoreBuyDecision(fund(), criteria(), ivRes())
    const sparse = scoreBuyDecision(
      fund({
        piotroskiFScore: undefined,
        piotroskiMax: undefined,
        altmanZ: undefined,
        momentum3mo: undefined,
        inFreefall: undefined,
        operatingCashFlow: undefined,
        freeCashFlow: undefined,
        roe: undefined,
        roic: undefined,
      }),
      criteria(),
      ivRes()
    )
    expect(sparse.total).toBeLessThan(full.total)
  })

  it('vetoes a Piotroski F ≤ 2 value trap', () => {
    const s = scoreBuyDecision(fund({ piotroskiFScore: 1, piotroskiMax: 9 }), criteria(), ivRes())
    expect(s.vetoedBy.length).toBeGreaterThan(0)
    expect(s.total).toBe(0)
    expect(s.signal).toBe('PASS')
  })

  it('vetoes Altman Z distress zone for non-financials', () => {
    const s = scoreBuyDecision(fund({ altmanZ: 1.0 }), criteria(), ivRes())
    expect(s.vetoedBy.length).toBeGreaterThan(0)
  })

  it('skips the Altman Z veto for financial-sector stocks', () => {
    const s = scoreBuyDecision(
      fund({ sector: 'Financial Services', altmanZ: 1.0, currentRatio: 0.5 }),
      criteria(),
      ivRes()
    )
    expect(s.vetoedBy).toHaveLength(0)
  })

  it('vetoes negative owner earnings', () => {
    const s = scoreBuyDecision(fund({ ownerEarnings: -100_000_000 }), criteria(), ivRes())
    expect(s.vetoedBy.length).toBeGreaterThan(0)
  })

  it('vetoes debt/equity above 2×', () => {
    const s = scoreBuyDecision(fund({ debtToEquity: 3 }), criteria(), ivRes())
    expect(s.vetoedBy.length).toBeGreaterThan(0)
  })

  it('a failed bear-case stress test drags the score down', () => {
    const robust = scoreBuyDecision(fund(), criteria(), ivRes({ bearCaseMos: 20 }))
    const fragile = scoreBuyDecision(fund(), criteria(), ivRes({ bearCaseMos: -15 }))
    expect(fragile.total).toBeLessThan(robust.total)
  })

  it('freefall momentum scores worse than stable momentum', () => {
    const stable = scoreBuyDecision(fund(), criteria(), ivRes())
    const falling = scoreBuyDecision(
      fund({ momentum3mo: -0.25, priceVs6moLowPct: 0.01, inFreefall: true }),
      criteria(),
      ivRes()
    )
    expect(falling.total).toBeLessThan(stable.total)
  })
})
