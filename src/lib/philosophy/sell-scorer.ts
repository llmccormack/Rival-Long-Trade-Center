import type { StockFundamentals } from '@/types'
import type { NewsAnalysis } from '@/lib/fmp/client'
import type { IntrinsicValueResult } from '@/types'
import { classifyBusinessQuality } from '@/lib/graham/business-quality'

export interface SellSignal {
  shouldSell: boolean
  urgency: 'immediate' | 'high' | 'moderate' | 'hold'
  reason: string
  signals: string[]
  vetoSell: boolean   // news hard-veto = sell immediately regardless
  businessTier: string
  sellThresholdPct: number
}

export function scoreSellDecision(
  fundamentals: StockFundamentals,
  iv: IntrinsicValueResult,
  news?: NewsAnalysis,
  mosAtPurchase?: number,
): SellSignal {
  const signals: string[] = []
  let urgency: SellSignal['urgency'] = 'hold'
  let vetoSell = false

  // ── Business quality tier — the core of the sell decision ────────────────
  // This replaces a binary hasMoat check with a continuous quality scale
  // rooted in Buffett's actual hierarchy of business quality:
  //
  //   Wonderful (ROIC >20%, sustained, no dilution): hold through 60% overvaluation
  //   Good (ROIC 15-20%): sell at 40% above IV
  //   Adequate (ROIC 10-15%): sell at 15% above IV (Graham standard)
  //   Mediocre (ROIC <10%): sell at -5% (BELOW IV) — exit on any strength
  //
  // Buffett held Coke for 35 years through multiple 2-3× overvaluation episodes
  // because the moat kept compounding. He would not hold a mediocre business
  // a single day past fair value.
  const quality = classifyBusinessQuality(fundamentals)
  const sellThresholdPct = quality.sellThresholdPct
  const sellThreshold = -sellThresholdPct

  const tierLabel = quality.tier.toUpperCase()

  // ── Hard veto: news fraud/SEC/bankruptcy → sell immediately ─────────────
  if (news && news.hardVetoFlags.length > 0) {
    vetoSell = true
    urgency = 'immediate'
    signals.push(`NEWS VETO: ${news.hardVetoFlags[0]}`)
  }

  // ── Valuation sell signal — threshold varies by business quality ──────────
  if (iv.marginOfSafety < 5 && iv.marginOfSafety > sellThreshold) {
    const note = quality.tier === 'wonderful'
      ? ` — ${tierLabel} business: patience warranted through ${sellThresholdPct}% overvaluation`
      : quality.tier === 'mediocre'
      ? ` — ${tierLabel} business: near fair value, thesis questionable — prepare to exit`
      : ` — ${tierLabel} business: hold until ${sellThresholdPct}% above IV`
    signals.push(`Price at or above intrinsic value — MOS ${iv.marginOfSafety.toFixed(1)}%${note}`)
    if (quality.tier === 'mediocre') urgency = 'high'
    else if (quality.tier === 'wonderful') urgency = 'moderate'
    else urgency = 'high'
  }
  if (iv.marginOfSafety <= sellThreshold) {
    signals.push(
      `Price ${Math.abs(iv.marginOfSafety).toFixed(1)}% above intrinsic value — ` +
      `exceeds ${tierLabel} sell threshold of ${sellThresholdPct}%`
    )
    urgency = 'immediate'
  }

  // ── Fundamentals deterioration — tier-adjusted sensitivity ───────────────
  // For wonderful businesses, ONE deterioration signal is a 5-alarm warning
  // because it may mean the moat is eroding. For mediocre businesses, expected.

  if (fundamentals.ownerEarnings !== undefined && fundamentals.ownerEarnings < 0) {
    signals.push(`Owner earnings negative — business consuming more capital than it generates`)
    const bump: SellSignal['urgency'] = quality.tier === 'wonderful' ? 'immediate' : 'moderate'
    if (urgency === 'hold' || (quality.tier === 'wonderful' && urgency !== 'immediate')) urgency = bump
  }

  // Current ratio below 1 — skip for financials (structural)
  const isFinancial =
    fundamentals.sector?.toLowerCase().includes('financial') ||
    fundamentals.industry?.toLowerCase().includes('bank')
  if (!isFinancial && fundamentals.currentRatio !== undefined && fundamentals.currentRatio < 1.0) {
    signals.push(`Current ratio ${fundamentals.currentRatio.toFixed(2)} — liquidity risk`)
    if (urgency === 'hold') urgency = 'moderate'
  }

  // Operating margin declining
  if (fundamentals.operatingMarginTrend === 'declining') {
    signals.push(`Operating margins declining — competitive position weakening`)
    // For wonderful businesses, deteriorating margins are particularly alarming
    const bump: SellSignal['urgency'] = quality.tier === 'wonderful' ? 'high' : 'moderate'
    if (urgency === 'hold') urgency = bump
  }

  // Persistent share dilution — management destroying per-share value
  if (fundamentals.shareCountCagr5yr !== undefined && fundamentals.shareCountCagr5yr > 0.04) {
    signals.push(`Share count growing ${(fundamentals.shareCountCagr5yr * 100).toFixed(1)}%/yr — severe dilution`)
    if (urgency === 'hold') urgency = 'moderate'
  }

  // ── Leverage trap ─────────────────────────────────────────────────────────
  if (fundamentals.debtToEquity !== undefined && fundamentals.debtToEquity > 2.5) {
    signals.push(`Debt/equity ${fundamentals.debtToEquity.toFixed(1)}× — leverage excessive`)
    if (urgency === 'hold') urgency = 'moderate'
  }

  // ── CAGR expectation collapsed ────────────────────────────────────────────
  // If forward CAGR has fallen below the risk-free rate, the opportunity cost
  // of holding is too high — better to redeploy capital.
  if (iv.expectedCagr10yr !== undefined && iv.expectedCagr10yr < 0.04) {
    signals.push(
      `10-yr expected CAGR ${(iv.expectedCagr10yr * 100).toFixed(1)}% — below risk-free rate. ` +
      `Capital should be redeployed to higher-return opportunities.`
    )
    if (urgency === 'hold') urgency = 'moderate'
  }

  const shouldSell = vetoSell || urgency === 'immediate' || urgency === 'high'

  const reason = signals.length > 0
    ? signals[0]
    : `No sell triggers — hold. ${tierLabel} business, sell threshold: ${sellThresholdPct}% above IV.`

  return { shouldSell, urgency, reason, signals, vetoSell, businessTier: quality.tier, sellThresholdPct }
}
