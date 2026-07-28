'use client'

import { useState, useEffect } from 'react'
import { useTradingMode } from '@/contexts/TradingMode'
import { cn } from '@/lib/utils'
import { PortfolioReviewPanel } from '@/components/ui/PortfolioReviewPanel'


interface RunResult {
  ranAt: string
  mode: string
  watchlistScanned: number
  buys: number
  qualityBuys?: number
  skipped: number
  vetoed: number
  topBlockers?: Array<{ reason: string; count: number }>
  qualityExposure?: { deployed: number; cap: number }
  circuitBreaker?: boolean
  marketCrashCarveOut?: boolean
  investedPct?: number | null
  sleeve?: { action: string; shares: number; reason: string } | null
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

function DecisionTable({
  decisions,
  expanded,
  setExpanded,
  dynamicMinScore,
}: {
  decisions: RunResult['results']
  expanded: string | null
  setExpanded: (v: string | null) => void
  dynamicMinScore: number
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/80">
            <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">Ticker</th>
            <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">Action</th>
            <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600 hidden sm:table-cell">Score</th>
            <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600 hidden sm:table-cell">MOS</th>
            <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">Reason</th>
            <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600"></th>
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
                <td className="px-4 py-3 hidden sm:table-cell">
                  {d.score != null ? (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className={cn('h-full rounded-full', d.score >= dynamicMinScore ? 'bg-violet-500' : 'bg-zinc-600')}
                          style={{ width: `${d.score}%` }}
                        />
                      </div>
                      <span className={cn('font-mono text-xs tabular-nums', d.score >= dynamicMinScore ? 'text-violet-400' : 'text-zinc-600')}>{d.score}</span>
                    </div>
                  ) : <span className="text-zinc-700">—</span>}
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  {d.mos != null ? (
                    <span className={cn('font-mono text-sm tabular-nums', d.mos >= 15 ? 'text-emerald-400' : d.mos >= 0 ? 'text-amber-400' : 'text-red-400')}>
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
                      {d.mos != null && <>{`>`} Margin of safety: {d.mos >= 0 ? '+' : ''}{d.mos.toFixed(1)}% {d.mos >= 15 ? '✓ PASS' : '✗ FAIL'}<br /></>}
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
  )
}

export default function AutopilotPage() {
  const { mode, setMode, isPaper } = useTradingMode()
  const [autopilotOn, setAutopilotOn] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [minScore, setMinScore] = useState(55)
  const [minMOS, setMinMOS] = useState(30)
  const [lastRun, setLastRun] = useState<RunResult | null>(null)
  const [dailyRundown, setDailyRundown] = useState<string | null>(null)
  const [portfolio, setPortfolio] = useState<PaperPortfolio | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [fullRunning, setFullRunning] = useState(false)
  const [fullRunStep, setFullRunStep] = useState(0)
  const [fullRunResult, setFullRunResult] = useState<any>(null)
  const [skippedExpanded, setSkippedExpanded] = useState(false)
  const [showGates, setShowGates] = useState(false)
  const [cleanupState, setCleanupState] = useState<'idle' | 'running' | 'done'>('idle')
  const [cleanupResult, setCleanupResult] = useState<{ deleted: number; remaining: number } | null>(null)

  const runCleanup = async () => {
    if (!confirm('This will permanently delete all auto-discovered stocks from the watchlist (~6000 rows). Manual picks are kept. Continue?')) return
    setCleanupState('running')
    try {
      const res = await fetch('/api/admin/cleanup-watchlist', { method: 'POST' })
      const data = await res.json()
      setCleanupResult({ deleted: data.deleted, remaining: data.remaining })
      setCleanupState('done')
    } catch {
      setCleanupState('idle')
    }
  }

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
        if (config.dailyRundown) setDailyRundown(config.dailyRundown)
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

  // Near-miss: scored but just below the dynamic threshold
  const dynamicMinScore = lastRun?.macro?.effectiveMinScore ?? minScore
  const buyDecisions = decisions.filter(d => d.action.includes('BUY'))
  const nearMisses = decisions.filter(d =>
    (d.action === 'SKIP' || d.action === 'VETOED') &&
    d.score != null &&
    d.score >= 35 &&
    d.score < dynamicMinScore
  )
  const skippedDecisions = decisions.filter(d =>
    d.action === 'SKIP' || d.action === 'VETOED' || d.action === 'ERROR'
  ).filter(d => !(d.score != null && d.score >= 35 && d.score < dynamicMinScore))

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Autopilot</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Every trade routed through 130+ Graham · Buffett · Fisher principles. Paper trading only by default.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
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
            className="w-full sm:w-auto rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-400 hover:border-zinc-500 disabled:opacity-40 transition-colors"
          >
            {running ? 'Running…' : 'Run Watchlist'}
          </button>

          <button
            onClick={runFull}
            disabled={running || fullRunning}
            className="relative w-full sm:w-auto flex items-center justify-center gap-2 rounded-lg border border-violet-600/60 bg-violet-600/10 px-5 py-2 text-sm font-semibold text-violet-300 hover:bg-violet-600/20 disabled:opacity-40 transition-all"
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
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="text-[10px] font-medium uppercase tracking-widest opacity-70">Market Temperature</div>
                <span className="font-mono font-bold text-sm uppercase">{temp}</span>
                <span className="font-mono text-sm opacity-80">CAPE {lastRun.macro.sp500Cape.toFixed(1)}×</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono">
                <span className="text-zinc-500">10Y: <span className="text-zinc-300">{lastRun.macro.treasury10yr}</span></span>
                <span className="text-zinc-500">Excess yield: <span className="text-zinc-300">{lastRun.macro.excessEarningsYield}</span></span>
                <span className="text-zinc-500">Score gate: <span className="text-zinc-300">{lastRun.macro.effectiveMinScore}</span></span>
                <span className="text-zinc-500">Cash reserve: <span className="text-zinc-300">{lastRun.macro.effectiveCashReservePct.toFixed(0)}%</span></span>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Safety flags — only render when something unusual is active */}
      {(lastRun?.circuitBreaker || lastRun?.marketCrashCarveOut) && (
        <div className="flex flex-col gap-2">
          {lastRun?.circuitBreaker && (
            <div className="rounded-xl border border-red-800/50 bg-red-900/15 px-4 py-3 flex items-center gap-3">
              <span className="text-lg">🛑</span>
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-red-400">Circuit breaker active</div>
                <p className="text-xs text-zinc-400 mt-0.5">Portfolio is &gt;10% off its recent peak — new buys are halted until it recovers. Sells remain active.</p>
              </div>
            </div>
          )}
          {lastRun?.marketCrashCarveOut && (
            <div className="rounded-xl border border-sky-800/50 bg-sky-900/15 px-4 py-3 flex items-center gap-3">
              <span className="text-lg">🌊</span>
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-sky-400">Market-crash carve-out active</div>
                <p className="text-xs text-zinc-400 mt-0.5">SPY itself is in freefall — the per-stock falling-knife veto is suspended so the engine can buy the fear.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Invested-by-default status: how much capital is working + sleeve activity */}
      {lastRun?.investedPct != null && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-600">Invested</span>
            <span className={cn('font-mono text-lg font-bold', lastRun.investedPct >= 70 ? 'text-emerald-400' : lastRun.investedPct >= 40 ? 'text-amber-400' : 'text-zinc-400')}>
              {lastRun.investedPct}%
            </span>
          </div>
          <div className="flex-1 min-w-[120px] h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-600/60" style={{ width: `${Math.min(100, lastRun.investedPct)}%` }} />
          </div>
          {lastRun?.sleeve && (
            <span className="text-[11px] font-mono text-sky-400">
              Sleeve {lastRun.sleeve.action} {lastRun.sleeve.shares} sh
            </span>
          )}
        </div>
      )}

      {/* Why nothing was bought — the recorded blockers from the last run */}
      {(lastRun?.topBlockers ?? []).length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80 flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">Top Blockers — why the last run didn&apos;t buy more</h2>
            {lastRun?.qualityExposure && (
              <span className="text-[10px] font-mono text-zinc-600">
                Quality mode: <span className="text-sky-400">${lastRun.qualityExposure.deployed.toLocaleString()}</span> / ${lastRun.qualityExposure.cap.toLocaleString()} deployed
              </span>
            )}
          </div>
          <div className="px-4 py-3 flex flex-col gap-1.5">
            {(lastRun?.topBlockers ?? []).map((b, i) => {
              const maxCount = lastRun?.topBlockers?.[0]?.count ?? 1
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="font-mono text-sm font-bold text-amber-400 w-8 text-right shrink-0">{b.count}×</span>
                  <div className="flex-1 min-w-0">
                    <div className="h-1 rounded-full bg-zinc-800 mb-1">
                      <div className="h-1 rounded-full bg-amber-600/60" style={{ width: `${Math.max(8, (b.count / maxCount) * 100)}%` }} />
                    </div>
                    <p className="text-xs text-zinc-400 truncate" title={b.reason}>{b.reason}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Daily AI Market Rundown */}
      {dailyRundown && (
        <div className="rounded-xl border border-violet-800/30 bg-violet-900/10 p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-violet-400">Daily Market Rundown</span>
            <span className="text-xs text-zinc-600">{lastRun?.ranAt ? new Date(lastRun.ranAt).toLocaleDateString() : ''}</span>
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed">{dailyRundown}</p>
        </div>
      )}

      {/* Full auto run — progress + result */}
      {(fullRunning || fullRunResult) && (
        <div className="rounded-xl border border-violet-800/40 bg-violet-900/10 p-5">
          {fullRunning && (
            <>
              <div className="mb-3 text-xs font-medium uppercase tracking-widest text-violet-400">Full Autopilot Running</div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-0">
                {[
                  { n: 1, label: 'Discovering value candidates from FMP screener…' },
                  { n: 2, label: 'Quick-screening candidates…' },
                  { n: 3, label: 'Deep analysis + moat scoring…' },
                ].map(({ n, label }, i) => (
                  <div key={n} className="flex items-center gap-0">
                    <div className={cn(
                      'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all',
                      fullRunStep >= n ? 'text-violet-300' : 'text-zinc-600'
                    )}>
                      <span className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                        fullRunStep > n ? 'bg-violet-600 text-white' :
                        fullRunStep === n ? 'bg-violet-500/30 text-violet-300 ring-1 ring-violet-500 animate-pulse' :
                        'bg-zinc-800 text-zinc-600'
                      )}>{fullRunStep > n ? '✓' : n}</span>
                      {label}
                    </div>
                    {i < 2 && <span className="text-zinc-700 hidden sm:inline mx-1">→</span>}
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
              {(fullRunResult.newlyDiscovered > 0 || fullRunResult.watchlistTotal > 0) && (
                <div className="flex flex-wrap gap-3 text-xs text-zinc-500 mb-2">
                  {fullRunResult.newlyDiscovered > 0 && (
                    <span className="rounded-full border border-sky-800/40 bg-sky-900/15 px-3 py-1 text-sky-400">
                      +{fullRunResult.newlyDiscovered} newly discovered
                    </span>
                  )}
                  {fullRunResult.watchlistTotal > 0 && (
                    <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1">
                      {fullRunResult.watchlistScanned}/{fullRunResult.watchlistTotal} watchlist analyzed today
                      {fullRunResult.watchlistTotal > fullRunResult.watchlistScanned && ` · cycles in ${Math.ceil(fullRunResult.watchlistTotal / (fullRunResult.watchlistScanned || 1))} days`}
                    </span>
                  )}
                </div>
              )}
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
                      {[
                        { label: 'Ticker', hide: '' },
                        { label: 'Shares', hide: 'hidden sm:table-cell' },
                        { label: 'Avg Cost', hide: 'hidden md:table-cell' },
                        { label: 'Price', hide: 'hidden sm:table-cell' },
                        { label: 'Value', hide: '' },
                        { label: 'G/L', hide: '' },
                        { label: 'Score', hide: 'hidden sm:table-cell' },
                        { label: 'MOS', hide: 'hidden sm:table-cell' },
                        { label: 'Held', hide: 'hidden md:table-cell' },
                      ].map(({ label, hide }) => (
                        <th key={label} className={`pb-2 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600 pr-4 ${hide}`}>{label}</th>
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
                        <td className="py-2.5 pr-4 font-mono text-zinc-400 hidden sm:table-cell">{p.shares}</td>
                        <td className="py-2.5 pr-4 font-mono text-zinc-500 hidden md:table-cell">${p.avgCostBasis.toFixed(2)}</td>
                        <td className="py-2.5 pr-4 font-mono text-zinc-300 hidden sm:table-cell">${p.currentPrice.toFixed(2)}</td>
                        <td className="py-2.5 pr-4 font-mono text-zinc-300">${p.currentValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                        <td className={cn('py-2.5 pr-4 font-mono text-xs', p.gainLoss >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                          {p.gainLoss >= 0 ? '+' : ''}{p.gainLossPct.toFixed(1)}%
                        </td>
                        <td className="py-2.5 pr-4 hidden sm:table-cell">
                          <span className={cn('font-mono text-xs', (p.philosophyScore ?? 0) >= 45 ? 'text-violet-400' : 'text-zinc-600')}>
                            {p.philosophyScore ?? '—'}
                          </span>
                        </td>
                        <td className={cn('py-2.5 pr-4 font-mono text-xs hidden sm:table-cell', (p.mosAtPurchase ?? 0) >= 15 ? 'text-emerald-400' : 'text-amber-400')}>
                          {p.mosAtPurchase != null ? `${p.mosAtPurchase.toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-2.5 font-mono text-xs text-zinc-600 hidden md:table-cell">
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

      {/* Risk Parameters */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-zinc-500">Risk Parameters</h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
              { label: 'Principles Active', value: '130+', note: 'Graham + Buffett + Fisher' },
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

        {/* How it works — collapsible */}
        <div className="mt-5 border-t border-zinc-800/60 pt-4">
          <button
            onClick={() => setShowGates(s => !s)}
            className="text-xs text-zinc-600 hover:text-zinc-400 flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={showGates ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
            </svg>
            {showGates ? 'Hide' : 'How the autopilot works'}
          </button>
          {showGates && (
            <div className="mt-3 p-4 rounded-xl border border-zinc-800 bg-zinc-900/50 text-xs text-zinc-400 space-y-2">
              <p><span className="text-red-400 font-medium">Step 1 — Veto check:</span> Any single hard veto (negative owner earnings, debt/equity {`>`} 2×, fraud flag) blocks the trade.</p>
              <p><span className="text-violet-400 font-medium">Step 2 — Philosophy score:</span> 130+ principles across Graham, Buffett, Munger, Fisher. Must meet dynamic minimum (wide moat = lower bar).</p>
              <p><span className="text-emerald-400 font-medium">Step 3 — Margin of safety:</span> Must trade at a discount to intrinsic value. Wide-moat companies need less discount.</p>
              <p><span className="text-amber-400 font-medium">Step 4 — Position sizing:</span> Conviction tier drives size. Exceptional = up to 20% of capital.</p>
            </div>
          )}
        </div>
      </div>

      {/* Decision log — grouped by category */}
      {decisions.length > 0 ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">Last Run Decisions</h2>
            <span className="text-[11px] text-zinc-700">
              {lastRun?.ranAt ? new Date(lastRun.ranAt).toLocaleString() : ''} · {isPaper ? 'Paper' : 'Live'} mode
            </span>
          </div>

          {/* Buys — highlighted section */}
          {buyDecisions.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-emerald-400">
                Buys ({buyDecisions.length})
              </div>
              <DecisionTable decisions={buyDecisions} expanded={expanded} setExpanded={setExpanded} dynamicMinScore={dynamicMinScore} />
            </div>
          )}

          {/* Near misses */}
          {nearMisses.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-widest text-amber-400">
                  Near Misses ({nearMisses.length})
                </span>
                <span className="text-[10px] text-zinc-600">— scored {'>'}35 but below gate of {dynamicMinScore}</span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-amber-900/30">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900/80">
                      <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">Ticker</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">Score</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600 hidden sm:table-cell">MOS</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">Gap</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 bg-amber-950/5">
                    {nearMisses.map(d => (
                      <tr key={d.ticker} className="hover:bg-zinc-800/20 transition-colors">
                        <td className="px-4 py-3 font-mono text-sm font-bold text-zinc-100">{d.ticker}</td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-amber-400 font-semibold">{d.score}</span>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          {d.mos != null ? (
                            <span className={cn('font-mono text-sm tabular-nums', d.mos >= 15 ? 'text-emerald-400' : d.mos >= 0 ? 'text-amber-400' : 'text-red-400')}>
                              {d.mos >= 0 ? '+' : ''}{d.mos.toFixed(1)}%
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[11px] rounded border border-amber-800/50 bg-amber-900/20 text-amber-400 px-1.5 py-0.5 font-medium">
                            {d.score != null ? `${dynamicMinScore - d.score} pts from qualifying` : '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          <span className="text-xs text-zinc-500 line-clamp-1">{d.reason ?? ''}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Skipped / Vetoed — collapsed by default */}
          {skippedDecisions.length > 0 && (
            <div>
              <button
                onClick={() => setSkippedExpanded(v => !v)}
                className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className={cn('h-3.5 w-3.5 transition-transform', skippedExpanded ? 'rotate-90' : '')}>
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
                Skipped / Vetoed ({skippedDecisions.length})
              </button>
              {skippedExpanded && (
                <DecisionTable decisions={skippedDecisions} expanded={expanded} setExpanded={setExpanded} dynamicMinScore={dynamicMinScore} />
              )}
            </div>
          )}
        </div>
      ) : !loading && (
        <div className="text-center py-12 text-zinc-500">
          <div className="text-4xl mb-3">🤖</div>
          <p className="font-medium text-zinc-300 mb-1">No runs yet</p>
          <p className="text-sm mb-4">Click &quot;Full Auto Run&quot; to start analyzing the market</p>
        </div>
      )}

      <PortfolioReviewPanel />

      {/* Watchlist cleanup — one-time migration */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mt-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1">Watchlist Cleanup</div>
            <p className="text-xs text-zinc-600 max-w-md">
              Removes all auto-discovered / SEC EDGAR stocks from the watchlist. The autopilot now uses the FMP screener as its universe — those 6000 rows are obsolete. Manual picks are kept.
            </p>
            {cleanupResult && (
              <p className="text-xs text-emerald-400 mt-2">
                ✓ Deleted {cleanupResult.deleted.toLocaleString()} rows · {cleanupResult.remaining} manual items kept
              </p>
            )}
          </div>
          <button
            onClick={runCleanup}
            disabled={cleanupState !== 'idle'}
            className="shrink-0 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-2 text-xs font-medium text-red-400 hover:border-red-700 hover:bg-red-900/30 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            {cleanupState === 'running' ? 'Cleaning…' : cleanupState === 'done' ? '✓ Done' : 'Clean up watchlist'}
          </button>
        </div>
      </div>
    </div>
  )
}
