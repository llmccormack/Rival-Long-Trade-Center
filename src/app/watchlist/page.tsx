'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { formatCurrency, mosColor, mosLabel, cn } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import type { WatchlistEntry } from '@/types'

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [ticker, setTicker] = useState('')
  const [adding, setAdding] = useState(false)

  const loadWatchlist = () => {
    setLoading(true)
    fetch('/api/watchlist').then(r => r.json()).then(setItems).finally(() => setLoading(false))
  }

  useEffect(loadWatchlist, [])

  const addTicker = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ticker.trim()) return
    setAdding(true)
    try {
      await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: ticker.toUpperCase() }),
      })
      setTicker('')
      loadWatchlist()
    } finally {
      setAdding(false)
    }
  }

  const remove = async (id: string) => {
    await fetch('/api/watchlist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const buySignals = items.filter(i => i.isBuySignal)
  const approaching = items.filter(i => !i.isBuySignal && i.marginOfSafety != null && i.marginOfSafety >= 10)

  return (
    <div className="flex flex-col gap-6 p-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Watchlist</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Businesses you understand and admire — waiting for Mr. Market to price them right.
          </p>
        </div>
        <form onSubmit={addTicker} className="flex gap-2">
          <input
            type="text"
            placeholder="Add ticker (e.g. KO)"
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            className="w-36 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-mono text-sm text-zinc-100 placeholder:text-zinc-700 focus:border-violet-700 focus:outline-none focus:ring-1 focus:ring-violet-700/30 transition-colors"
          />
          <button
            type="submit"
            disabled={adding || !ticker.trim()}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-1.5 text-sm text-zinc-300 hover:border-violet-700 hover:text-violet-400 disabled:opacity-40 transition-all"
          >
            {adding ? 'Adding…' : '+ Add'}
          </button>
        </form>
      </div>

      {/* Signal banners */}
      {buySignals.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-800/50 bg-emerald-900/15 px-4 py-3">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <div>
            <span className="text-sm font-medium text-emerald-400">
              {buySignals.length} stock{buySignals.length > 1 ? 's' : ''} at or below buy threshold
            </span>
            <div className="mt-0.5 flex flex-wrap gap-2">
              {buySignals.map(i => (
                <Link key={i.ticker} href={`/analysis/${i.ticker}`}
                  className="font-mono text-sm font-semibold text-emerald-300 hover:underline">
                  {i.ticker}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {approaching.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-800/40 bg-amber-900/10 px-4 py-3">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-amber-500">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
          </svg>
          <span className="text-sm text-amber-400/80">
            <span className="font-medium text-amber-400">{approaching.length} stock{approaching.length > 1 ? 's' : ''}</span> approaching the 30% MOS threshold
          </span>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="h-48 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900" />
      ) : items.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1} className="h-10 w-10 text-zinc-700">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <p className="text-sm text-zinc-600">Add tickers of businesses you understand and want to own at the right price.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/80">
                {['Ticker', 'Price', 'Intrinsic Value', 'Buy Target (30% MOS)', 'Margin of Safety', '10yr CAGR', 'Quality', 'Signal', 'Added', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 bg-zinc-900/40">
              {items.map(item => (
                <tr key={item.id} className="hover:bg-zinc-800/40 transition-colors group">
                  <td className="px-4 py-3">
                    <Link href={`/analysis/${item.ticker}`} className="font-mono font-bold text-zinc-100 hover:text-violet-400 transition-colors">
                      {item.ticker}
                    </Link>
                    <div className="text-[10px] text-zinc-600 mt-0.5">{item.name}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-zinc-300">
                    {item.currentPrice > 0 ? formatCurrency(item.currentPrice) : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-zinc-400">
                    {item.intrinsicValue ? formatCurrency(item.intrinsicValue) : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-zinc-500">
                    {item.targetPrice ? formatCurrency(item.targetPrice) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {item.marginOfSafety != null ? (
                      <div>
                        <span className={cn('font-mono text-sm font-semibold tabular-nums', mosColor(item.marginOfSafety))}>
                          {item.marginOfSafety >= 0 ? '+' : ''}{item.marginOfSafety.toFixed(1)}%
                        </span>
                        <div className="mt-0.5 h-1 w-16 rounded-full bg-zinc-800 overflow-hidden">
                          <div
                            className={cn('h-full rounded-full', item.marginOfSafety >= 30 ? 'bg-emerald-500' : item.marginOfSafety >= 0 ? 'bg-amber-500' : 'bg-red-500')}
                            style={{ width: `${Math.max(0, Math.min(100, item.marginOfSafety))}%` }}
                          />
                        </div>
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {item.expectedCagr10yr != null ? (
                      <span className={cn('font-mono text-sm tabular-nums', item.expectedCagr10yr >= 0.10 ? 'text-emerald-400' : item.expectedCagr10yr >= 0.07 ? 'text-amber-400' : 'text-zinc-600')}>
                        {(item.expectedCagr10yr * 100).toFixed(1)}%
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {item.businessTier ? (() => {
                      const tierCfg: Record<string, { cls: string; short: string }> = {
                        wonderful: { cls: 'text-amber-400', short: '★ WON' },
                        good:      { cls: 'text-sky-400',   short: '◆ GOOD' },
                        adequate:  { cls: 'text-zinc-400',  short: '◇ ADQ' },
                        mediocre:  { cls: 'text-red-400',   short: '▽ MED' },
                      }
                      const t = tierCfg[item.businessTier]
                      return t ? <span className={cn('font-mono text-xs font-semibold', t.cls)}>{t.short}</span> : null
                    })() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {item.isBuySignal ? (
                      <Badge variant="success">BUY NOW</Badge>
                    ) : item.marginOfSafety != null && item.marginOfSafety >= 0 ? (
                      <Badge variant="warning">WATCH</Badge>
                    ) : (
                      <Badge variant="neutral">WAIT</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[10px] text-zinc-600">
                    {new Date(item.addedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => remove(item.id)}
                      className="text-[10px] text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      Remove
                    </button>
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
