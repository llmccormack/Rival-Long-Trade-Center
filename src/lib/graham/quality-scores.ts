// ─── Quantitative Quality Scores ──────────────────────────────────────────────
//
// Piotroski F-Score (Journal of Accounting Research, 2000):
// 9 binary checks separating cheap-and-recovering from cheap-and-dying.
// Piotroski's result: within the cheapest P/B quintile, high-F firms outperform
// low-F firms by ~7.5%/yr. This is the single best-documented guard against
// value traps — exactly the stocks a Graham screener surfaces.
//
// Altman Z-Score (Journal of Finance, 1968):
// Distance-to-bankruptcy for non-financial firms.
//   Z > 2.99  safe zone      1.81–2.99  grey zone      Z < 1.81  distress zone
// A statistically cheap stock in the distress zone is usually cheap because
// it is dying. Not meaningful for banks/insurers (skip financials).

// Minimal structural types — match the FMP statement shapes without importing
// non-exported interfaces from the client.
interface IncomeLike {
  calendarYear: string
  revenue: number
  grossProfit: number
  operatingIncome: number
  netIncome: number
  weightedAverageShsOut?: number
}
interface BalanceLike {
  calendarYear: string
  totalAssets: number
  totalLiabilities: number
  totalCurrentAssets: number
  totalCurrentLiabilities: number
  longTermDebt: number
  retainedEarnings?: number
}
interface CashFlowLike {
  calendarYear: string
  operatingCashFlow: number
}

export interface PiotroskiResult {
  score: number        // components passed
  max: number          // components computable (≤9) — report score/max, not score/9
  details: string[]    // human-readable pass/fail per component
}

// Statements arrive newest-first from FMP.
export function computePiotroskiFScore(
  income: IncomeLike[],
  balance: BalanceLike[],
  cash: CashFlowLike[]
): PiotroskiResult | undefined {
  const inc0 = income[0], inc1 = income[1]
  const bal0 = balance[0], bal1 = balance[1]
  const cf0 = cash[0], cf1 = cash[1]
  if (!inc0 || !bal0 || !cf0) return undefined

  let score = 0
  let max = 0
  const details: string[] = []

  const check = (computable: boolean, passed: boolean, label: string) => {
    if (!computable) { details.push(`${label}: n/a`); return }
    max += 1
    if (passed) { score += 1; details.push(`${label}: PASS`) }
    else details.push(`${label}: fail`)
  }

  // ── Profitability (4) ──
  const roa0 = bal0.totalAssets > 0 ? inc0.netIncome / bal0.totalAssets : undefined
  const roa1 = inc1 && bal1 && bal1.totalAssets > 0 ? inc1.netIncome / bal1.totalAssets : undefined
  check(roa0 !== undefined, (roa0 ?? 0) > 0, 'ROA positive')
  check(true, cf0.operatingCashFlow > 0, 'Operating cash flow positive')
  check(roa0 !== undefined && roa1 !== undefined, (roa0 ?? 0) > (roa1 ?? 0), 'ROA improving')
  check(true, cf0.operatingCashFlow > inc0.netIncome, 'CFO exceeds net income (accruals)')

  // ── Leverage / Liquidity / Dilution (3) ──
  const lev0 = bal0.totalAssets > 0 ? bal0.longTermDebt / bal0.totalAssets : undefined
  const lev1 = bal1 && bal1.totalAssets > 0 ? bal1.longTermDebt / bal1.totalAssets : undefined
  check(lev0 !== undefined && lev1 !== undefined, (lev0 ?? 1) <= (lev1 ?? 0), 'Leverage flat or falling')

  const cr0 = bal0.totalCurrentLiabilities > 0 ? bal0.totalCurrentAssets / bal0.totalCurrentLiabilities : undefined
  const cr1 = bal1 && bal1.totalCurrentLiabilities > 0 ? bal1.totalCurrentAssets / bal1.totalCurrentLiabilities : undefined
  check(cr0 !== undefined && cr1 !== undefined, (cr0 ?? 0) > (cr1 ?? 0), 'Current ratio improving')

  const sh0 = inc0.weightedAverageShsOut, sh1 = inc1?.weightedAverageShsOut
  // 1% tolerance — tiny share-count noise from RSU vesting is not "issuance"
  check(!!sh0 && !!sh1, !!sh0 && !!sh1 && sh0 <= sh1 * 1.01, 'No net share issuance')

  // ── Operating efficiency (2) ──
  const gm0 = inc0.revenue > 0 ? inc0.grossProfit / inc0.revenue : undefined
  const gm1 = inc1 && inc1.revenue > 0 ? inc1.grossProfit / inc1.revenue : undefined
  check(gm0 !== undefined && gm1 !== undefined, (gm0 ?? 0) > (gm1 ?? 0), 'Gross margin improving')

  const at0 = bal0.totalAssets > 0 ? inc0.revenue / bal0.totalAssets : undefined
  const at1 = inc1 && bal1 && bal1.totalAssets > 0 ? inc1.revenue / bal1.totalAssets : undefined
  check(at0 !== undefined && at1 !== undefined, (at0 ?? 0) > (at1 ?? 0), 'Asset turnover improving')

  // Fewer than 5 computable components → too little signal to report
  if (max < 5) return undefined
  return { score, max, details }
}

// Original 1968 Z for public non-financial companies.
export function computeAltmanZ(params: {
  income?: IncomeLike
  balance?: BalanceLike
  marketCap?: number
}): number | undefined {
  const { income, balance, marketCap } = params
  if (!income || !balance || !marketCap || marketCap <= 0) return undefined
  const ta = balance.totalAssets
  const tl = balance.totalLiabilities
  if (!ta || ta <= 0 || !tl || tl <= 0) return undefined
  const re = balance.retainedEarnings
  if (re === undefined || re === null) return undefined

  const workingCapital = balance.totalCurrentAssets - balance.totalCurrentLiabilities
  return (
    1.2 * (workingCapital / ta) +
    1.4 * (re / ta) +
    3.3 * (income.operatingIncome / ta) +   // EBIT proxy
    0.6 * (marketCap / tl) +
    1.0 * (income.revenue / ta)
  )
}
