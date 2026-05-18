// Capital Allocation Engine
//
// "Diversification is protection against ignorance. It makes very little sense
//  for those who know what they're doing." — Warren Buffett
//
// "The wise ones bet heavily when the world offers them that opportunity.
//  They bet big when they have the odds. And the rest of the time, they don't."
//  — Charlie Munger
//
// Position size = f(conviction, margin of safety, portfolio crowding, score quality)
// Higher conviction + wider MOS + uncrowded portfolio = larger position.

import type { ConvictionLevel } from './scorer'

export interface AllocationInput {
  totalCapital: number           // total paper/real capital in dollars
  conviction: ConvictionLevel    // from philosophy scorer
  marginOfSafety: number         // % e.g. 35.0 means 35%
  philosophyScore: number        // 0–100
  price: number                  // current share price
  maxPositionPct: number         // max % per position from config (e.g. 15)
  openPositionCount: number      // currently open positions
  maxPositions: number           // cap from config (e.g. 15)
  existingPositionValue?: number // current $ value of existing position in this stock
}

export interface AllocationResult {
  dollarAmount: number
  shares: number
  positionPct: number    // actual % of total capital this trade represents
  rationale: string
  canAllocate: boolean
  reason?: string        // why canAllocate is false
}

// Base allocation as % of total capital by conviction
const BASE: Partial<Record<ConvictionLevel, number>> = {
  strong_buy: 0.12,  // 12% — Buffett's punch-card conviction
  buy:        0.07,  // 7%  — solid Graham/Buffett opportunity
  // watchlist / hold / avoid / sell → no new capital
}

export function allocateCapital(input: AllocationInput): AllocationResult {
  const {
    totalCapital,
    conviction,
    marginOfSafety,
    philosophyScore,
    price,
    maxPositionPct,
    openPositionCount,
    maxPositions,
    existingPositionValue = 0,
  } = input

  const base = BASE[conviction] ?? 0

  if (base === 0) {
    return noAlloc(`Conviction "${conviction}" does not trigger capital deployment — waiting for better entry.`)
  }

  // Buffett's punch-card: portfolio full means wait for something better to close
  if (openPositionCount >= maxPositions) {
    return noAlloc(
      `Portfolio at capacity (${openPositionCount}/${maxPositions} positions). ` +
      `Buffett: "The punch card has a limit." Close a weaker position to free a slot.`
    )
  }

  // ── Multipliers ────────────────────────────────────────────────────────────

  // Klarman: size proportionally to the margin of safety
  const mosMult =
    marginOfSafety >= 50 ? 1.30 :
    marginOfSafety >= 40 ? 1.15 :
    marginOfSafety >= 30 ? 1.00 :
    marginOfSafety >= 20 ? 0.80 : 0.60

  // Higher philosophy score → higher quality business → more capital warranted
  const scoreMult =
    philosophyScore >= 80 ? 1.15 :
    philosophyScore >= 70 ? 1.05 :
    philosophyScore >= 60 ? 1.00 : 0.85

  // Be more selective as the portfolio fills up (Munger: say no to almost everything)
  const crowdMult =
    openPositionCount >= maxPositions * 0.9 ? 0.70 :
    openPositionCount >= maxPositions * 0.7 ? 0.85 : 1.00

  // ── Position cap check ────────────────────────────────────────────────────

  const existingPct = totalCapital > 0 ? existingPositionValue / totalCapital : 0
  const allowedPct = Math.max(0, (maxPositionPct / 100) - existingPct)

  if (allowedPct <= 0.01) {
    return noAlloc(
      `Already at max position size (${(existingPct * 100).toFixed(1)}% ≥ ${maxPositionPct}% limit). ` +
      `Graham: "Never let any single investment jeopardize the portfolio." Hold and compound.`
    )
  }

  // ── Calculate final allocation ────────────────────────────────────────────

  const rawPct = base * mosMult * scoreMult * crowdMult
  const finalPct = Math.min(rawPct, allowedPct, maxPositionPct / 100)
  const dollarTarget = totalCapital * finalPct
  const shares = Math.max(1, Math.floor(dollarTarget / price))
  const actualDollars = shares * price
  const actualPct = totalCapital > 0 ? (actualDollars / totalCapital) * 100 : 0

  const rationale = buildRationale({
    conviction, base, mosMult, scoreMult, crowdMult,
    finalPct, actualDollars, marginOfSafety, philosophyScore,
    openPositionCount, maxPositions,
  })

  return {
    dollarAmount: actualDollars,
    shares,
    positionPct: actualPct,
    canAllocate: true,
    rationale,
  }
}

function noAlloc(reason: string): AllocationResult {
  return { dollarAmount: 0, shares: 0, positionPct: 0, canAllocate: false, reason, rationale: reason }
}

function buildRationale(p: {
  conviction: ConvictionLevel
  base: number
  mosMult: number
  scoreMult: number
  crowdMult: number
  finalPct: number
  actualDollars: number
  marginOfSafety: number
  philosophyScore: number
  openPositionCount: number
  maxPositions: number
}): string {
  const parts: string[] = []

  if (p.conviction === 'strong_buy') {
    parts.push(`STRONG BUY: base ${(p.base * 100).toFixed(0)}% of capital. Buffett: "When the odds are heavily in your favor, bet accordingly."`)
  } else {
    parts.push(`BUY: base ${(p.base * 100).toFixed(0)}% of capital.`)
  }

  if (p.mosMult > 1.0) {
    parts.push(`MOS ${p.marginOfSafety.toFixed(1)}% → +${((p.mosMult - 1) * 100).toFixed(0)}% size boost. Klarman: size proportionally to safety margin.`)
  } else if (p.mosMult < 1.0) {
    parts.push(`MOS ${p.marginOfSafety.toFixed(1)}% → −${((1 - p.mosMult) * 100).toFixed(0)}% reduction; cushion below optimal.`)
  }

  if (p.scoreMult !== 1.0) {
    const sign = p.scoreMult > 1 ? '+' : '−'
    parts.push(`Score ${p.philosophyScore}/100 → ${sign}${(Math.abs(p.scoreMult - 1) * 100).toFixed(0)}%.`)
  }

  if (p.crowdMult < 1.0) {
    parts.push(`Portfolio crowding (${p.openPositionCount}/${p.maxPositions}) → −${((1 - p.crowdMult) * 100).toFixed(0)}%. Munger: raise the bar as the book fills.`)
  }

  parts.push(`Final: ${(p.finalPct * 100).toFixed(1)}% = $${p.actualDollars.toFixed(0)}.`)

  return parts.join(' ')
}
