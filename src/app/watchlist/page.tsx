'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { formatCurrency, mosColor, cn } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'

type FilterTab = 'all' | 'scored' | 'buy' | 'yahoo'

interface WatchlistItem {
  id: string
  ticker: string
  name: string
  sector?: string
  currentPrice: number
  targetPrice?: number
  intrinsicValue?: number
  marginOfSafety?: number
  isBuySignal: boolean
  addedAt: string
  notes?: string
  lastScore?: number
  lastMos?: number
  lastAction?: string
  lastSkipReason?: string
  lastAnalyzedAt?: string
  expectedCagr10yr?: number
  businessTier?: string
}

function WatchlistSkeleton() {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/80">
            {['Ticker', 'Price', 'Intrinsic Value', 'MOS', 'Score', 'Action', 'Added', ''].map(h => (
              <th key={h} className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60 bg-zinc-900/40">
          {Array.from({ length: 8 }).map((_, i) => (
            <tr key={i}>
              {Array.from({ length: 8 }).map((_, j) => (
                <td key={j} className="px-4 py-3">
                  <div className="h-4 bg-zinc-800 rounded animate-pulse" style={{ width: j === 0 ? '60px' : j === 7 ? '40px' : '80px' }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [activeTab, setActiveTab] = useState<FilterTab>('scored')
  const [ticker, setTicker] = useState('')
  const [adding, setAdding] = useState(false)

  const LIMIT = 100

  const loadWatchlist = useCallback(async (reset = false) => {
    const currentOffset = reset ? 0 : offset
    if (reset) {
      setLoading(true)
      setOffset(0)
    } else {
      setLoadingMore(true)
    }

    try {
      const params = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(currentOffset),
        ...(search ? { search } : {}),
      })
      const res = await fetch(`/api/watchlist?${params}`)
      const data = await res.json()
      const newItems: WatchlistItem[] = Array.isArray(data.items) ? data.items : []
      setTotal(data.total ?? 0)
      if (reset) {
        setItems(newItems)
      } else {
        setItems(prev => [...prev, ...newItems])
        setOffset(currentOffset + LIMIT)
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [search, offset])

  // Reload when search changes
  useEffect(() => {
    loadWatchlist(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(searchInput.trim())
  }

  const loadMore = async () => {
    const nextOffset = offset + LIMIT
    setLoadingMore(true)
    try {
      const params = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(nextOffset),
        ...(search ? { search } : {}),
      })
      const res = await fetch(`/api/watchlist?${params}`)
      const data = await res.json()
      const newItems: WatchlistItem[] = Array.isArray(data.items) ? data.items : []
      setItems(prev => [...prev, ...newItems])
      setOffset(nextOffset)
    } finally {
      setLoadingMore(false)
    }
  }

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
      loadWatchlist(true)
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
    setTotal(prev => prev - 1)
  }

  // Client-side tab filtering
  const filteredItems = (() => {
    const filtered = items.filter(item => {
      if (activeTab === 'scored') return item.lastScore != null
      if (activeTab === 'buy') return item.isBuySignal
      if (activeTab === 'yahoo') return item.notes?.toLowerCase().includes('yahoo') || item.notes?.toLowerCase().includes('auto-discovered')
      return true
    })
    if (activeTab === 'scored') {
      return [...filtered].sort((a, b) => (b.lastScore ?? 0) - (a.lastScore ?? 0))
    }
    return filtered
  })()

  const scoredCount = items.filter(i => i.lastScore != null).length
  const buySignals = items.filter(i => i.isBuySignal)
  const approaching = items.filter(i => !i.isBuySignal && i.marginOfSafety != null && i.marginOfSafety >= 10)

  const TABS: { id: FilterTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'scored', label: 'Scored' },
    { id: 'buy', label: 'Buy Signals' },
    { id: 'yahoo', label: 'Yahoo Picks' },
  ]

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Watchlist</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Businesses you understand and admire — waiting for Mr. Market to price them right.
          </p>
          <p className="mt-1 text-xs text-zinc-700">
            Scored: <span className="text-zinc-500">{scoredCount}</span> / Total: <span className="text-zinc-500">{total}</span>
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

      {/* Search + filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={handleSearchSubmit} className="flex gap-2 flex-1 min-w-0 max-w-sm">
          <input
            type="text"
            placeholder="Search ticker or name…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-700 focus:outline-none focus:ring-1 focus:ring-violet-700/30 transition-colors"
          />
          <button
            type="submit"
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-400 hover:border-zinc-500 transition-colors"
          >
            Search
          </button>
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(''); setSearchInput('') }}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Clear
            </button>
          )}
        </form>

        {/* Filter tabs */}
        <div className="flex rounded-lg bg-zinc-900 border border-zinc-800 p-0.5 gap-0.5">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                activeTab === tab.id
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-600 hover:text-zinc-400'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
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
        <WatchlistSkeleton />
      ) : filteredItems.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40">
          {activeTab === 'scored' && !search ? (
            <p className="text-sm text-zinc-500">
              No scored stocks yet — run the autopilot to start analyzing
            </p>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1} className="h-10 w-10 text-zinc-700">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <p className="text-sm text-zinc-600">
                {search ? `No stocks found matching "${search}"` : 'Add tickers of businesses you understand and want to own at the right price.'}
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/80">
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">Ticker</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">Price</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600 hidden sm:table-cell">Intrinsic Value</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">MOS</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600 hidden md:table-cell">Score</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">Signal</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600 hidden sm:table-cell">Added</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 bg-zinc-900/40">
                {filteredItems.map(item => (
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
                    <td className="px-4 py-3 font-mono text-zinc-400 hidden sm:table-cell">
                      {item.intrinsicValue ? formatCurrency(item.intrinsicValue) : '—'}
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
                      ) : item.lastMos != null ? (
                        <span className={cn('font-mono text-sm tabular-nums', item.lastMos >= 30 ? 'text-emerald-400' : item.lastMos >= 0 ? 'text-amber-400' : 'text-red-400')}>
                          {item.lastMos >= 0 ? '+' : ''}{item.lastMos.toFixed(1)}%
                          <span className="text-zinc-700 ml-1 text-[10px]">last</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {item.lastScore != null ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-12 rounded-full bg-zinc-800 overflow-hidden">
                            <div
                              className={cn('h-full rounded-full', item.lastScore >= 60 ? 'bg-emerald-500' : item.lastScore >= 45 ? 'bg-amber-500' : 'bg-zinc-600')}
                              style={{ width: `${item.lastScore}%` }}
                            />
                          </div>
                          <span className={cn('font-mono text-xs tabular-nums', item.lastScore >= 60 ? 'text-emerald-400' : item.lastScore >= 45 ? 'text-amber-400' : 'text-zinc-600')}>
                            {item.lastScore}
                          </span>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {item.isBuySignal ? (
                        <Badge variant="success">BUY NOW</Badge>
                      ) : item.lastAction === 'VETOED' ? (
                        <Badge variant="danger">VETOED</Badge>
                      ) : item.marginOfSafety != null && item.marginOfSafety >= 0 ? (
                        <Badge variant="warning">WATCH</Badge>
                      ) : (
                        <Badge variant="neutral">WAIT</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[10px] text-zinc-600 hidden sm:table-cell">
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

          {/* Load more */}
          {items.length < total && (
            <div className="flex items-center justify-center gap-3">
              <span className="text-xs text-zinc-600">Showing {items.length} of {total}</span>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-400 hover:border-zinc-500 disabled:opacity-40 transition-colors"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
