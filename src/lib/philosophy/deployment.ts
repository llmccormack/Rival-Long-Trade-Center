// ─── Deployment target & ETF cash sleeve ──────────────────────────────────────
//
// "Invested by default." A value strategy that only buys deep discounts sits in
// cash for years in an expensive market — a real, compounding drag. Rather than
// force marginal single-name bets to burn cash, the leftover flows into a broad
// value ETF sleeve so capital is working, not idle. This is a portfolio-level
// rebalance run once per full run, AFTER individual-name buys.
//
// The sleeve fills the gap between what individual names deployed and the target
// invested %, never breaching the cash reserve. As the engine finds more
// individual names over time, the sleeve shrinks to make room.

export interface SleeveInput {
  totalCapital: number
  targetInvestedPct: number        // e.g. 80 → aim to hold 80% in equities
  minCashReservePct: number        // never deploy past (100 - this)%
  individualDeployed: number       // $ in open non-sleeve positions
  currentSleeveValue: number       // $ in the ETF sleeve today
  currentSleeveShares: number
  etfPrice: number
}

export interface SleeveAction {
  action: 'buy' | 'sell' | 'hold'
  shares: number                   // shares to buy (buy) or sell (sell)
  dollarDelta: number              // signed $ change to the sleeve
  targetSleeveValue: number        // where the sleeve should end up
  reason: string
}

export function computeSleeveRebalance(input: SleeveInput): SleeveAction {
  const {
    totalCapital, targetInvestedPct, minCashReservePct,
    individualDeployed, currentSleeveValue, currentSleeveShares, etfPrice,
  } = input

  const hold = (reason: string): SleeveAction => ({
    action: 'hold', shares: 0, dollarDelta: 0, targetSleeveValue: currentSleeveValue, reason,
  })

  if (etfPrice <= 0 || totalCapital <= 0) return hold('No ETF price or capital')

  const maxDeployable = totalCapital * (1 - minCashReservePct / 100)
  const targetInvested = totalCapital * (targetInvestedPct / 100)

  // The sleeve targets the gap between the invested target and what individual
  // names already cover, clamped so total deployment never breaches the reserve
  // and the sleeve is never negative.
  const room = Math.max(0, maxDeployable - individualDeployed)
  const desiredSleeve = Math.max(0, Math.min(targetInvested - individualDeployed, room))

  const delta = desiredSleeve - currentSleeveValue

  // Ignore sub-one-share drift to avoid churn/friction
  if (Math.abs(delta) < etfPrice) return hold('Sleeve within one share of target')

  if (delta > 0) {
    const shares = Math.floor(delta / etfPrice)
    if (shares < 1) return hold('Top-up below one share')
    return {
      action: 'buy', shares, dollarDelta: shares * etfPrice,
      targetSleeveValue: currentSleeveValue + shares * etfPrice,
      reason: `Invested ${((individualDeployed / totalCapital) * 100).toFixed(0)}% in names, target ${targetInvestedPct}% — sleeve buys ${shares} ${''}shares to stay invested`,
    }
  }

  // delta < 0 → individual names grew (or target dropped); trim the sleeve to free room
  const sharesToSell = Math.min(currentSleeveShares, Math.ceil(Math.abs(delta) / etfPrice))
  if (sharesToSell < 1) return hold('Trim below one share')
  return {
    action: 'sell', shares: sharesToSell, dollarDelta: -sharesToSell * etfPrice,
    targetSleeveValue: Math.max(0, currentSleeveValue - sharesToSell * etfPrice),
    reason: `Individual names now cover the target — trimming ${sharesToSell} sleeve shares to free capital`,
  }
}
