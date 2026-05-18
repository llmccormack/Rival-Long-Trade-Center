import type { StockFundamentals } from '@/types'
import type { NewsAnalysis } from '@/lib/fmp/client'
import type { GrahamCriteria, IntrinsicValueResult } from '@/types'

export interface SellSignal {
  shouldSell: boolean
  urgency: 'immediate' | 'high' | 'moderate' | 'hold'
  reason: string
  signals: string[]
  vetoSell: boolean   // news hard-veto = sell immediately regardless
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

  // ── Hard veto: news fraud/SEC/bankruptcy → sell immediately ─────────────
  if (news && news.hardVetoFlags.length > 0) {
    vetoSell = true
    urgency = 'immediate'
    signals.push(`NEWS VETO: ${news.hardVetoFlags[0]}`)
  }

  // ── Price has reached or exceeded intrinsic value ────────────────────────
  // Moat businesses (ROE≥15%, ROIC≥15%, stable/improving margins) warrant patience:
  // Buffett holds Coca-Cola, Apple, AmEx through extended overvaluation because the moat
  // continues to compound. Require 40% overvaluation before selling a moat business.
  // Ordinary businesses: Graham Ch.20 standard — sell at IV, latest at IV+15%.
  const hasMoat =
    fundamentals.roe !== undefined && fundamentals.roe >= 0.15 &&
    fundamentals.roic !== undefined && fundamentals.roic >= 0.15 &&
    (fundamentals.operatingMarginTrend === 'stable' || fundamentals.operatingMarginTrend === 'improving')
  const sellThreshold = hasMoat ? -40 : -15

  if (iv.marginOfSafety < 5 && iv.marginOfSafety > sellThreshold) {
    const moatNote = hasMoat ? ' — moat-adjusted patience; hold unless fundamentals deteriorate' : ''
    signals.push(`Price at or above intrinsic value — MOS ${iv.marginOfSafety.toFixed(1)}%${moatNote}`)
    urgency = hasMoat ? 'moderate' : 'high'
  }
  if (iv.marginOfSafety <= sellThreshold) {
    signals.push(`Price ABOVE intrinsic value by ${Math.abs(iv.marginOfSafety).toFixed(1)}% — exceeds ${hasMoat ? 'moat-adjusted 40%' : '15%'} sell threshold`)
    urgency = 'immediate'
  }

  // ── Fundamentals have deteriorated ──────────────────────────────────────
  // Negative owner earnings (Buffett: owner earnings must be positive)
  if (fundamentals.ownerEarnings !== undefined && fundamentals.ownerEarnings < 0) {
    signals.push(`Owner earnings negative (${fundamentals.ownerEarnings.toFixed(0)}) — business deteriorating`)
    if (urgency === 'hold') urgency = 'moderate'
  }

  // Current ratio below 1 (Graham: liquidity failure)
  if (fundamentals.currentRatio !== undefined && fundamentals.currentRatio < 1.0) {
    signals.push(`Current ratio ${fundamentals.currentRatio.toFixed(2)} — liquidity risk`)
    if (urgency === 'hold') urgency = 'moderate'
  }

  // Operating margin declining (Fisher: deteriorating competitive position)
  if (fundamentals.operatingMarginTrend === 'declining') {
    signals.push(`Operating margins declining — competitive position weakening`)
    if (urgency === 'hold') urgency = 'moderate'
  }

  // ── Structural leverage trap ─────────────────────────────────────────────
  if (fundamentals.debtToEquity !== undefined && fundamentals.debtToEquity > 2.5) {
    signals.push(`Debt/equity ${fundamentals.debtToEquity.toFixed(1)}× — leverage excessive`)
    if (urgency === 'hold') urgency = 'moderate'
  }

  // ── P/E exceeds 25 and stock was bought cheap (Graham: don't overstay) ──
  if (fundamentals.pe !== undefined && fundamentals.pe > 25) {
    signals.push(`P/E ${fundamentals.pe.toFixed(1)}× — market pricing in optimism`)
    if (urgency === 'hold' && iv.marginOfSafety < 15) urgency = 'moderate'
  }

  const shouldSell = vetoSell || urgency === 'immediate' || urgency === 'high'

  const reason = signals.length > 0
    ? signals[0]
    : 'No sell triggers — hold position'

  return { shouldSell, urgency, reason, signals, vetoSell }
}
