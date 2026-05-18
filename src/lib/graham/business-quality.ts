// ─── Business Quality Tier ────────────────────────────────────────────────────
//
// Buffett's hierarchy of business quality, derived from decades of annual letters:
//
//   WONDERFUL — ROIC > 20%, sustained, moat widening, intelligent capital allocation.
//   "It's far better to buy a wonderful company at a fair price than a fair company
//    at a wonderful price." Hold these forever. Sell only at extreme overvaluation.
//
//   GOOD — ROIC 15-20%, solid moat, stable margins. Hold until materially overvalued.
//
//   ADEQUATE — ROIC 10-15%. Earns above cost of capital but no compelling moat.
//   Graham standard: buy at a discount, sell at fair value.
//
//   MEDIOCRE — ROIC < 10%. Business earns below its cost of capital.
//   Munger: "A great business at a great price is still a mediocre investment
//   if the business earns 8% on capital." Exit promptly.
//
// The tier determines the sell threshold: wonderful companies deserve patience
// that mediocre ones do not.

import type { StockFundamentals, BusinessTier } from '@/types'

export interface BusinessQualityResult {
  tier: BusinessTier
  sellThresholdPct: number   // % ABOVE intrinsic value before a sell is triggered
  holdForever: boolean       // true only for wonderful businesses
  reasoning: string[]
  roicLabel: string
  capitalAllocationLabel: string
}

// ─── Sell thresholds by tier ──────────────────────────────────────────────────
//
// Wonderful:  60% overvaluation — Buffett held Coke at 2-3× IV in 1998-2002
//             and still considers it a mistake to have sold any
// Good:       40% overvaluation — trim when substantially overpriced
// Adequate:   15% overvaluation — Graham standard, no reason to hold above IV
// Mediocre:  −5% (sell BELOW IV) — the thesis is questionable; exit on any strength

export const TIER_SELL_THRESHOLDS: Record<BusinessTier, number> = {
  wonderful: 60,
  good:      40,
  adequate:  15,
  mediocre:  -5,
}

// ─── Core classifier ──────────────────────────────────────────────────────────

export function classifyBusinessQuality(
  fundamentals: StockFundamentals
): BusinessQualityResult {
  const { roic, operatingMarginTrend, shareCountCagr5yr, roicHistory } = fundamentals
  const reasoning: string[] = []

  const effectiveRoic = roic
    ?? (roicHistory && roicHistory.length > 0
        ? roicHistory[roicHistory.length - 1].value
        : 0)

  // Is ROIC sustainably high? (not a one-year fluke)
  // Require ≥4 of last 5 years above 15%
  const roicSustained: boolean | undefined = roicHistory && roicHistory.length >= 5
    ? roicHistory.slice(-5).filter(v => v.value >= 0.15).length >= 4
    : undefined

  const isBuyingBack  = shareCountCagr5yr !== undefined && shareCountCagr5yr < -0.01
  const isDiluting    = shareCountCagr5yr !== undefined && shareCountCagr5yr >  0.02
  const marginsOk     = operatingMarginTrend !== 'declining'
  const marginsGrowing= operatingMarginTrend === 'improving'

  // ── Tier classification ───────────────────────────────────────────────────

  let tier: BusinessTier

  if (effectiveRoic >= 0.20 && roicSustained !== false && marginsOk && !isDiluting) {
    tier = 'wonderful'
    reasoning.push(
      `ROIC ${(effectiveRoic * 100).toFixed(1)}% — sustained above 20%, genuine economic moat. ` +
      `Buffett: "A truly great business must have an enduring moat that protects excellent returns on invested capital."`
    )
    if (isBuyingBack) reasoning.push(
      `Capital allocation A+: buying back shares — management returns excess capital at below-IV prices, ` +
      `compounding per-share value without diluting shareholders.`
    )
    if (marginsGrowing) reasoning.push(
      `Margins expanding — the moat is widening, not narrowing. ` +
      `Fisher Point 5: the most important qualitative signal of competitive durability.`
    )
  } else if (effectiveRoic >= 0.15 && marginsOk) {
    tier = 'good'
    reasoning.push(
      `ROIC ${(effectiveRoic * 100).toFixed(1)}% — above cost of capital, solid business. ` +
      `Not yet wonderful, but creates economic value. Hold until materially overvalued.`
    )
    if (roicSustained === false) reasoning.push(
      `ROIC is not yet proven sustained over 5 years — watch for regression.`
    )
    if (isDiluting) reasoning.push(
      `WARN: Share count growing ${((shareCountCagr5yr ?? 0) * 100).toFixed(1)}%/yr — ` +
      `management is diluting holders. Reduces per-share compounding. Caps at "good", not "wonderful".`
    )
  } else if (effectiveRoic >= 0.10) {
    tier = 'adequate'
    reasoning.push(
      `ROIC ${(effectiveRoic * 100).toFixed(1)}% — earns above cost of capital but no compelling moat. ` +
      `Graham standard: buy at discount, sell at fair value.`
    )
    if (!marginsOk) reasoning.push(
      `Declining margins signal competitive pressure eroding the return on capital. ` +
      `Monitor for deterioration toward "mediocre".`
    )
  } else {
    tier = 'mediocre'
    reasoning.push(
      `ROIC ${(effectiveRoic * 100).toFixed(1)}% — below cost of capital. ` +
      `This business destroys value over time: every dollar retained is worth less than a dollar. ` +
      `Munger: "Show me the incentive and I'll show you the outcome." Exit on any strength.`
    )
    if (!marginsOk) reasoning.push(
      `Declining margins compound the ROIC problem. Competitive position deteriorating.`
    )
  }

  const roicLabel =
    effectiveRoic >= 0.20 ? 'Exceptional (>20%)' :
    effectiveRoic >= 0.15 ? 'Good (15-20%)' :
    effectiveRoic >= 0.10 ? 'Adequate (10-15%)' : 'Poor (<10%)'

  const capitalAllocationLabel =
    isBuyingBack  ? `Buybacks ${((Math.abs(shareCountCagr5yr ?? 0)) * 100).toFixed(1)}%/yr — intelligent` :
    isDiluting    ? `Diluting ${(((shareCountCagr5yr ?? 0)) * 100).toFixed(1)}%/yr — destroys per-share value` :
    shareCountCagr5yr !== undefined ? 'Neutral (shares stable)' : 'Unknown'

  return {
    tier,
    sellThresholdPct: TIER_SELL_THRESHOLDS[tier],
    holdForever: tier === 'wonderful',
    reasoning,
    roicLabel,
    capitalAllocationLabel,
  }
}
