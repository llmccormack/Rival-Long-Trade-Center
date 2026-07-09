import { describe, it, expect } from 'vitest'
import { qualifiesForQualityMode, summarizeBlockers } from '../quality-mode'
import { fund, ivRes, philosophy } from './fixtures'

describe('qualifiesForQualityMode', () => {
  const wonderful = () => fund({ businessTier: 'wonderful', roic: 0.22, piotroskiFScore: 7 })
  const fairPriceIv = () => ivRes({ marginOfSafety: 8, expectedCagr10yr: 0.11 })

  it('accepts a wonderful business at a fair price', () => {
    const q = qualifiesForQualityMode(wonderful(), philosophy({ total: 70 }), fairPriceIv())
    expect(q.eligible).toBe(true)
    expect(q.rationale).toMatch(/QUALITY MODE/)
  })

  it('never overpays — MOS below 5% fails', () => {
    const q = qualifiesForQualityMode(wonderful(), philosophy({ total: 70 }), ivRes({ marginOfSafety: 2, expectedCagr10yr: 0.11 }))
    expect(q.eligible).toBe(false)
    expect(q.failures.join(' ')).toMatch(/MOS/)
  })

  it('rejects mediocre businesses regardless of price', () => {
    const q = qualifiesForQualityMode(fund({ businessTier: 'mediocre', roic: 0.06 }), philosophy({ total: 70 }), fairPriceIv())
    expect(q.eligible).toBe(false)
  })

  it('hard vetoes always stand', () => {
    const q = qualifiesForQualityMode(
      wonderful(),
      philosophy({ vetoedBy: [{ id: 'x' } as never] }),
      fairPriceIv()
    )
    expect(q.eligible).toBe(false)
  })

  it('rejects deteriorating compounders (F < 6)', () => {
    const q = qualifiesForQualityMode(
      fund({ businessTier: 'wonderful', roic: 0.22, piotroskiFScore: 4 }),
      philosophy({ total: 70 }),
      fairPriceIv()
    )
    expect(q.eligible).toBe(false)
  })
})

describe('summarizeBlockers', () => {
  it('aggregates and ranks skip reasons', () => {
    const blockers = summarizeBlockers([
      { action: 'SKIP', reason: 'MOS too thin' },
      { action: 'SKIP', reason: 'MOS too thin' },
      { action: 'VETOED', reason: 'Altman Z distress' },
      { action: 'PAPER_BUY', reason: 'should be ignored' },
    ])
    expect(blockers[0]).toEqual({ reason: 'MOS too thin', count: 2 })
    expect(blockers).toHaveLength(2)
  })
})
