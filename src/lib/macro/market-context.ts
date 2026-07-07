// ─── Macro Market Context ──────────────────────────────────────────────────────
//
// Shiller's central insight: valuation is meaningless over 1-2 years but is the
// dominant driver of 10-year returns. The S&P 500 CAPE predicts long-run equity
// returns better than any other single metric.
//
// Buffett embeds this implicitly: he sat on $147B cash in 2020, then deployed
// aggressively when CAPE fell to 25. He held $325B in 2024 with CAPE at 34.
// This module makes that behavior explicit and automatic.
//
// Data sources (public, no API key required):
//   CAPE:    https://www.multpl.com/shiller-pe (republishes Shiller's Yale dataset monthly)
//   10Y UST: https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10
//
// NOTE: FRED does NOT carry a Shiller CAPE series. The original id=CAPE fetch
// returned an HTML error page and silently failed — the macro overlay never
// engaged. multpl is now primary, with sanity bounds and explicit source tracking.

import axios from 'axios'

export interface MacroContext {
  sp500Cape: number
  capeSource: 'multpl' | 'cache' | 'fallback'  // 'fallback' = live fetch failed, using hardcoded estimate
  treasury10yr: number            // decimal (0.045 = 4.5%)
  marketTemperature: 'cold' | 'fair' | 'warm' | 'hot' | 'extreme'
  // Adjustments applied on top of user config when market is expensive/cheap
  cashReserveAdj: number          // additive % to minCashReservePct (e.g. +10 → hold more cash)
  minScoreAdj: number             // additive points to minPhilosophyScore (e.g. +15 → be pickier)
  // Shiller's equity risk premium: earnings yield minus real bond yield
  // Negative means bonds pay more than stocks → equities not cheap vs fixed income
  excessEarningsYield: number
  fetchedAt: Date
}

// In-memory cache — CAPE updates monthly, treasury daily; 6hr TTL is sufficient
let _cached: MacroContext | null = null
let _expiry = 0
const TTL = 6 * 60 * 60 * 1000

// ─── FRED CSV parser ──────────────────────────────────────────────────────────

async function fetchFredLatest(seriesId: string): Promise<number | null> {
  try {
    const res = await axios.get<string>(
      `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`,
      { timeout: 8000, responseType: 'text' }
    )
    const lines = res.data.trim().split('\n')
    // Walk backwards — FRED uses "." for missing/preliminary data
    for (let i = lines.length - 1; i >= 1; i--) {
      const [, raw] = lines[i].split(',')
      if (raw && raw.trim() !== '.') return parseFloat(raw.trim())
    }
    return null
  } catch {
    return null
  }
}

// ─── multpl.com Shiller PE scraper ────────────────────────────────────────────

async function fetchMultplCape(): Promise<number | null> {
  try {
    const res = await axios.get<string>(
      'https://www.multpl.com/shiller-pe/table/by-month',
      { timeout: 8000, responseType: 'text', headers: { 'User-Agent': 'Mozilla/5.0 (GrahamCapital autopilot)' } }
    )
    // First right-aligned cell in the monthly table is the latest value
    const m = res.data.match(/<td class="right">\s*([\d.]+)/)
    if (m) {
      const v = parseFloat(m[1])
      if (v > 3 && v < 100) return v  // sanity bounds — CAPE has never left this range
    }
    return null
  } catch {
    return null
  }
}

// ─── Market temperature thresholds ────────────────────────────────────────────
//
// CAPE history context:
//   1929 peak: ~33    2000 peak: ~44    2007 peak: ~27
//   2009 trough: ~13  2020 trough: ~25  2024 level: ~34
//
// Expected 10-year real returns by CAPE (Shiller research):
//   CAPE < 10:  ~13% real/yr     CAPE 10-15: ~10%
//   CAPE 15-20:  ~7%              CAPE 20-25:  ~5%
//   CAPE 25-30:  ~3%              CAPE > 30:   ~1-2%

function deriveTemperature(cape: number): MacroContext['marketTemperature'] {
  if (cape < 15) return 'cold'
  if (cape < 20) return 'fair'
  if (cape < 25) return 'warm'
  if (cape < 33) return 'hot'
  return 'extreme'
}

function deriveCashAdj(cape: number): number {
  if (cape < 15) return -10  // rare opportunity — reduce cash reserve, deploy
  if (cape < 20) return  -5  // below fair value — slight aggression
  if (cape < 25) return   0  // fair value — neutral
  if (cape < 30) return   8  // above fair — hold more cash
  if (cape < 35) return  15  // expensive — significant caution
  return 20                   // extreme overvaluation — Buffett mode: hoard cash
}

function deriveScoreAdj(cape: number): number {
  if (cape < 15) return -10  // market cheap — lower individual bar (everything discounted)
  if (cape < 20) return  -5
  if (cape < 25) return   0
  if (cape < 30) return   8  // require better quality when market expensive
  if (cape < 35) return  15
  return 20                   // only the very best ideas deserve capital
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Last-resort fallback when both live fetch and cache are unavailable.
// Deliberately conservative (expensive market → autopilot gets pickier, not looser).
const FALLBACK_CAPE = 34
const FALLBACK_TREASURY_PCT = 4.3

export async function getMarketContext(): Promise<MacroContext> {
  if (_cached && Date.now() < _expiry) return _cached

  const [cape, treasury10yrPct] = await Promise.all([
    fetchMultplCape(),
    fetchFredLatest('DGS10'),
  ])

  const capeSource: MacroContext['capeSource'] =
    cape != null ? 'multpl' : _cached ? 'cache' : 'fallback'
  if (cape == null) {
    console.warn(`[macro] Shiller CAPE fetch failed — using ${capeSource} value. Macro overlay accuracy degraded.`)
  }

  const resolvedCape = cape ?? (_cached?.sp500Cape ?? FALLBACK_CAPE)
  const resolvedTreasuryPct = treasury10yrPct ?? (_cached ? _cached.treasury10yr * 100 : FALLBACK_TREASURY_PCT)

  const treasury10yr = resolvedTreasuryPct / 100
  const earningsYield = 1 / resolvedCape
  const excessEarningsYield = earningsYield - treasury10yr

  _cached = {
    sp500Cape: resolvedCape,
    capeSource,
    treasury10yr,
    marketTemperature: deriveTemperature(resolvedCape),
    cashReserveAdj: deriveCashAdj(resolvedCape),
    minScoreAdj: deriveScoreAdj(resolvedCape),
    excessEarningsYield,
    fetchedAt: new Date(),
  }
  _expiry = Date.now() + TTL

  return _cached
}

export function formatMarketContext(ctx: MacroContext): string {
  const tempLabel = {
    cold:    'COLD — rare buying opportunity (Buffett 2009: "Buy American. I Am.")',
    fair:    'FAIR — reasonable valuations, deploy capital selectively',
    warm:    'WARM — above historical averages, maintain discipline',
    hot:     'HOT — elevated valuations, raise cash reserve threshold',
    extreme: 'EXTREME — Shiller CAPE in bubble territory, hold significant cash',
  }[ctx.marketTemperature]

  return [
    `S&P 500 CAPE: ${ctx.sp500Cape.toFixed(1)}${ctx.capeSource !== 'multpl' ? ` (⚠ ${ctx.capeSource} value — live fetch failed)` : ''} | Market: ${tempLabel}`,
    `10Y Treasury: ${(ctx.treasury10yr * 100).toFixed(2)}% | Equity earnings yield: ${(1 / ctx.sp500Cape * 100).toFixed(2)}%`,
    `Excess earnings yield (vs bonds): ${(ctx.excessEarningsYield * 100).toFixed(2)}%`,
    `Autopilot adjustments: cash reserve +${ctx.cashReserveAdj}% | min score +${ctx.minScoreAdj}pts`,
  ].join('\n')
}
