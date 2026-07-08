// Capital Allocation Engine
//
// "Diversification is protection against ignorance. It makes very little sense
//  for those who know what they're doing." — Warren Buffett
//
// "The wise ones bet heavily when the world offers them that opportunity.
//  They bet big when they have the odds. And the rest of the time, they don't."
//  — Charlie Munger
//
// Position size = f(conviction, margin of safety, portfolio crowding, score, sector)
// Higher conviction + wider MOS + uncrowded portfolio + no sector concentration = larger bet.
//
// Conviction tiers and base allocations:
//   exceptional  — 20%: score ≥ 85, MOS ≥ 40%. Buffett in 1964 put 40% in AmEx.
//   strong_buy   — 15%: score ≥ 75, MOS ≥ 30%. High-confidence Graham/Buffett entry.
//   buy          —  7%: score ≥ 60, MOS ≥ 30%. Standard value entry.

import type { ConvictionLevel } from './scorer'

export interface AllocationInput {
  totalCapital: number
  conviction: ConvictionLevel
  marginOfSafety: number         // e.g. 35.0 = 35%
  philosophyScore: number        // 0–100
  price: number
  maxPositionPct: number         // user-configured max per position (e.g. 15)
  openPositionCount: number
  maxPositions: number
  existingPositionValue?: number
  deployedCapital?: number
  minCashReservePct?: number
  avgCostBasis?: number
  // Sector concentration
  stockSector?: string
  sectorExposure?: Record<string, number>  // sector → total $ currently held
  maxSectorPct?: number          // max % of capital in any one sector (default 30)
  // Falling-knife / thesis-health guards
  piotroskiFScore?: number       // averaging-down boost requires F ≥ 5 (thesis intact)
  inFreefall?: boolean           // at 6-mo low with ≤−15% 3-mo momentum — block NEW positions
  marginTrendDeclining?: boolean // Fisher Point 5 violation — no averaging-down boost
  // Entry-mode sizing: quality-mode entries pass 0.5 (half-size — thinner MOS = smaller bet)
  sizeMultiplier?: number
}

export interface AllocationResult {
  dollarAmount: number
  shares: number
  positionPct: number
  rationale: string
  canAllocate: boolean
  reason?: string
}

// Base allocation as % of total capital by conviction.
// These are starting points — multipliers push them higher or lower.
const BASE: Partial<Record<ConvictionLevel, number>> = {
  exceptional: 0.20,  // Buffett: "When you see a great opportunity, bet heavily"
  strong_buy:  0.15,  // Raised from 0.12 — high confidence deserves more capital
  buy:         0.07,
}

// Hard ceiling per position regardless of multipliers.
// exceptional can reach 25%, others capped at user's maxPositionPct.
const EXCEPTIONAL_CEILING = 0.25

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
    deployedCapital,
    minCashReservePct = 15,
    avgCostBasis,
    stockSector,
    sectorExposure,
    maxSectorPct = 30,
    piotroskiFScore,
    inFreefall,
    marginTrendDeclining,
    sizeMultiplier = 1.0,
  } = input

  const base = BASE[conviction] ?? 0

  if (base === 0) {
    return noAlloc(`Conviction "${conviction}" does not trigger capital deployment — waiting for better entry.`)
  }

  // Falling-knife gate: never INITIATE a position in freefall. Cheap can get
  // cheaper — the value+momentum literature is unambiguous that waiting for
  // stabilization improves value-strategy returns. Existing positions may still
  // average down below (subject to the thesis-health gate).
  if (inFreefall && existingPositionValue === 0) {
    return noAlloc(
      `Falling knife — price is at its 6-month low with ≤−15% three-month momentum. ` +
      `The thesis may be right, but the entry is wrong. Re-evaluate once price stabilizes.`
    )
  }

  // Portfolio at capacity
  if (openPositionCount >= maxPositions) {
    return noAlloc(
      `Portfolio at capacity (${openPositionCount}/${maxPositions} positions). ` +
      `Buffett: "The punch card has a limit." Close a weaker position to free a slot.`
    )
  }

  // Cash reserve floor — keep minCashReservePct% permanently in reserve
  if (deployedCapital !== undefined) {
    const maxDeployable = totalCapital * (1 - minCashReservePct / 100)
    if (deployedCapital >= maxDeployable) {
      return noAlloc(
        `Cash reserve floor reached — deployed $${deployedCapital.toFixed(0)} of $${maxDeployable.toFixed(0)} max ` +
        `(${minCashReservePct}% reserve required). Free capital before adding positions.`
      )
    }
  }

  // Near-full portfolio raises the minimum score threshold (Munger: raise the bar as the book fills)
  const crowdRatio = openPositionCount / maxPositions
  const dynamicMinScore = crowdRatio >= 0.9 ? 70 : crowdRatio >= 0.7 ? 62 : 55
  if (philosophyScore < dynamicMinScore) {
    return noAlloc(
      `Portfolio ${Math.round(crowdRatio * 100)}% full — minimum score is now ${dynamicMinScore}/100 ` +
      `(this stock: ${philosophyScore}/100). Munger: raise the bar as the punch card fills.`
    )
  }

  // ── Sector concentration cap ──────────────────────────────────────────────
  // Never let any single sector exceed maxSectorPct% of total capital.
  // Correlated sectors reprice together — 4 banks in 2008 is one position, not four.
  let currentSectorPct = 0
  if (stockSector && sectorExposure && totalCapital > 0) {
    const currentSectorValue = sectorExposure[stockSector] ?? 0
    currentSectorPct = (currentSectorValue / totalCapital) * 100
    if (currentSectorPct >= maxSectorPct) {
      return noAlloc(
        `Sector concentration limit reached — ${stockSector} is already ${currentSectorPct.toFixed(1)}% of capital ` +
        `(max ${maxSectorPct}%). Correlated sector exposure is a single macro bet, not diversification.`
      )
    }
  }

  // ── Multipliers ────────────────────────────────────────────────────────────

  // Klarman: size proportionally to margin of safety.
  // More granular curve — a 60% MOS is categorically different from a 35% MOS.
  // Extreme MOS (≥60%) justifies maximum concentration: the discount itself provides the return.
  const mosMult =
    marginOfSafety >= 60 ? 1.50 :
    marginOfSafety >= 50 ? 1.35 :
    marginOfSafety >= 45 ? 1.25 :
    marginOfSafety >= 40 ? 1.15 :
    marginOfSafety >= 35 ? 1.07 :
    marginOfSafety >= 30 ? 1.00 :
    marginOfSafety >= 25 ? 0.85 :
    marginOfSafety >= 20 ? 0.70 : 0.50

  // Higher philosophy score → higher quality thesis → more capital warranted
  const scoreMult =
    philosophyScore >= 85 ? 1.20 :
    philosophyScore >= 80 ? 1.10 :
    philosophyScore >= 70 ? 1.05 :
    philosophyScore >= 60 ? 1.00 : 0.85

  // More selective as portfolio fills
  const crowdMult =
    openPositionCount >= maxPositions * 0.9 ? 0.70 :
    openPositionCount >= maxPositions * 0.7 ? 0.85 : 1.00

  // Averaging-down boost — price below our cost basis is a better entry,
  // but ONLY if the thesis is intact. A price drop alone is not confirmation;
  // boosting into deteriorating fundamentals is how value investors blow up
  // (Buffett averaged down on thesis reconfirmation, not on price).
  let avgDownMult = 1.0
  let avgDownDiscount = 0
  let avgDownBlocked: string | undefined
  if (avgCostBasis && avgCostBasis > 0 && price < avgCostBasis) {
    avgDownDiscount = (avgCostBasis - price) / avgCostBasis
    const thesisIntact =
      !marginTrendDeclining &&
      !inFreefall &&
      (piotroskiFScore === undefined || piotroskiFScore >= 5)
    if (thesisIntact) {
      avgDownMult = avgDownDiscount >= 0.15 ? 1.30 : avgDownDiscount >= 0.10 ? 1.20 : avgDownDiscount >= 0.05 ? 1.10 : 1.0
    } else {
      avgDownBlocked = inFreefall ? 'price in freefall'
        : marginTrendDeclining ? 'operating margins declining'
        : `Piotroski F-Score ${piotroskiFScore} < 5`
    }
  }

  // Sector headroom trim — if approaching sector cap, scale down proportionally
  let sectorTrimMult = 1.0
  if (stockSector && sectorExposure && totalCapital > 0) {
    const headroomPct = maxSectorPct - currentSectorPct
    if (headroomPct < 10) {
      // Less than 10% headroom — scale allocation down to fit
      sectorTrimMult = headroomPct / 10
    }
  }

  // ── Position cap ──────────────────────────────────────────────────────────

  const existingPct = totalCapital > 0 ? existingPositionValue / totalCapital : 0
  const hardCap = conviction === 'exceptional' ? EXCEPTIONAL_CEILING : maxPositionPct / 100
  const allowedPct = Math.max(0, hardCap - existingPct)

  if (allowedPct <= 0.01) {
    return noAlloc(
      `Already at max position size (${(existingPct * 100).toFixed(1)}% ≥ ${(hardCap * 100).toFixed(0)}% limit). ` +
      `Hold and compound.`
    )
  }

  // ── Final allocation ──────────────────────────────────────────────────────

  const rawPct = base * mosMult * scoreMult * crowdMult * avgDownMult * sectorTrimMult * sizeMultiplier
  const finalPct = Math.min(rawPct, allowedPct, hardCap)
  const dollarTarget = totalCapital * finalPct

  // Hard clamp: ensure post-trade sector exposure cannot exceed cap
  let dollarAmount = dollarTarget
  if (input.stockSector && input.sectorExposure && input.maxSectorPct) {
    const currentSectorExposure = input.sectorExposure[input.stockSector] ?? 0
    const maxSectorDollars = (input.totalCapital * input.maxSectorPct) / 100
    const remainingSectorRoom = Math.max(0, maxSectorDollars - currentSectorExposure)
    dollarAmount = Math.min(dollarAmount, remainingSectorRoom)
    if (dollarAmount < price) {
      return { dollarAmount: 0, shares: 0, positionPct: 0, rationale: '', canAllocate: false, reason: `Sector cap reached for ${input.stockSector}` }
    }
  }

  // Minimum share invariant: if computed dollar amount is less than share price, do not force 1 share
  const rawShares = Math.floor(dollarAmount / price)
  if (rawShares < 1) {
    return { dollarAmount: 0, shares: 0, positionPct: 0, rationale: '', canAllocate: false, reason: 'Computed allocation below share price — insufficient capital for even 1 share' }
  }
  const shares = rawShares
  const actualDollars = shares * price
  const actualPct = totalCapital > 0 ? (actualDollars / totalCapital) * 100 : 0

  const rationale = buildRationale({
    conviction, base, mosMult, scoreMult, crowdMult, avgDownMult, avgDownDiscount,
    avgDownBlocked, sectorTrimMult, finalPct, actualDollars, marginOfSafety, philosophyScore,
    openPositionCount, maxPositions, stockSector, currentSectorPct, maxSectorPct,
  })

  return { dollarAmount: actualDollars, shares, positionPct: actualPct, canAllocate: true, rationale }
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
  avgDownMult: number
  avgDownDiscount: number
  avgDownBlocked?: string
  sectorTrimMult: number
  finalPct: number
  actualDollars: number
  marginOfSafety: number
  philosophyScore: number
  openPositionCount: number
  maxPositions: number
  stockSector?: string
  currentSectorPct: number
  maxSectorPct: number
}): string {
  const parts: string[] = []

  if (p.conviction === 'exceptional') {
    parts.push(`EXCEPTIONAL: base ${(p.base * 100).toFixed(0)}% of capital. Score ≥85 + MOS ≥40% — rare, highest conviction. Buffett: "When you see a great opportunity, bet heavily."`)
  } else if (p.conviction === 'strong_buy') {
    parts.push(`STRONG BUY: base ${(p.base * 100).toFixed(0)}% of capital.`)
  } else {
    parts.push(`BUY: base ${(p.base * 100).toFixed(0)}% of capital.`)
  }

  if (p.mosMult > 1.0) {
    parts.push(`MOS ${p.marginOfSafety.toFixed(1)}% → +${((p.mosMult - 1) * 100).toFixed(0)}% boost. Klarman: size to the safety margin.`)
  } else if (p.mosMult < 1.0) {
    parts.push(`MOS ${p.marginOfSafety.toFixed(1)}% → −${((1 - p.mosMult) * 100).toFixed(0)}% reduction.`)
  }

  if (p.scoreMult !== 1.0) {
    const sign = p.scoreMult > 1 ? '+' : '−'
    parts.push(`Score ${p.philosophyScore}/100 → ${sign}${(Math.abs(p.scoreMult - 1) * 100).toFixed(0)}%.`)
  }

  if (p.crowdMult < 1.0) {
    parts.push(`Portfolio ${Math.round((p.openPositionCount / p.maxPositions) * 100)}% full → −${((1 - p.crowdMult) * 100).toFixed(0)}%. Munger: raise the bar as the book fills.`)
  }

  if (p.avgDownMult > 1.0) {
    parts.push(`Averaging down: price ${(p.avgDownDiscount * 100).toFixed(1)}% below cost basis, thesis intact → +${((p.avgDownMult - 1) * 100).toFixed(0)}%.`)
  } else if (p.avgDownBlocked) {
    parts.push(`Averaging-down boost WITHHELD (${p.avgDownBlocked}) — a lower price is not thesis confirmation.`)
  }

  if (p.sectorTrimMult < 1.0 && p.stockSector) {
    parts.push(`Sector headroom (${p.stockSector} at ${p.currentSectorPct.toFixed(1)}% of ${p.maxSectorPct}% cap) → −${((1 - p.sectorTrimMult) * 100).toFixed(0)}% trim.`)
  }

  parts.push(`Final: ${(p.finalPct * 100).toFixed(1)}% = $${p.actualDollars.toFixed(0)}.`)
  return parts.join(' ')
}
