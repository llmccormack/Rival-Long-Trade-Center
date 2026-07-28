// ─── Quality Mode — "Wonderful Company at a Fair Price" ──────────────────────
//
// The strict Graham gate (30% MOS) produces nothing in hot markets — deep
// discounts simply don't exist at high CAPE, and a bot that only knows
// "fair company at a wonderful price" starves for years at a time.
//
// Buffett's own evolution (via Munger, stated plainly in the 2023 letter) was
// the second trade: "It's far better to buy a wonderful company at a fair
// price than a fair company at a wonderful price." Wonderful businesses at
// fair prices exist in EVERY market. This module encodes that trade with
// discipline intact:
//
//   • Only wonderful/good-tier businesses (sustained high ROIC)
//   • Fundamentals improving (Piotroski F ≥ 6) — no deteriorating compounders
//   • Still NEVER above intrinsic value (MOS ≥ 5%) — fair price, not any price
//   • Forward 10-yr expected CAGR must clear Buffett's ~10% hurdle
//   • Half-size positions, total quality-mode exposure capped (default 35%)
//   • All hard vetoes still apply
//
// Tagged entryMode='quality' so value vs quality performance is measurable.

import type { StockFundamentals, IntrinsicValueResult } from '@/types'
import type { PhilosophyScore } from './scorer'

// Quality Mode is now a CO-PRIMARY engine, not a throttled fallback. In a market
// where deep 30%-MOS discounts don't exist, buying wonderful businesses at fair
// prices IS the strategy — so these entries size like any other (full-size). The
// per-position cap and sector caps still limit concentration; the quality GATES
// (tier, ROIC≥15%, score≥65, expected CAGR≥10%, MOS≥5%, F≥6) still define quality.
export const QUALITY_SIZE_MULTIPLIER = 1.0

export interface QualityModeCheck {
  eligible: boolean
  failures: string[]     // which requirements missed (for skip reasons / audit)
  rationale?: string     // set when eligible
}

export function qualifiesForQualityMode(
  f: StockFundamentals,
  philosophy: PhilosophyScore,
  iv: IntrinsicValueResult
): QualityModeCheck {
  // Vetoes always stand — quality mode relaxes the discount, never the safety checks
  if (philosophy.vetoedBy.length > 0) {
    return { eligible: false, failures: ['hard veto active'] }
  }

  const failures: string[] = []

  const tierOk = f.businessTier === 'wonderful' || f.businessTier === 'good'
  if (!tierOk) failures.push(`business tier '${f.businessTier ?? 'unknown'}' (need good/wonderful)`)

  if ((f.roic ?? 0) < 0.15) failures.push(`ROIC ${((f.roic ?? 0) * 100).toFixed(1)}% (need ≥15%)`)

  if (philosophy.total < 65) failures.push(`score ${philosophy.total} (need ≥65)`)

  // Fair price, not any price — never buy above intrinsic value
  if (iv.marginOfSafety < 5) failures.push(`MOS ${iv.marginOfSafety.toFixed(1)}% (need ≥5% — fair price, never overpay)`)

  if (iv.expectedCagr10yr === undefined || iv.expectedCagr10yr < 0.10) {
    failures.push(`10-yr expected CAGR ${iv.expectedCagr10yr !== undefined ? (iv.expectedCagr10yr * 100).toFixed(1) + '%' : 'n/a'} (need ≥10%)`)
  }

  if (f.piotroskiFScore !== undefined && f.piotroskiFScore < 6) {
    failures.push(`F-Score ${f.piotroskiFScore}/${f.piotroskiMax ?? 9} (need ≥6 — compounders must be compounding)`)
  }

  if (f.inFreefall) failures.push('price in freefall')

  if (failures.length > 0) return { eligible: false, failures }

  return {
    eligible: true,
    failures: [],
    rationale:
      `QUALITY MODE: ${f.businessTier?.toUpperCase()} business at a fair price — ` +
      `ROIC ${((f.roic ?? 0) * 100).toFixed(1)}%, score ${philosophy.total}/100, ` +
      `MOS ${iv.marginOfSafety.toFixed(1)}%, 10-yr expected CAGR ${((iv.expectedCagr10yr ?? 0) * 100).toFixed(1)}%. ` +
      `Half-size entry. "Far better to buy a wonderful company at a fair price." (Buffett 2023)`,
  }
}

// Aggregate skip/veto reasons across a run so "the bot did nothing" is
// diagnosable at a glance instead of requiring a row-by-row read.
export function summarizeBlockers(results: Array<{ action: string; reason?: string }>): Array<{ reason: string; count: number }> {
  const counts: Record<string, number> = {}
  for (const r of results) {
    if (r.action !== 'SKIP' && r.action !== 'VETOED') continue
    const key = (r.reason ?? 'unknown').slice(0, 90)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.entries(counts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
}
