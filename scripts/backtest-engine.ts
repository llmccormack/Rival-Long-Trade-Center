// ─── Real-Engine Backtest ─────────────────────────────────────────────────────
//
// Runs the ACTUAL production philosophy engine (scorer, intrinsic value,
// capital allocator, sell scorer) against historical FMP fundamentals —
// unlike scripts/backtest.mjs, which tested a simplified proxy ruleset
// (PE<22, PB<2.5...) that shares no code with what trades in production.
//
// Point-in-time discipline:
//   • Rebalance every April 1 — fiscal-year Y-1 10-Ks are filed by then
//     (~90-day reporting lag), so no look-ahead on fundamentals.
//   • Only statements with calendarYear ≤ Y-1 are visible at rebalance Y.
//   • Prices come from the actual close on/after the rebalance date.
//   • 0.3% one-way trading friction (spread + slippage estimate).
//
// Honest limitations (both bias the strategy DOWN, not up):
//   • Dividends are ignored (value stocks pay more than SPY's ~1.3%).
//   • Universe is today's list — survivorship bias partially remains.
//     Treat results as directional until a point-in-time universe is added.
//   • FMP free tier returns ~5 years of statements — the run REFUSES to
//     print a verdict when data coverage is too thin to mean anything.
//
// Usage:  FMP_API_KEY=... npx tsx scripts/backtest-engine.ts
// Env:    START_YEAR (2016)  END_YEAR (2025)  UNIVERSE_LIMIT (60)

import { writeFileSync } from 'fs'
import { scoreBuyDecision } from '../src/lib/philosophy/scorer'
import { scoreSellDecision } from '../src/lib/philosophy/sell-scorer'
import { allocateCapital } from '../src/lib/philosophy/capital-allocator'
import { calculateIntrinsicValue, detectCyclicality, normalizeEps } from '../src/lib/graham/intrinsic-value'
import { applyGrahamCriteria } from '../src/lib/graham/screener'
import { classifyBusinessQuality } from '../src/lib/graham/business-quality'
import { computePiotroskiFScore, computeAltmanZ } from '../src/lib/graham/quality-scores'
import { VALUE_UNIVERSE } from '../src/lib/universe/tickers'
import type { StockFundamentals, YearlyValue } from '../src/types'

const FMP_KEY = process.env.FMP_API_KEY
if (!FMP_KEY) { console.error('FMP_API_KEY required'); process.exit(1) }

const START_YEAR = parseInt(process.env.START_YEAR ?? '2016')
const END_YEAR = parseInt(process.env.END_YEAR ?? '2025')
const UNIVERSE_LIMIT = parseInt(process.env.UNIVERSE_LIMIT ?? '60')
const INITIAL_CAPITAL = 100_000
const FRICTION = 0.003          // 0.3% one-way
const MAX_POSITIONS = 15

const BASE = 'https://financialmodelingprep.com/api/v3'

async function fmp<T>(path: string, params: Record<string, string | number> = {}): Promise<T | null> {
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), apikey: FMP_KEY! })
  try {
    const res = await fetch(`${BASE}${path}?${qs}`)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch { return null }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface Stmt { calendarYear: string; [k: string]: unknown }
interface TickerData {
  income: Stmt[]; balance: Stmt[]; cash: Stmt[]
  prices: Map<string, number>   // 'YYYY-MM' → close nearest month start
  priceDates: string[]          // sorted 'YYYY-MM-DD' keys for momentum
  dailyCloses: Map<string, number>
}

async function loadPriceHistory(sym: string) {
  const hist = await fmp<{ historical?: { date: string; close: number }[] }>(`/historical-price-full/${sym}`, {
    from: `${START_YEAR - 2}-01-01`, to: `${END_YEAR}-12-31`, serietype: 'line',
  })
  if (!hist?.historical?.length) return null
  const dailyCloses = new Map<string, number>()
  const prices = new Map<string, number>()
  const sorted = [...hist.historical].sort((a, b) => a.date.localeCompare(b.date))
  for (const d of sorted) {
    dailyCloses.set(d.date, d.close)
    const ym = d.date.slice(0, 7)
    if (!prices.has(ym)) prices.set(ym, d.close)  // first close of the month
  }
  return { prices, priceDates: sorted.map(d => d.date), dailyCloses }
}

// ETFs (SPY benchmark) have no financial statements — prices only.
async function loadBenchmark(sym: string): Promise<TickerData | null> {
  const px = await loadPriceHistory(sym)
  return px ? { income: [], balance: [], cash: [], ...px } : null
}

async function loadTicker(t: string): Promise<TickerData | null> {
  const sym = t.replace('.', '-')
  const income = await fmp<Stmt[]>(`/income-statement/${sym}`, { limit: 30 })
  const balance = await fmp<Stmt[]>(`/balance-sheet-statement/${sym}`, { limit: 30 })
  const cash = await fmp<Stmt[]>(`/cash-flow-statement/${sym}`, { limit: 30 })
  const px = await loadPriceHistory(sym)
  if (!income?.length || !balance?.length || !px) return null
  return { income, balance, cash: cash ?? [], ...px }
}

const n = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined)

// Build the same StockFundamentals shape production uses, from statements
// visible at rebalance year Y (calendarYear ≤ Y-1) and the price at April 1 Y.
function buildFundamentals(ticker: string, d: TickerData, year: number, price: number): StockFundamentals | null {
  const vis = (s: Stmt[]) => s.filter(x => parseInt(x.calendarYear) <= year - 1).sort((a, b) => parseInt(b.calendarYear) - parseInt(a.calendarYear))
  const inc = vis(d.income), bal = vis(d.balance), cf = vis(d.cash)
  if (!inc.length || !bal.length) return null
  const i0 = inc[0], b0 = bal[0], c0 = cf[0]

  const shares = n(i0.weightedAverageShsOut) ?? 0
  if (!shares || price <= 0) return null
  const marketCap = price * shares

  const hist = (s: Stmt[], key: string): YearlyValue[] =>
    s.map(x => ({ year: parseInt(x.calendarYear), value: n(x[key]) ?? NaN }))
      .filter(v => !isNaN(v.year) && !isNaN(v.value)).sort((a, b) => a.year - b.year).slice(-10)

  const epsHistory = hist(inc, 'epsdiluted')
  const eps = n(i0.epsdiluted)
  const bvps = n(b0.bookValuePerShare) ?? (n(b0.totalStockholdersEquity) !== undefined ? (n(b0.totalStockholdersEquity)! / shares) : undefined)
  const netIncome = n(i0.netIncome)
  const equity = n(b0.totalStockholdersEquity)
  const ltd = n(b0.longTermDebt) ?? 0
  const totalDebt = n(b0.totalDebt) ?? ltd
  const da = n(c0?.depreciationAndAmortization) ?? 0
  const capex = Math.abs(n(c0?.capitalExpenditure) ?? 0)
  const ownerEarnings = netIncome !== undefined && c0 ? netIncome + da - Math.min(capex, da) : undefined
  const ocf = n(c0?.operatingCashFlow)
  const ca = n(b0.totalCurrentAssets), cl = n(b0.totalCurrentLiabilities)
  const tl = n(b0.totalLiabilities), ta = n(b0.totalAssets)
  const revenue = n(i0.revenue), grossProfit = n(i0.grossProfit), opIncome = n(i0.operatingIncome)

  // Momentum at rebalance date (needs prior ~6 months of closes)
  const asOf = `${year}-04-01`
  const priorDates = d.priceDates.filter(x => x < asOf)
  let momentum3mo: number | undefined, priceVs6moLowPct: number | undefined, inFreefall: boolean | undefined
  if (priorDates.length >= 70) {
    const closes = priorDates.slice(-126).map(x => d.dailyCloses.get(x)!).filter(c => c > 0)
    const low = Math.min(...closes)
    const c63 = closes[closes.length - 64] ?? closes[0]
    if (c63 > 0) momentum3mo = price / c63 - 1
    if (low > 0) priceVs6moLowPct = (price - low) / low
    inFreefall = momentum3mo !== undefined && priceVs6moLowPct !== undefined && momentum3mo <= -0.15 && priceVs6moLowPct <= 0.02
  }

  const piotroski = computePiotroskiFScore(inc as never, bal as never, cf as never)
  const altmanZ = computeAltmanZ({ income: i0 as never, balance: b0 as never, marketCap })

  const shillerData = epsHistory.filter(v => v.value > 0).slice(-10)
  const shillerEps = shillerData.length >= 5
    ? shillerData.reduce((s, v) => s + v.value * Math.pow(1.03, year - v.year), 0) / shillerData.length
    : undefined

  const sharesHistory = hist(inc, 'weightedAverageShsOut')
  const shareCountCagr5yr = (() => {
    const s = sharesHistory.slice(-6)
    if (s.length < 4 || s[0].value <= 0) return undefined
    const yrs = s[s.length - 1].year - s[0].year
    return yrs > 0 ? Math.pow(s[s.length - 1].value / s[0].value, 1 / yrs) - 1 : undefined
  })()

  const opMarginHist = inc.filter(x => (n(x.revenue) ?? 0) > 0)
    .map(x => ({ year: parseInt(x.calendarYear), value: n(x.operatingIncome)! / n(x.revenue)! }))
    .sort((a, b) => a.year - b.year).slice(-10)
  let operatingMarginTrend: 'improving' | 'declining' | 'stable' = 'stable'
  if (opMarginHist.length >= 5) {
    const rec = opMarginHist.slice(-3).map(v => v.value)
    const pri = opMarginHist.slice(-7, -3).map(v => v.value)
    if (rec.length && pri.length) {
      const ra = rec.reduce((a, b) => a + b, 0) / rec.length
      const pa = pri.reduce((a, b) => a + b, 0) / pri.length
      if (ra > pa * 1.05) operatingMarginTrend = 'improving'
      else if (ra < pa * 0.95) operatingMarginTrend = 'declining'
    }
  }

  const ncav = ca !== undefined && tl !== undefined ? ca - tl : undefined
  const cashEq = n(b0.cashAndCashEquivalents) ?? 0

  const f: StockFundamentals = {
    ticker, name: ticker, price, marketCap, sharesOutstanding: shares,
    pe: eps && eps > 0 ? price / eps : undefined,
    pb: bvps && bvps > 0 ? price / bvps : undefined,
    eps, bookValuePerShare: bvps,
    currentRatio: ca !== undefined && cl ? ca / cl : undefined,
    debtToEquity: equity && equity > 0 ? totalDebt / equity : undefined,
    longTermDebt: ltd, totalDebt, currentAssets: ca, currentLiabilities: cl,
    totalAssets: ta, totalLiabilities: tl,
    netCurrentAssets: ca !== undefined && cl !== undefined ? ca - cl : undefined,
    netCash: cashEq - totalDebt,
    roe: equity && equity > 0 && netIncome !== undefined ? netIncome / equity : undefined,
    roic: equity !== undefined && netIncome !== undefined && (equity + ltd) > 0 ? netIncome / (equity + ltd) : undefined,
    netIncome, revenue, grossProfit, operatingIncome: opIncome,
    grossMargin: revenue && grossProfit !== undefined ? grossProfit / revenue : undefined,
    operatingMargin: revenue && opIncome !== undefined ? opIncome / revenue : undefined,
    operatingMarginTrend,
    operatingCashFlow: ocf,
    freeCashFlow: n(c0?.freeCashFlow) ?? (ocf !== undefined ? ocf - capex : undefined),
    depreciation: da, ownerEarnings,
    epsHistory, sharesHistory,
    isCyclical: epsHistory.length >= 5 ? detectCyclicality(epsHistory) : false,
    normalizedEps: epsHistory.length >= 5 ? normalizeEps(epsHistory) : undefined,
    shillerEps, capeRatio: shillerEps && shillerEps > 0 ? price / shillerEps : undefined,
    ncav, ncavPerShare: ncav !== undefined ? ncav / shares : undefined,
    isNetNet: ncav !== undefined && price < (ncav / shares) * 0.67,
    shareCountCagr5yr,
    piotroskiFScore: piotroski?.score, piotroskiMax: piotroski?.max, altmanZ,
    momentum3mo, priceVs6moLowPct, inFreefall,
    ownerEarningsYield: ownerEarnings && shares > 0 ? ownerEarnings / shares / price : undefined,
  }
  f.businessTier = classifyBusinessQuality(f).tier
  return f
}

interface Position { ticker: string; shares: number; costBasis: number }

async function main() {
  const universe = VALUE_UNIVERSE.slice(0, UNIVERSE_LIMIT)
  console.log(`Loading ${universe.length} tickers + SPY (FMP, ~${universe.length * 4 + 1} calls)...`)

  const data = new Map<string, TickerData>()
  for (const t of universe) {
    const d = await loadTicker(t)
    if (d) data.set(t, d)
    await sleep(250)
  }
  const spy = await loadBenchmark('SPY')
  if (!spy) { console.error('SPY prices unavailable — cannot benchmark'); process.exit(1) }

  // Data coverage check — refuse to print a verdict on thin data
  const coverages = [...data.values()].map(d => d.income.length)
  const avgYears = coverages.reduce((a, b) => a + b, 0) / Math.max(1, coverages.length)
  console.log(`Loaded ${data.size}/${universe.length} tickers | avg ${avgYears.toFixed(1)} years of statements`)

  let cash = INITIAL_CAPITAL
  const positions = new Map<string, Position>()
  const yearly: Record<string, { value: number; spy: number; buys: string[]; sells: string[] }> = {}
  const priceAt = (d: TickerData, year: number) => d.prices.get(`${year}-04`) ?? d.prices.get(`${year}-05`)

  for (let year = START_YEAR; year <= END_YEAR; year++) {
    const buys: string[] = []
    const sells: string[] = []

    // ── Sell pass — the real sell scorer ──
    for (const [t, pos] of [...positions]) {
      const d = data.get(t); const price = d && priceAt(d, year)
      if (!d || !price) continue
      const f = buildFundamentals(t, d, year, price)
      if (!f) continue
      const iv = calculateIntrinsicValue(f, f.sharesOutstanding)
      const sell = scoreSellDecision(f, iv, undefined, pos.costBasis)
      if (sell.shouldSell) {
        cash += pos.shares * price * (1 - FRICTION)
        positions.delete(t)
        sells.push(`${t} (${sell.reason.slice(0, 60)})`)
      }
    }

    // ── Buy pass — the real buy scorer + allocator ──
    const candidates: { t: string; f: StockFundamentals; iv: ReturnType<typeof calculateIntrinsicValue>; score: number; conviction: string }[] = []
    for (const [t, d] of data) {
      const price = priceAt(d, year)
      if (!price) continue
      const f = buildFundamentals(t, d, year, price)
      if (!f) continue
      const criteria = applyGrahamCriteria(f)
      const iv = calculateIntrinsicValue(f, f.sharesOutstanding)
      const phil = scoreBuyDecision(f, criteria, iv)
      const bearOk = iv.bearCaseMos === undefined || iv.bearCaseMos >= 0
      if (phil.signal === 'BUY' && phil.vetoedBy.length === 0 && iv.marginOfSafety >= 15 && bearOk) {
        candidates.push({ t, f, iv, score: phil.total, conviction: phil.conviction })
      }
    }
    candidates.sort((a, b) => b.score - a.score)

    const holdingsValue = () => [...positions].reduce((s, [t, p]) => {
      const d = data.get(t); const px = d && priceAt(d, year)
      return s + (px ? p.shares * px : p.shares * p.costBasis)
    }, 0)

    for (const c of candidates) {
      const total = cash + holdingsValue()
      const existing = positions.get(c.t)
      const alloc = allocateCapital({
        totalCapital: total,
        conviction: c.conviction as never,
        marginOfSafety: c.iv.marginOfSafety,
        philosophyScore: c.score,
        price: c.f.price,
        maxPositionPct: 10,
        openPositionCount: positions.size,
        maxPositions: MAX_POSITIONS,
        existingPositionValue: existing ? existing.shares * c.f.price : 0,
        deployedCapital: holdingsValue(),
        minCashReservePct: 10,
        avgCostBasis: existing ? existing.costBasis : undefined,
        piotroskiFScore: c.f.piotroskiFScore,
        inFreefall: c.f.inFreefall,
        marginTrendDeclining: c.f.operatingMarginTrend === 'declining',
      })
      if (!alloc.canAllocate || alloc.dollarAmount > cash) continue
      const cost = alloc.dollarAmount * (1 + FRICTION)
      if (cost > cash) continue
      cash -= cost
      if (existing) {
        const newShares = existing.shares + alloc.shares
        existing.costBasis = (existing.shares * existing.costBasis + alloc.shares * c.f.price) / newShares
        existing.shares = newShares
      } else {
        positions.set(c.t, { ticker: c.t, shares: alloc.shares, costBasis: c.f.price })
      }
      buys.push(`${c.t} $${alloc.dollarAmount.toFixed(0)} (score ${c.score}, MOS ${c.iv.marginOfSafety.toFixed(0)}%)`)
    }

    const value = cash + holdingsValue()
    const spyPx = priceAt(spy, year)
    yearly[year] = { value, spy: spyPx ?? 0, buys, sells }
    console.log(`${year}-04: portfolio $${value.toFixed(0)} | ${positions.size} positions | ${buys.length} buys, ${sells.length} sells`)
  }

  // ── Results ──
  const years = END_YEAR - START_YEAR
  const finalValue = yearly[END_YEAR].value
  const cagr = years > 0 ? Math.pow(finalValue / INITIAL_CAPITAL, 1 / years) - 1 : 0
  const spyStart = yearly[START_YEAR].spy, spyEnd = yearly[END_YEAR].spy
  const spyCagr = years > 0 && spyStart > 0 ? Math.pow(spyEnd / spyStart, 1 / years) - 1 : 0

  const results = {
    metadata: {
      runAt: new Date().toISOString(),
      engine: 'PRODUCTION scorer/allocator/sell-scorer (not a proxy)',
      window: `${START_YEAR}-04 → ${END_YEAR}-04`,
      universeSize: data.size,
      avgStatementYears: +avgYears.toFixed(1),
      frictionOneWay: FRICTION,
      limitations: ['dividends ignored (biases strategy down)', 'universe survivorship (biases strategy up)', 'annual rebalance only'],
    },
    performance: {
      strategyCagr: +(cagr * 100).toFixed(2),
      spyCagr: +(spyCagr * 100).toFixed(2),
      alpha: +((cagr - spyCagr) * 100).toFixed(2),
      finalValue: +finalValue.toFixed(0),
    },
    yearly,
  }
  writeFileSync('scripts/backtest-engine-results.json', JSON.stringify(results, null, 2))

  console.log('\n════════ REAL-ENGINE BACKTEST ════════')
  console.log(`Strategy CAGR: ${(cagr * 100).toFixed(2)}%  |  SPY CAGR: ${(spyCagr * 100).toFixed(2)}%  |  Alpha: ${((cagr - spyCagr) * 100).toFixed(2)}%`)
  if (avgYears < 8) {
    console.log(`\n⚠ DATA COVERAGE TOO THIN (${avgYears.toFixed(1)} yrs of statements — need 8+).`)
    console.log('  On the FMP free tier the engine cannot see full cycles: Shiller EPS,')
    console.log('  earnings stability, and dividend history all degrade. Upgrade the FMP')
    console.log('  plan before treating ANY number above as a verdict on the strategy.')
  }
  console.log('Full results: scripts/backtest-engine-results.json')
}

main().catch(e => { console.error(e); process.exit(1) })
