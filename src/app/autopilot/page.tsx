'use client'

import { useState, useEffect } from 'react'
import { useTradingMode } from '@/contexts/TradingMode'
import { cn } from '@/lib/utils'
import { PortfolioReviewPanel } from '@/components/ui/PortfolioReviewPanel'

const PHILOSOPHY_GATES = [
  {
    step: '01',
    title: 'Hard Veto Check',
    desc: 'Any single principle veto permanently blocks the trade regardless of score',
    examples: ['Negative owner earnings', 'Current ratio < 1.0', 'Debt/equity > 2×', 'Management fraud flag'],
    color: 'text-red-400',
    border: 'border-red-900/50',
    bg: 'bg-red-900/10',
  },
  {
    step: '02',
    title: 'Philosophy Score Gate',
    desc: 'Weighted scoring across 137 principles across Graham, Buffett, and Fisher',
    examples: ['Must score ≥ 55 / 100 to proceed', 'Category scores checked independently', 'Audit trail generated for every principle'],
    color: 'text-violet-400',
    border: 'border-violet-900/50',
    bg: 'bg-violet-900/10',
  },
  {
    step: '03',
    title: 'Margin of Safety Gate',
    desc: 'Graham Ch.20 — The central concept. No exceptions.',
    examples: ['Must show ≥ 30% discount to intrinsic value', 'IV = 40% Graham Number + 60% DCF', 'Owner Earnings used as DCF input'],
    color: 'text-emerald-400',
    border: 'border-emerald-900/50',
    bg: 'bg-emerald-900/10',
  },
  {
    step: '04',
    title: 'Conviction-Scaled Sizing',
    desc: 'Position size scales with philosophy conviction level',
    examples: ['Strong Buy → 100% of 10% cap', 'Buy → 70% of 10% cap', 'Watchlist → 50% of 10% cap'],
    color: 'text-amber-400',
    border: 'border-amber-900/50',
    bg: 'bg-amber-900/10',
  },
]

interface RunResult {
  ranAt: string
  mode: string
  watchlistScanned: number
  buys: number
  skipped: number
  vetoed: number
  macro?: {
    sp500Cape: number
    marketTemperature: string
    treasury10yr: string
    excessEarningsYield: string
    effectiveMinScore: number
    effectiveCashReservePct: number
  }
  results: Array<{
    ticker: string
    action: string
    score?: number
    mos?: number
    conviction?: string
    reason?: string
    shares?: number
    price?: number
    grahamNumber?: number
    dcfValue?: number
    intrinsicValue?: number
  }>
}

interface PaperPosition {
  ticker: string
  name: string
  sector?: string
  shares: number
  avgCostBasis: number
  currentPrice: number
  currentValue: number
  gainLoss: number
  gainLossPct: number
  philosophyScore: number | null
  conviction: string | null
  mosAtPurchase: number | null
  needsThesisReview?: boolean
  daysHeld?: number
  dividendsEarned?: number
}

interface PaperPortfolio {
  positions: PaperPosition[]
  totalValue: number
  totalCost: number
  totalGainLoss: number
  totalGainLossPct: number
  totalDividends?: number
  totalReturnWithDividends?: number
}

const ACTION_STYLE: Record<string, string> = {
  PAPER_BUY:   'bg-emerald-900/50 text-emerald-400 border-emerald-800',
  QUEUED_LIVE: 'bg-blue-900/50 text-blue-400 border-blue-800',
  VETOED:      'bg-red-900/50 text-red-400 border-red-800',
  SKIP:        'bg-zinc-800/80 text-zinc-600 border-zinc-700',
  ERROR:       'bg-red-900/30 text-red-500 border-red-900',
}

export default function AutopilotPage() {
  const { mode, setMode, isPaper } = useTradingMode()
  const [autopilotOn, setAutopilotOn] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [minScore, setMinScore] = useState(55)
  const [minMOS, setMinMOS] = useState(30)
  const [lastRun, setLastRun] = useState<RunResult | null>(null)
  const [portfolio, setPortfolio] = useState<PaperPortfolio | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [fullRunning, setFullRunning] = useState(false)
  const [fullRunStep, setFullRunStep] = useState(0)
  const [fullRunResult, setFullRunResult] = useState<any>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/autopilot/run').then(r => r.json()).catch(() => null),
      fetch('/api/paper-portfolio').then(r => r.json()).catch(() => null),
      fetch('/api/autopilot/config').then(r => r.json()).catch(() => null),
    ]).then(([runData, portfolioData, config]) => {
      if (runData?.lastRunResult) setLastRun(runData.lastRunResult)
      if (portfolioData?.positions) setPortfolio(portfolioData)
      if (config && !config.error) {
        setAutopilotOn(config.isEnabled)
        setMinScore(config.minPhilosophyScore)
        setMinMOS(config.minMarginOfSafety)
      }
      setLoading(false)
    })
  }, [])

  const runNow = async () => {
    setRunning(true)
    try {
      const res = await fetch('/api/autopilot/run', { method: 'POST' })
      const result = await res.json()
      if (!result.error) setLastRun(result)
      const portfolioRes = await fetch('/api/paper-portfolio')
      const portfolioData = await portfolioRes.json()
      if (portfolioData?.positions) setPortfolio(portfolioData)
    } finally {
      setRunning(false)
    }
  }

  const runFull = async () => {
    setFullRunning(true)
    setFullRunStep(1)
    setFullRunResult(null)
    try {
      // Steps animate while the single request runs
      const stepTimer = setInterval(() => {
        setFullRunStep(s => (s < 3 ? s + 1 : s))
      }, 4000)
      const res = await fetch('/api/autopilot/full-run', { method: 'POST' })
      clearInterval(stepTimer)
      setFullRunStep(3)
      const result = await res.json()
      if (!result.error) {
        setFullRunResult(result)
        setLastRun(result)
      }
      const portfolioRes = await fetch('/api/paper-portfolio')
      const portfolioData = await portfolioRes.json()
      if (portfolioData?.positions) setPortfolio(portfolioData)
    } finally {
      setFullRunning(false)
      setFullRunStep(0)
    }
  }

  const decisions = lastRun?.results ?? []
  const buys = decisions.filter(d => d.action.includes('BUY')).length
  const blocked = decisions.filter(d => d.action === 'VETOED' || d.action === 'ERROR').length

  return (
    <div className="flex flex-col gap-6 p-6">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Autopilot</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Every trade routed through 137 Graham · Buffett · Fisher principles.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex rounded-lg bg-zinc-900 border border-zinc-800 p-0.5">
            <button
              onClick={() => setMode('paper')}
              className={cn(
                'rounded-md px-4 py-1.5 text-xs font-semibold tracking-wide transition-all',
                mode === 'paper' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'text-zinc-600 hover:text-zinc-400'
              )}
            >
              PAPER
            </button>
            <button
              onClick={() => setMode('live')}
              className={cn(
                'rounded-md px-4 py-1.5 text-xs font-semibold tracking-wide transition-all',
                mode === 'live' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-zinc-600 hover:text-zinc-400'
              )}
            >
              LIVE
            </button>
          </div>

          <button
            onClick={() => setAutopilotOn(!autopilotOn)}
            className={cn(
              'flex items-center gap-2.5 rounded-lg border px-4 py-2 text-sm font-medium transition-all',
              autopilotOn
                ? 'border-emerald-800/60 bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/30'
                : 'border-zinc-700 bg-zinc-900 text-zinc-500 hover:text-zinc-300'
            )}
          >
            {autopilotOn ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Autopilot Active
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-zinc-600" />
                Autopilot Off
              </>
            )}
          </button>

          <button
            onClick={runNow}
            disabled={running || fullRunning}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-400 hover:border-zinc-500 disabled:opacity-40 transition-colors"
          >
            {running ? 'Running…' : 'Run Watchlist'}
          </button>

          <button
            onClick={runFull}
            disabled={running || fullRunning}
            className="relative flex items-center gap-2 rounded-lg border border-violet-600/60 bg-violet-600/10 px-5 py-2 text-sm font-semibold text-violet-300 hover:bg-violet-600/20 disabled:opacity-40 transition-all"
          >
            {fullRunning ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-500" />
                </span>
                Running Full Autopilot…
              </>
            ) : (
              <>
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                </svg>
                Full Auto Run
              </>
            )}
          </button>
        </div>
      </div>

      {/* Paper mode notice */}
      {isPaper && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-800/40 bg-amber-900/10 px-4 py-3">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-amber-500">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <p className="text-sm text-amber-400/80">
            <span className="font-semibold text-amber-400">Paper Trading Mode</span> — All decisions are simulated. No real orders will be placed. Switch to Live to connect your Schwab account.
          </p>
        </div>
      )}

      {/* Macro market context — shows last run's market temperature */}
      {lastRun?.macro && (() => {
        const temp = lastRun.macro.marketTemperature
        const tempColors: Record<string, string> = {
          cold:    'border-sky-800/50 bg-sky-900/10 text-sky-400',
          fair:    'border-emerald-800/50 bg-emerald-900/10 text-emerald-400',
          warm:    'border-amber-800/50 bg-amber-900/10 text-amber-400',
          hot:     'border-orange-800/50 bg-orange-900/10 text-orange-400',
          extreme: 'border-red-800/50 bg-red-900/10 text-red-400',
        }
        const cls = tempColors[temp] ?? 'border-zinc-700 bg-zinc-900 text-zinc-400'
        return (
          <div className={`rounded-xl border px-4 py-3 ${cls}`}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="text-[10px] font-medium uppercase tracking-widest opacity-70">Market Temperature at Run Time</div>
                <span className="font-mono font-bold text-sm uppercase">{temp}</span>
                <span className="font-mono text-sm opacity-80">CAPE {lastRun.macro.sp500Cape.toFixed(1)}×</span>
              </div>
              <div className="flex gap-4 text-xs font-mono">
                <span className="text-zinc-500">10Y: <span className="text-zinc-300">{lastRun.macro.treasury10yr}</span></span>
                <span className="text-zinc-500">Excess yield: <span className="text-zinc-300">{lastRun.macro.excessEarningsYield}</span></span>
                <span className="text-zinc-500">Effective score gate: <span className="text-zinc-300">{lastRun.macro.effectiveMinScore}</span></span>
                <span className="text-zinc-500">Cash reserve: <span className="text-zinc-300">{lastRun.macro.effectiveCashReservePct.toFixed(0)}%</span></span>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Full auto run — progress + result */}
      {(fullRunning || fullRunResult) && (
        <div className="rounded-xl border border-violet-800/40 bg-violet-900/10 p-5">
          {fullRunning && (
            <>
              <div className="mb-3 text-xs font-medium uppercase tracking-widest text-violet-400">Full Autopilot Running</div>
              <div className="flex items-center gap-0">
                {[
                  { n: 1, label: 'Reviewing positions' },
                  { n: 2, label: 'Evaluating watchlist' },
                  { n: 3, label: 'Executing buys' },
                ].map(({ n, label }, i) => (
                  <div key={n} className="flex items-center gap-0">
                    <div className={cn(
                      'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all',
                      fullRunStep >= n ? 'text-violet-300' : 'text-zinc-600'
                    )}>
                      <span className={cn(
                        'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                        fullRunStep > n ? 'bg-violet-600 text-white' :
                        fullRunStep === n ? 'bg-violet-500/30 text-violet-300 ring-1 ring-violet-500 animate-pulse' :
                        'bg-zinc-800 text-zinc-600'
                      )}>{fullRunStep > n ? '✓' : n}</span>
                      {label}
                    </div>
                    {i < 2 && <span className="text-zinc-700 mx-1">→</span>}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-zinc-600">Evaluating all watchlist positions — may take 1–2 minutes…</p>
            </>
          )}

          {!fullRunning && fullRunResult && (
            <>
              <div className="mb-3 text-xs font-medium uppercase tracking-widest text-violet-400">Full Run Complete</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
                {[
                  { label: 'Positions Reviewed', value: fullRunResult.positionsReviewed ?? 0 },
                  { label: 'Sells', value: (fullRunResult.sells ?? 0) + (fullRunResult.vetoSells ?? 0), highlight: (fullRunResult.sells ?? 0) > 0 },
                  { label: 'Buys Executed', value: fullRunResult.buys, highlight: true },
                  { label: 'Blocked by Veto', value: fullRunResult.vetoed },
                ].map(({ label, value, highlight }) => (
                  <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                    <div className="text-[10px] text-zinc-600 uppercase tracking-widest">{label}</div>
                    <div className={cn('text-2xl font-mono font-bold mt-1', highlight && value > 0 ? 'text-violet-400' : 'text-zinc-300')}>{value}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Status cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'System Status', value: autopilotOn ? 'Active' : 'Paused', sub: isPaper ? 'Paper mode' : 'Live mode', good: autopilotOn },
          { label: 'Decisions', value: decisions.length.toString(), sub: `${buys} buys · ${blocked} blocked`, good: null },
          { label: 'Philosophy Gate', value: `≥ ${minScore}`, sub: 'out of 100 required', good: null },
          { label: 'MOS Gate', value: `≥ ${minMOS}%`, sub: 'below intrinsic value', good: null },
        ].map(({ label, value, sub, good }) => (
          <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-600">{label}</div>
            <div className={cn('mt-1.5 text-2xl font-mono font-bold tabular-nums', good === true ? 'text-emerald-400' : good === false ? 'text-zinc-600' : 'text-zinc-100')}>
              {value}
            </div>
            <div className="mt-0.5 text-xs text-zinc-600">{sub}</div>
          </div>
        ))}
      </div>

      {/* Paper portfolio summary */}
      {portfolio && portfolio.positions.length > 0 && (() => {
        // Sector concentration — group positions by sector
        const sectorMap: Record<string, number> = {}
        for (const p of portfolio.positions) {
          const s = p.sector ?? 'Unknown'
          sectorMap[s] = (sectorMap[s] ?? 0) + p.currentValue
        }
        const sectors = Object.entries(sectorMap)
          .map(([sector, value]) => ({ sector, value, pct: portfolio.totalValue > 0 ? (value / portfolio.totalValue) * 100 : 0 }))
          .sort((a, b) => b.value - a.value)

        return (
          <>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">Paper Portfolio</h2>
                <div className="flex gap-4 text-xs flex-wrap">
                  <span className="text-zinc-600">
                    Value <span className="font-mono text-zinc-300">${portfolio.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </span>
                  {(portfolio.totalDividends ?? 0) > 0 && (
                    <span className="text-zinc-600">
                      Dividends <span className="font-mono text-emerald-400">+${(portfolio.totalDividends ?? 0).toFixed(2)}</span>
                    </span>
                  )}
                  <span className={cn('font-mono font-medium', portfolio.totalGainLoss >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {portfolio.totalGainLoss >= 0 ? '+' : ''}{portfolio.totalGainLossPct.toFixed(2)}%
                    {(portfolio.totalDividends ?? 0) > 0 && (
                      <span className="text-zinc-500 font-normal ml-1">
                        ({(portfolio.totalReturnWithDividends ?? 0) >= 0 ? '+' : ''}{(portfolio.totalReturnWithDividends ?? 0).toFixed(2)}% incl. div)
                      </span>
                    )}
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      {['Ticker', 'Shares', 'Avg Cost', 'Price', 'Value', 'G/L', 'Score', 'MOS', 'Held'].map(h => (
                        <th key={h} className="pb-2 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600 pr-4">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/40">
                    {portfolio.positions.map(p => (
                      <tr key={p.ticker} className="hover:bg-zinc-800/20 transition-colors">
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-zinc-100">{p.ticker}</span>
                            {p.needsThesisReview && (
                              <span className="rounded border border-amber-700/60 bg-amber-900/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-400 uppercase tracking-wide" title="Held > 1 year — review thesis">
                                REVIEW
                              </span>
                            )}
                          </div>
                          {p.sector && <div className="text-[10px] text-zinc-600 mt-0.5">{p.sector}</div>}
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-zinc-400">{p.shares}</td>
                        <td className="py-2.5 pr-4 font-mono text-zinc-500">${p.avgCostBasis.toFixed(2)}</td>
                        <td className="py-2.5 pr-4 font-mono text-zinc-300">${p.currentPrice.toFixed(2)}</td>
                        <td className="py-2.5 pr-4 font-mono text-zinc-300">${p.currentValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                        <td className={cn('py-2.5 pr-4 font-mono text-xs', p.gainLoss >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                          {p.gainLoss >= 0 ? '+' : ''}{p.gainLossPct.toFixed(1)}%
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className={cn('font-mono text-xs', (p.philosophyScore ?? 0) >= 55 ? 'text-violet-400' : 'text-zinc-600')}>
                            {p.philosophyScore ?? '—'}
                          </span>
                        </td>
                        <td className={cn('py-2.5 pr-4 font-mono text-xs', (p.mosAtPurchase ?? 0) >= 30 ? 'text-emerald-400' : 'text-amber-400')}>
                          {p.mosAtPurchase != null ? `${p.mosAtPurchase.toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-2.5 font-mono text-xs text-zinc-600">
                          {p.daysHeld != null ? `${p.daysHeld}d` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Sector concentration */}
            {sectors.length > 0 && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
                <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-zinc-500">Sector Concentration</h2>
                <div className="space-y-2.5">
                  {sectors.map(({ sector, pct }) => (
                    <div key={sector} className="flex items-center gap-3">
                      <div className="w-28 shrink-0 text-xs text-zinc-400 truncate">{sector}</div>
                      <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all', pct >= 30 ? 'bg-red-500' : pct >= 20 ? 'bg-amber-500' : 'bg-violet-500')}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                      <div className={cn('w-10 text-right font-mono text-xs tabular-nums', pct >= 30 ? 'text-red-400' : pct >= 20 ? 'text-amber-400' : 'text-zinc-400')}>
                        {pct.toFixed(1)}%
                      </div>
                      {pct >= 30 && <span className="text-[9px] text-red-500 font-bold uppercase">AT CAP</span>}
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[10px] text-zinc-700">Max 30% per sector. Red = at cap, amber = approaching (≥20%).</p>
              </div>
            )}
          </>
        )
      })()}

      {/* Parameters + Gates side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-zinc-500">Risk Parameters</h2>
          <div className="space-y-5">
            <div>
              <div className="flex justify-between mb-1.5">
                <label className="text-sm text-zinc-400">Min Philosophy Score</label>
                <span className="text-sm font-mono font-bold text-violet-400">{minScore}</span>
              </div>
              <input
                type="range" min={40} max={80} value={minScore}
                onChange={e => setMinScore(Number(e.target.value))}
                className="w-full accent-violet-600"
              />
              <div className="flex justify-between mt-1 text-[10px] text-zinc-700">
                <span>Permissive (40)</span><span>Strict (80)</span>
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1.5">
                <label className="text-sm text-zinc-400">Min Margin of Safety</label>
                <span className="text-sm font-mono font-bold text-emerald-400">{minMOS}%</span>
              </div>
              <input
                type="range" min={15} max={50} value={minMOS}
                onChange={e => setMinMOS(Number(e.target.value))}
                className="w-full accent-emerald-600"
              />
              <div className="flex justify-between mt-1 text-[10px] text-zinc-700">
                <span>Flexible (15%)</span><span>Conservative (50%)</span>
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
              {[
                { label: 'Max Position Size', value: '10%', note: 'Graham/Dodd hard limit' },
                { label: 'Principles Active', value: '137', note: 'Graham + Buffett + Fisher' },
                { label: 'Hard Veto Count', value: '4', note: 'Any one blocks trade' },
              ].map(({ label, value, note }) => (
                <div key={label} className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-zinc-400">{label}</div>
                    <div className="text-[10px] text-zinc-700">{note}</div>
                  </div>
                  <span className="font-mono text-sm font-bold text-zinc-300">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-zinc-500">Philosophy Decision Gates</h2>
          <div className="space-y-3">
            {PHILOSOPHY_GATES.map((gate) => (
              <div key={gate.step} className={cn('rounded-lg border p-4', gate.border, gate.bg)}>
                <div className="flex items-start gap-3">
                  <span className={cn('font-mono text-xs font-bold tabular-nums mt-0.5', gate.color)}>{gate.step}</span>
                  <div className="flex-1 min-w-0">
                    <div className={cn('text-sm font-semibold', gate.color)}>{gate.title}</div>
                    <div className="text-xs text-zinc-500 mt-0.5">{gate.desc}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {gate.examples.map(ex => (
                        <span key={ex} className="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-0.5 text-[10px] text-zinc-500">{ex}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Decision log */}
      {decisions.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">Last Run Decisions</h2>
            <span className="text-[11px] text-zinc-700">
              {lastRun?.ranAt ? new Date(lastRun.ranAt).toLocaleString() : ''} · {isPaper ? 'Paper' : 'Live'} mode
            </span>
          </div>
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/80">
                  {['Ticker', 'Action', 'Score', 'MOS', 'Reason', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 bg-zinc-900/40">
                {decisions.flatMap((d) => {
                  const rows = [
                    <tr
                      key={d.ticker}
                      className="hover:bg-zinc-800/40 cursor-pointer transition-colors"
                      onClick={() => setExpanded(expanded === d.ticker ? null : d.ticker)}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-bold text-zinc-100">{d.ticker}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('rounded border px-2 py-0.5 text-[11px] font-bold tracking-wide', ACTION_STYLE[d.action] ?? 'text-zinc-500')}>
                          {d.action}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {d.score != null ? (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 rounded-full bg-zinc-800 overflow-hidden">
                              <div
                                className={cn('h-full rounded-full', d.score >= 55 ? 'bg-violet-500' : 'bg-zinc-600')}
                                style={{ width: `${d.score}%` }}
                              />
                            </div>
                            <span className={cn('font-mono text-xs tabular-nums', d.score >= 55 ? 'text-violet-400' : 'text-zinc-600')}>{d.score}</span>
                          </div>
                        ) : <span className="text-zinc-700">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {d.mos != null ? (
                          <span className={cn('font-mono text-sm tabular-nums', d.mos >= 30 ? 'text-emerald-400' : d.mos >= 0 ? 'text-amber-400' : 'text-red-400')}>
                            {d.mos >= 0 ? '+' : ''}{d.mos.toFixed(1)}%
                          </span>
                        ) : <span className="text-zinc-700">—</span>}
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <span className="text-xs text-zinc-500 line-clamp-1">{d.reason ?? `Score ${d.score} · MOS ${d.mos?.toFixed(1)}%`}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <svg viewBox="0 0 20 20" fill="currentColor" className={cn('h-3.5 w-3.5 ml-auto text-zinc-700 transition-transform', expanded === d.ticker ? 'rotate-180' : '')}>
                          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </td>
                    </tr>,
                  ]
                  if (expanded === d.ticker) {
                    rows.push(
                      <tr key={`${d.ticker}-detail`} className="bg-zinc-900/80">
                        <td colSpan={6} className="px-4 py-3 border-t border-zinc-800/50">
                          <div className="font-mono text-xs text-zinc-400 leading-5">
                            <span className="text-zinc-600">AUDIT TRAIL / {d.ticker}</span><br />
                            {'>'} Action: {d.action}<br />
                            {d.score != null && <>{`>`} Philosophy score: {d.score}/100{d.conviction ? ` (conviction: ${d.conviction.toUpperCase().replace('_', ' ')})` : ''}<br /></>}
                            {d.mos != null && <>{`>`} Margin of safety: {d.mos >= 0 ? '+' : ''}{d.mos.toFixed(1)}% {d.mos >= 30 ? '✓ PASS' : '✗ FAIL'}<br /></>}
                            {/* Two-column IV projection */}
                            {(d.grahamNumber || d.dcfValue) && (
                              <>
                                {'>'} Intrinsic value breakdown:<br />
                                <div className="ml-4 mt-1 mb-1 grid grid-cols-2 gap-3 max-w-sm">
                                  {d.grahamNumber && (
                                    <div className="rounded border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
                                      <div className="text-[9px] text-zinc-600 uppercase tracking-widest">Graham Number</div>
                                      <div className="text-zinc-300 font-bold">${d.grahamNumber.toFixed(2)}</div>
                                      <div className="text-[9px] text-zinc-700">√(22.5 × EPS × BV)</div>
                                    </div>
                                  )}
                                  {d.dcfValue && (
                                    <div className="rounded border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
                                      <div className="text-[9px] text-zinc-600 uppercase tracking-widest">DCF Value</div>
                                      <div className="text-zinc-300 font-bold">${d.dcfValue.toFixed(2)}</div>
                                      <div className="text-[9px] text-zinc-700">10yr owner earnings</div>
                                    </div>
                                  )}
                                </div>
                                {d.intrinsicValue && <>{`>`} Composite IV: ${d.intrinsicValue.toFixed(2)} {d.price ? `(current: $${d.price.toFixed(2)})` : ''}<br /></>}
                              </>
                            )}
                            {d.shares != null && <>{`>`} Shares: {d.shares} @ ${d.price?.toFixed(2)}<br /></>}
                            {d.reason && <>{`>`} {d.reason}<br /></>}
                          </div>
                        </td>
                      </tr>
                    )
                  }
                  return rows
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : !loading && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-6 py-10 text-center">
          <p className="text-sm text-zinc-600">No decisions yet. Add tickers to your watchlist and click Run Now.</p>
        </div>
      )}

      <PortfolioReviewPanel />
    </div>
  )
}
