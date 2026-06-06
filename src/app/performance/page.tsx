'use client'

import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { cn } from '@/lib/utils'

interface WatchlistEntry {
  ticker: string
  name: string
  lastScore: number | null
  lastMos: number | null
  lastAction: string | null
}

interface PerfData {
  hasData: boolean
  message?: string
  topWatchlist?: WatchlistEntry[]
  lastRunResult?: {
    ranAt?: string
    watchlistScanned?: number
    buys?: number
    skipped?: number
    macro?: {
      marketTemperature?: string
      sp500Cape?: number
      treasury10yr?: string
    }
  } | null
  lastRunAt?: string | null
  summary?: {
    totalCost: number
    totalValue: number
    totalGainLoss: number
    totalGainLossPct: number
    realisedGainLoss: number
    openPositions: number
    closedPositions: number
    spyReturn: number | null
    alpha: number | null
    fromDate: string
    toDate: string
  }
  positions?: Array<{
    ticker: string
    shares: number
    avgCost: number
    currentPrice: number
    gainLossPct: number
    philosophyScore: number | null
    conviction: string | null
    mosAtPurchase: number | null
    firstPurchased: string
  }>
  spyPrices?: Array<{ date: string; close: number }>
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-600">{label}</div>
      <div className={cn('mt-1.5 text-2xl font-mono font-bold tabular-nums', color ?? 'text-zinc-100')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-600">{sub}</div>}
    </div>
  )
}

export default function PerformancePage() {
  const [data, setData] = useState<PerfData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/performance')
      .then(r => r.json())
      .then(setData)
      .catch(() => setData({ hasData: false, message: 'Failed to load performance data' }))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="h-8 w-48 animate-pulse rounded bg-zinc-800" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-800" />)}
      </div>
    </div>
  )

  if (!data?.hasData) {
    const macro = data?.lastRunResult?.macro
    const tempColors: Record<string, string> = {
      cold:    'border-sky-800/50 bg-sky-900/10 text-sky-400',
      fair:    'border-emerald-800/50 bg-emerald-900/10 text-emerald-400',
      warm:    'border-amber-800/50 bg-amber-900/10 text-amber-400',
      hot:     'border-orange-800/50 bg-orange-900/10 text-orange-400',
      extreme: 'border-red-800/50 bg-red-900/10 text-red-400',
    }
    const temp = macro?.marketTemperature
    const tempCls = temp ? (tempColors[temp] ?? 'border-zinc-700 bg-zinc-900 text-zinc-400') : null

    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Performance</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Portfolio returns vs SPY benchmark.</p>
        </div>

        {/* Status card */}
        <div className="rounded-xl border border-amber-800/30 bg-amber-900/10 px-5 py-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-amber-400 mb-1">Autopilot running in paper mode</div>
          <p className="text-sm text-zinc-400">Tracking starts when the autopilot enters its first position. Run the autopilot to begin building a paper portfolio.</p>
        </div>

        {/* Market context from last run */}
        {macro && tempCls && (
          <div className={cn('rounded-xl border px-4 py-3', tempCls)}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="text-[10px] font-medium uppercase tracking-widest opacity-70">Market Temperature</div>
                <span className="font-mono font-bold text-sm uppercase">{temp}</span>
                {macro.sp500Cape != null && <span className="font-mono text-sm opacity-80">CAPE {macro.sp500Cape.toFixed(1)}×</span>}
              </div>
              {macro.treasury10yr && (
                <span className="text-xs font-mono text-zinc-300">10Y Treasury: {macro.treasury10yr}</span>
              )}
            </div>
          </div>
        )}

        {/* Last run info */}
        {data?.lastRunAt && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-xs text-zinc-500 flex flex-wrap gap-4">
            <span>Last run: <span className="text-zinc-300">{new Date(data.lastRunAt).toLocaleString()}</span></span>
            {data.lastRunResult?.watchlistScanned != null && (
              <span>Scanned: <span className="font-mono text-zinc-300">{data.lastRunResult.watchlistScanned}</span></span>
            )}
            {data.lastRunResult?.buys != null && (
              <span>Buys executed: <span className={cn('font-mono', data.lastRunResult.buys > 0 ? 'text-emerald-400' : 'text-zinc-300')}>{data.lastRunResult.buys}</span></span>
            )}
          </div>
        )}

        {/* Top scored watchlist stocks */}
        {(data?.topWatchlist ?? []).length > 0 && (
          <div>
            <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500 mb-3">Top Scored Stocks</h2>
            <div className="rounded-xl border border-zinc-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/80">
                    {['Ticker', 'Name', 'Score', 'MOS', 'Last Action'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50 bg-zinc-900/20">
                  {(data?.topWatchlist ?? []).map(w => (
                    <tr key={w.ticker} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <a href={`/analysis/${w.ticker}`} className="font-mono font-bold text-violet-400 hover:text-violet-300">{w.ticker}</a>
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500 max-w-[180px] truncate">{w.name}</td>
                      <td className="px-4 py-3">
                        <span className={cn('font-mono text-sm font-bold', (w.lastScore ?? 0) >= 60 ? 'text-emerald-400' : (w.lastScore ?? 0) >= 45 ? 'text-amber-400' : 'text-zinc-600')}>
                          {w.lastScore ?? '—'}
                        </span>
                      </td>
                      <td className={cn('px-4 py-3 font-mono text-xs', (w.lastMos ?? 0) >= 15 ? 'text-emerald-400' : 'text-amber-400')}>
                        {w.lastMos != null ? `${w.lastMos >= 0 ? '+' : ''}${w.lastMos.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-600">{w.lastAction ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    )
  }

  const s = data.summary!
  const positions = data.positions ?? []
  const best = positions[0]
  const worst = positions[positions.length - 1]

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Performance</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Paper portfolio vs SPY · {s.fromDate} → {s.toDate}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Portfolio Return"
          value={`${s.totalGainLossPct >= 0 ? '+' : ''}${s.totalGainLossPct.toFixed(2)}%`}
          sub={`${s.totalGainLoss >= 0 ? '+' : ''}$${Math.abs(s.totalGainLoss).toLocaleString('en-US', { maximumFractionDigits: 0 })} unrealised`}
          color={s.totalGainLossPct >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <StatCard
          label="SPY Return"
          value={s.spyReturn !== null ? `${s.spyReturn >= 0 ? '+' : ''}${s.spyReturn.toFixed(2)}%` : 'N/A'}
          sub="Same period benchmark"
          color={s.spyReturn !== null ? (s.spyReturn >= 0 ? 'text-blue-400' : 'text-red-400') : 'text-zinc-600'}
        />
        <StatCard
          label="Alpha vs SPY"
          value={s.alpha !== null ? `${s.alpha >= 0 ? '+' : ''}${s.alpha.toFixed(2)}%` : 'N/A'}
          sub="Outperformance"
          color={s.alpha !== null ? (s.alpha >= 0 ? 'text-violet-400' : 'text-red-400') : 'text-zinc-600'}
        />
        <StatCard
          label="Positions"
          value={`${s.openPositions}`}
          sub={`${s.closedPositions} closed · $${s.totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })} total value`}
        />
      </div>

      {/* Realised P&L if any */}
      {s.realisedGainLoss !== 0 && (
        <div className={cn(
          'rounded-xl border px-5 py-3 text-sm',
          s.realisedGainLoss >= 0
            ? 'border-emerald-800/40 bg-emerald-900/10 text-emerald-400'
            : 'border-red-800/40 bg-red-900/10 text-red-400'
        )}>
          Realised P&L from closed positions: {s.realisedGainLoss >= 0 ? '+' : ''}${s.realisedGainLoss.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      )}

      {/* Best / Worst */}
      {positions.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {best && (
            <div className="rounded-xl border border-emerald-900/40 bg-emerald-900/10 p-4">
              <div className="text-[10px] font-medium uppercase tracking-widest text-emerald-600 mb-2">Best Performer</div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-lg font-bold text-zinc-100">{best.ticker}</span>
                  <div className="text-xs text-zinc-500 mt-0.5">Score {best.philosophyScore ?? '—'} · MOS at buy {best.mosAtPurchase?.toFixed(1) ?? '—'}%</div>
                </div>
                <span className="font-mono text-2xl font-bold text-emerald-400">+{best.gainLossPct.toFixed(1)}%</span>
              </div>
            </div>
          )}
          {worst && worst.ticker !== best?.ticker && (
            <div className="rounded-xl border border-red-900/40 bg-red-900/10 p-4">
              <div className="text-[10px] font-medium uppercase tracking-widest text-red-600 mb-2">Worst Performer</div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-lg font-bold text-zinc-100">{worst.ticker}</span>
                  <div className="text-xs text-zinc-500 mt-0.5">Score {worst.philosophyScore ?? '—'} · MOS at buy {worst.mosAtPurchase?.toFixed(1) ?? '—'}%</div>
                </div>
                <span className={cn('font-mono text-2xl font-bold', worst.gainLossPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {worst.gainLossPct >= 0 ? '+' : ''}{worst.gainLossPct.toFixed(1)}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SPY chart (last 60 days) */}
      {data.spyPrices && data.spyPrices.length > 1 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-zinc-500">SPY — Last 60 Days</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.spyPrices} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tick={{ fill: '#52525b', fontSize: 10 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fill: '#52525b', fontSize: 10 }} domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }}
                labelStyle={{ color: '#a1a1aa' }}
                itemStyle={{ color: '#818cf8' }}
              />
              <Line type="monotone" dataKey="close" stroke="#818cf8" strokeWidth={2} dot={false} name="SPY" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* All positions table */}
      {positions.length > 0 && (
        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-800 bg-zinc-900/80">
            <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">All Open Positions</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/40">
                {['Ticker', 'Shares', 'Avg Cost', 'Current', 'Return', 'Score', 'MOS @ Buy', 'Conviction'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50 bg-zinc-900/20">
              {positions.map(p => (
                <tr key={p.ticker} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-zinc-100">{p.ticker}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">{p.shares}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">${p.avgCost.toFixed(2)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-300">${p.currentPrice.toFixed(2)}</td>
                  <td className={cn('px-4 py-3 font-mono text-sm font-bold', p.gainLossPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {p.gainLossPct >= 0 ? '+' : ''}{p.gainLossPct.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('font-mono text-xs', (p.philosophyScore ?? 0) >= 45 ? 'text-violet-400' : 'text-zinc-600')}>
                      {p.philosophyScore ?? '—'}
                    </span>
                  </td>
                  <td className={cn('px-4 py-3 font-mono text-xs', (p.mosAtPurchase ?? 0) >= 15 ? 'text-emerald-400' : 'text-amber-400')}>
                    {p.mosAtPurchase != null ? `${p.mosAtPurchase.toFixed(1)}%` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold border',
                      p.conviction === 'STRONG BUY' ? 'border-emerald-800 bg-emerald-900/30 text-emerald-400' :
                      p.conviction === 'BUY' ? 'border-blue-800 bg-blue-900/30 text-blue-400' :
                      'border-zinc-800 bg-zinc-900 text-zinc-600'
                    )}>{p.conviction ?? '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
