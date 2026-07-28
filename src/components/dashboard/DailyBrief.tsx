'use client'

// The morning brief: live index moves, the yield curve, what's dominating the
// tape, our top-scored names, and the AI outlook. Client-fetched so the server
// dashboard render stays fast.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

interface Mover { ticker: string; name: string; price: number; changePct: number }
interface Brief {
  indices: Array<{ label: string; ticker: string; price: number | null; changePct: number | null }>
  rates: { tenYear: number | null; threeMonth: number | null; curveSpread: number | null; inverted: boolean | null }
  market: { cape: number; temperature: string; capeSource: string } | null
  gainers: Mover[]
  losers: Mover[]
  topScores: Array<{ ticker: string; name: string | null; score: number; mos: number; signal: string }>
  outlook: string | null
  outlookAsOf: string | null
  error?: string
}

const TEMP_COLOR: Record<string, string> = {
  cold: 'text-sky-400', fair: 'text-emerald-400', warm: 'text-amber-400',
  hot: 'text-orange-400', extreme: 'text-red-400',
}

function pct(v: number | null): string {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function MoverPill({ m }: { m: Mover }) {
  const up = m.changePct >= 0
  return (
    <Link href={`/analysis/${m.ticker}`} className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1 hover:border-zinc-700 transition-colors">
      <span className="font-mono text-xs font-bold text-zinc-200">{m.ticker}</span>
      <span className={cn('font-mono text-[11px]', up ? 'text-emerald-400' : 'text-red-400')}>{pct(m.changePct)}</span>
    </Link>
  )
}

export function DailyBrief() {
  const [brief, setBrief] = useState<Brief | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/market/brief').then(r => r.json()).then(setBrief).catch(() => setBrief(null)).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="h-44 animate-pulse rounded-xl bg-zinc-900/60 border border-zinc-800" />
  if (!brief || brief.error) return null

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-800 bg-zinc-900/80 flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Daily Brief</h2>
        {brief.market && (
          <div className="flex items-center gap-2 text-[11px] font-mono">
            <span className="text-zinc-600">Market</span>
            <span className={cn('font-bold uppercase', TEMP_COLOR[brief.market.temperature] ?? 'text-zinc-300')}>
              {brief.market.temperature}
            </span>
            <span className="text-zinc-600">· CAPE {brief.market.cape.toFixed(1)}</span>
          </div>
        )}
      </div>

      <div className="p-5 flex flex-col gap-5">
        {/* Indices + rates */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {brief.indices.map(idx => (
            <div key={idx.ticker}>
              <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-600">{idx.label}</div>
              <div className={cn('mt-0.5 font-mono text-lg font-bold tabular-nums',
                idx.changePct == null ? 'text-zinc-500' : idx.changePct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {pct(idx.changePct)}
              </div>
              {idx.price != null && <div className="text-[11px] font-mono text-zinc-600">${idx.price.toFixed(2)}</div>}
            </div>
          ))}
          <div>
            <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-600">10Y / 3M</div>
            <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-zinc-200">
              {brief.rates.tenYear != null ? `${brief.rates.tenYear.toFixed(2)}%` : '—'}
            </div>
            <div className={cn('text-[11px] font-mono', brief.rates.inverted ? 'text-red-400' : 'text-zinc-600')}>
              {brief.rates.curveSpread != null
                ? `${brief.rates.curveSpread >= 0 ? '+' : ''}${brief.rates.curveSpread}bp${brief.rates.inverted ? ' inverted' : ''}`
                : ''}
            </div>
          </div>
        </div>

        {/* Movers */}
        {(brief.gainers.length > 0 || brief.losers.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {brief.gainers.length > 0 && (
              <div>
                <div className="text-[10px] font-medium uppercase tracking-widest text-emerald-600/80 mb-1.5">Leading today</div>
                <div className="flex flex-wrap gap-1.5">{brief.gainers.map(m => <MoverPill key={m.ticker} m={m} />)}</div>
              </div>
            )}
            {brief.losers.length > 0 && (
              <div>
                <div className="text-[10px] font-medium uppercase tracking-widest text-red-600/80 mb-1.5">Lagging today</div>
                <div className="flex flex-wrap gap-1.5">{brief.losers.map(m => <MoverPill key={m.ticker} m={m} />)}</div>
              </div>
            )}
          </div>
        )}

        {/* Our top-scored buys */}
        {brief.topScores.length > 0 && (
          <div>
            <div className="text-[10px] font-medium uppercase tracking-widest text-violet-600/80 mb-1.5">Our top-scored buys</div>
            <div className="flex flex-wrap gap-1.5">
              {brief.topScores.map(s => (
                <Link key={s.ticker} href={`/analysis/${s.ticker}`}
                  className="flex items-center gap-1.5 rounded-md border border-violet-900/50 bg-violet-950/20 px-2 py-1 hover:border-violet-700 transition-colors">
                  <span className="font-mono text-xs font-bold text-zinc-200">{s.ticker}</span>
                  <span className="font-mono text-[11px] text-violet-400">{s.score}</span>
                  <span className="font-mono text-[11px] text-emerald-400">{s.mos >= 0 ? '+' : ''}{s.mos.toFixed(0)}%</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* AI outlook */}
        {brief.outlook && (
          <div className="rounded-lg border border-violet-900/30 bg-violet-950/20 p-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-violet-500 mb-1.5">Outlook</div>
            <p className="text-sm leading-relaxed text-zinc-300">{brief.outlook}</p>
          </div>
        )}
      </div>
    </div>
  )
}
