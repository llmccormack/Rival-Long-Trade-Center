// Philosophy Backtest Engine
// Tests the scorer's buy signals against historical forward returns (2014–2024)
// Run: node scripts/backtest.mjs

import { writeFileSync } from 'fs'

const API_KEY = 'n2SQXkIW5RTU5QyynxQRS7weM4S4A57g'
const BASE = 'https://financialmodelingprep.com/stable'

// Diverse universe: value, quality, cyclicals, defensives across sectors
const UNIVERSE = [
  // Financials
  'JPM','BAC','WFC','BRK-B','USB','TRV','AFL','CB',
  // Industrials
  'MMM','GE','HON','CAT','DE','EMR','ITW','PH',
  // Consumer Staples
  'KO','PG','JNJ','MCD','WMT','CL','KMB','GIS',
  // Technology (value-ish)
  'AAPL','MSFT','CSCO','INTC','IBM','QCOM','TXN','AMAT',
  // Energy
  'XOM','CVX','COP','PSX','MPC','OXY',
  // Healthcare
  'ABT','MDT','BMY','ABBV','MRK','PFE','UNH','CVS',
  // Materials
  'LIN','APD','NEM','FCX',
  // Utilities
  'NEE','DUK','SO','D',
  // Real Estate adjacent
  'AMT','O',
]

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function fetchJSON(url) {
  const res = await fetch(url)
  if (!res.ok) return null
  return res.json().catch(() => null)
}

async function getHistoricalData(ticker) {
  // Sequential — FMP free tier rate-limits concurrent requests
  const income  = await fetchJSON(`${BASE}/income-statement?symbol=${ticker}&limit=12&apikey=${API_KEY}`)
  await sleep(150)
  const balance = await fetchJSON(`${BASE}/balance-sheet-statement?symbol=${ticker}&limit=12&apikey=${API_KEY}`)
  await sleep(150)
  const metrics = await fetchJSON(`${BASE}/key-metrics?symbol=${ticker}&limit=12&apikey=${API_KEY}`)
  await sleep(150)
  const prices  = await fetchJSON(`${BASE}/historical-price-eod/light?symbol=${ticker}&apikey=${API_KEY}`)
  return { income, balance, metrics, prices }
}

// Find the closest price on or after a given date
function getPriceNear(prices, targetDate, offsetDays = 0) {
  if (!prices?.length) return null
  const target = new Date(targetDate)
  target.setDate(target.getDate() + offsetDays)
  const targetStr = target.toISOString().split('T')[0]

  // prices are newest-first from FMP
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date))
  let best = null
  for (const p of sorted) {
    if (p.date >= targetStr) { best = p; break }
  }
  return best?.close ?? null
}

// Core philosophy scorer (inline — no TS imports in .mjs)
function scoreYear(inc, bal, met) {
  if (!inc || !bal || !met) return null

  let score = 0
  let maxScore = 0
  const notes = []

  const pe = met.marketCap && inc.netIncome > 0 ? met.marketCap / inc.netIncome : null
  const pb = met.marketCap && bal.totalStockholdersEquity > 0 ? met.marketCap / bal.totalStockholdersEquity : null
  const currentRatio = met.currentRatio
  const roe = met.returnOnEquity
  const roic = met.returnOnInvestedCapital
  const earningsYield = met.earningsYield
  const freeCashFlow = inc.operatingCashFlow - Math.abs(inc.capitalExpenditure ?? 0)
  const debtToEquity = bal.totalDebt > 0 && bal.totalStockholdersEquity > 0
    ? bal.totalDebt / bal.totalStockholdersEquity : null
  const grossMargin = inc.revenue > 0 ? inc.grossProfit / inc.revenue : null
  const grahamNumber = met.grahamNumber

  // ── Margin of Safety proxy: Graham Number vs price ──────────────────────
  // We use P/B as proxy since we don't have exact intrinsic value historically
  maxScore += 20
  if (pb !== null) {
    if (pb <= 1.0)       { score += 20; notes.push('P/B ≤1.0 (Schloss/Graham deep value)') }
    else if (pb <= 1.5)  { score += 14; notes.push('P/B ≤1.5 (Graham defensive)') }
    else if (pb <= 2.5)  { score += 7 }
  }

  // ── P/E (Graham Ch.14) ───────────────────────────────────────────────────
  maxScore += 15
  if (pe !== null && pe > 0) {
    if (pe <= 10)        { score += 15; notes.push('P/E ≤10 (Dreman bottom quintile)') }
    else if (pe <= 15)   { score += 12; notes.push('P/E ≤15 (Graham)') }
    else if (pe <= 20)   { score += 6 }
    else if (pe > 30)    { notes.push('P/E >30 (expensive)') }
  }

  // ── Earnings Yield / Greenblatt EBIT/EV ─────────────────────────────────
  maxScore += 15
  if (earningsYield !== null && earningsYield > 0) {
    if (earningsYield >= 0.15)     { score += 15; notes.push('Earnings yield ≥15% (Greenblatt top tier)') }
    else if (earningsYield >= 0.10) { score += 11; notes.push('Earnings yield ≥10% (Greenblatt)') }
    else if (earningsYield >= 0.06) { score += 6 }
  }

  // ── ROIC (Greenblatt quality filter) ────────────────────────────────────
  maxScore += 15
  if (roic !== null) {
    if (roic >= 0.25)    { score += 15; notes.push('ROIC ≥25% (wide moat)') }
    else if (roic >= 0.15) { score += 11; notes.push('ROIC ≥15% (Greenblatt quality)') }
    else if (roic >= 0.10) { score += 6 }
    else if (roic < 0.05)  { notes.push('ROIC <5% (poor capital allocation)') }
  }

  // ── ROE (Buffett moat) ───────────────────────────────────────────────────
  maxScore += 10
  if (roe !== null) {
    if (roe >= 0.25)     { score += 10; notes.push('ROE ≥25% (Buffett moat signal)') }
    else if (roe >= 0.15) { score += 7 }
    else if (roe >= 0.10) { score += 4 }
    else if (roe < 0)     { notes.push('Negative ROE (veto signal)') }
  }

  // ── Balance sheet (Graham financial strength) ────────────────────────────
  maxScore += 10
  if (currentRatio !== null) {
    if (currentRatio >= 2.0)    { score += 10; notes.push('Current ratio ≥2.0 (Graham)') }
    else if (currentRatio >= 1.5) { score += 6 }
    else if (currentRatio < 1.0)  { score -= 5; notes.push('Current ratio <1.0 (veto risk)') }
  }

  // ── Debt/Equity (Buffett leverage aversion) ──────────────────────────────
  maxScore += 10
  if (debtToEquity !== null) {
    if (debtToEquity <= 0.3)    { score += 10; notes.push('Low debt (Buffett/Schloss)') }
    else if (debtToEquity <= 0.8) { score += 7 }
    else if (debtToEquity <= 1.5) { score += 3 }
    else if (debtToEquity > 3)    { score -= 5; notes.push('Dangerous leverage') }
  }

  // ── Gross margin (moat indicator) ───────────────────────────────────────
  maxScore += 5
  if (grossMargin !== null) {
    if (grossMargin >= 0.50)    { score += 5; notes.push('Gross margin ≥50% (pricing power)') }
    else if (grossMargin >= 0.35) { score += 3 }
  }

  // Hard veto: negative earnings or no cash flow
  if (inc.netIncome <= 0 || freeCashFlow <= 0) {
    score = Math.max(0, score - 20)
    notes.push('Negative earnings/FCF (hard veto partial)')
  }

  const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0
  return { score: pct, notes, pe, pb, roe, roic, earningsYield, currentRatio, debtToEquity }
}

async function runBacktest() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log('  RIVAL AUTOMATIONS — PHILOSOPHY BACKTEST ENGINE')
  console.log(`  Universe: ${UNIVERSE.length} stocks | Period: 2014–2024`)
  console.log(`${'═'.repeat(60)}\n`)

  const allResults = []
  let apiCalls = 0

  for (const ticker of UNIVERSE) {
    process.stdout.write(`  Fetching ${ticker.padEnd(8)}...`)
    const { income, balance, metrics, prices } = await getHistoricalData(ticker)
    apiCalls += 4

    if (!income?.length || !balance?.length || !metrics?.length || !prices?.length) {
      console.log(' SKIP (no data)')
      await sleep(300)
      continue
    }

    // Match each fiscal year to its entry price and 1-year-forward price
    for (let i = 0; i < Math.min(income.length, metrics.length, balance.length); i++) {
      const inc = income[i]
      const met = metrics[i]
      const bal = balance[i]

      if (!inc?.date || inc.fiscalYear < '2014') continue

      const scoreData = scoreYear(inc, bal, met)
      if (!scoreData) continue

      // Entry price: ~30 days after fiscal year end (after data is public)
      const entryPrice = getPriceNear(prices, inc.date, 30)
      // Forward price: 12 months later
      const fwdPrice = getPriceNear(prices, inc.date, 395)

      if (!entryPrice || !fwdPrice) continue

      const fwdReturn = ((fwdPrice - entryPrice) / entryPrice) * 100

      allResults.push({
        ticker,
        year: inc.fiscalYear,
        score: scoreData.score,
        fwdReturn: Math.round(fwdReturn * 10) / 10,
        entryPrice: Math.round(entryPrice * 100) / 100,
        fwdPrice: Math.round(fwdPrice * 100) / 100,
        pe: scoreData.pe ? Math.round(scoreData.pe * 10) / 10 : null,
        pb: scoreData.pb ? Math.round(scoreData.pb * 100) / 100 : null,
        roic: scoreData.roic ? Math.round(scoreData.roic * 1000) / 10 : null,
        notes: scoreData.notes,
      })
    }

    console.log(` ✓ (${income.length} years)`)
    await sleep(250) // stay under rate limits
  }

  // ── S&P 500 benchmark ────────────────────────────────────────────────────
  console.log('\n  Fetching S&P 500 benchmark (SPY)...')
  const spyPrices = await fetchJSON(`${BASE}/historical-price-eod/light?symbol=SPY&apikey=${API_KEY}`)
  apiCalls++

  const benchmarkByYear = {}
  for (const year of ['2014','2015','2016','2017','2018','2019','2020','2021','2022','2023']) {
    const entry = getPriceNear(spyPrices, `${year}-12-31`, 30)
    const fwd = getPriceNear(spyPrices, `${year}-12-31`, 395)
    if (entry && fwd) benchmarkByYear[year] = Math.round(((fwd - entry) / entry) * 1000) / 10
  }

  // ── Analysis ─────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`)
  console.log('  RESULTS')
  console.log(`${'═'.repeat(60)}`)
  console.log(`  Total data points: ${allResults.length}`)
  console.log(`  API calls used:    ${apiCalls}\n`)

  // Bucket by score quintile
  const buckets = { 'BUY (≥70)': [], 'WATCHLIST (50–69)': [], 'NEUTRAL (30–49)': [], 'AVOID (<30)': [] }
  for (const r of allResults) {
    if (r.score >= 70)      buckets['BUY (≥70)'].push(r.fwdReturn)
    else if (r.score >= 50) buckets['WATCHLIST (50–69)'].push(r.fwdReturn)
    else if (r.score >= 30) buckets['NEUTRAL (30–49)'].push(r.fwdReturn)
    else                    buckets['AVOID (<30)'].push(r.fwdReturn)
  }

  const avg = arr => arr.length ? Math.round(arr.reduce((s,v) => s+v, 0) / arr.length * 10) / 10 : null
  const med = arr => {
    if (!arr.length) return null
    const s = [...arr].sort((a,b) => a-b)
    return Math.round(s[Math.floor(s.length/2)] * 10) / 10
  }
  const winRate = arr => arr.length ? Math.round(arr.filter(v => v > 0).length / arr.length * 100) : null
  const beat = (arr, year) => arr.filter((v,i) => {
    // rough: positive above benchmark
    return v > 0
  }).length

  console.log('  FORWARD 1-YEAR RETURNS BY PHILOSOPHY SCORE BUCKET:\n')
  console.log(`  ${'Bucket'.padEnd(22)} ${'N'.padEnd(6)} ${'Avg Ret'.padEnd(10)} ${'Median'.padEnd(10)} ${'Win%'.padEnd(8)} Top Quartile`)
  console.log(`  ${'-'.repeat(70)}`)

  const summaryRows = []
  for (const [label, returns] of Object.entries(buckets)) {
    const a = avg(returns)
    const m = med(returns)
    const w = winRate(returns)
    const sorted = [...returns].sort((a,b) => b-a)
    const topQ = sorted.slice(0, Math.ceil(sorted.length / 4))
    const topQAvg = avg(topQ)
    console.log(`  ${label.padEnd(22)} ${String(returns.length).padEnd(6)} ${(a !== null ? a+'%' : '—').padEnd(10)} ${(m !== null ? m+'%' : '—').padEnd(10)} ${(w !== null ? w+'%' : '—').padEnd(8)} ${topQAvg !== null ? topQAvg+'%' : '—'}`)
    summaryRows.push({ bucket: label, n: returns.length, avgReturn: a, medianReturn: m, winRate: w, topQuartileAvg: topQAvg })
  }

  // Year-by-year breakdown for BUY bucket
  console.log('\n  BUY SIGNAL (≥70) YEAR-BY-YEAR vs S&P 500:\n')
  console.log(`  ${'Year'.padEnd(8)} ${'Buy Avg'.padEnd(12)} ${'S&P 500'.padEnd(12)} ${'Alpha'.padEnd(10)} N`)
  console.log(`  ${'-'.repeat(50)}`)

  const yearlyRows = []
  for (const year of Object.keys(benchmarkByYear).sort()) {
    const yearReturns = allResults.filter(r => r.year === year && r.score >= 70).map(r => r.fwdReturn)
    const a = avg(yearReturns)
    const spy = benchmarkByYear[year]
    const alpha = a !== null && spy !== null ? Math.round((a - spy) * 10) / 10 : null
    const alphaStr = alpha !== null ? (alpha >= 0 ? '+' : '') + alpha + '%' : '—'
    console.log(`  ${year.padEnd(8)} ${(a !== null ? a+'%' : '—').padEnd(12)} ${(spy !== null ? spy+'%' : '—').padEnd(12)} ${alphaStr.padEnd(10)} ${yearReturns.length}`)
    yearlyRows.push({ year, buyAvg: a, sp500: spy, alpha })
  }

  // Best and worst individual calls
  const sorted = [...allResults].sort((a,b) => b.fwdReturn - a.fwdReturn)
  console.log('\n  TOP 10 INDIVIDUAL BUY SIGNALS (score ≥70, best returns):\n')
  console.log(`  ${'Ticker'.padEnd(8)} ${'Year'.padEnd(8)} ${'Score'.padEnd(8)} ${'Return'.padEnd(10)} Notes`)
  console.log(`  ${'-'.repeat(65)}`)
  sorted.filter(r => r.score >= 70).slice(0, 10).forEach(r => {
    console.log(`  ${r.ticker.padEnd(8)} ${r.year.padEnd(8)} ${String(r.score).padEnd(8)} ${(r.fwdReturn+'%').padEnd(10)} ${r.notes.slice(0,2).join(', ')}`)
  })

  console.log('\n  WORST 10 INDIVIDUAL BUY SIGNALS (score ≥70, worst returns):\n')
  console.log(`  ${'Ticker'.padEnd(8)} ${'Year'.padEnd(8)} ${'Score'.padEnd(8)} ${'Return'.padEnd(10)} Notes`)
  console.log(`  ${'-'.repeat(65)}`)
  sorted.filter(r => r.score >= 70).slice(-10).reverse().forEach(r => {
    console.log(`  ${r.ticker.padEnd(8)} ${r.year.padEnd(8)} ${String(r.score).padEnd(8)} ${(r.fwdReturn+'%').padEnd(10)} ${r.notes.slice(0,2).join(', ')}`)
  })

  // Save full results
  const output = {
    runAt: new Date().toISOString(),
    universe: UNIVERSE,
    totalDataPoints: allResults.length,
    apiCallsUsed: apiCalls,
    bucketSummary: summaryRows,
    yearlyAlpha: yearlyRows,
    sp500Benchmark: benchmarkByYear,
    allResults: allResults.sort((a,b) => b.score - a.score),
  }

  writeFileSync('scripts/backtest-results.json', JSON.stringify(output, null, 2))
  console.log(`\n  Full results saved to scripts/backtest-results.json`)
  console.log(`${'═'.repeat(60)}\n`)
}

runBacktest().catch(console.error)
