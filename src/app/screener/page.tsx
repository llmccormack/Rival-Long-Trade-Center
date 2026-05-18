'use client'

import { useState } from 'react'
import { ScreenerTable } from '@/components/screener/ScreenerTable'
import type { ScreenedStock } from '@/types'

const CRITERIA = [
  { label: 'P/E ≤ 15', desc: 'Price-to-earnings on 7yr avg earnings' },
  { label: 'P/B ≤ 1.5', desc: 'Price-to-book value' },
  { label: 'Current Ratio ≥ 2', desc: 'Current assets / current liabilities' },
  { label: 'LTD ≤ Net Current Assets', desc: 'Long-term debt vs working capital' },
  { label: 'EPS Growth ≥ 3%/yr', desc: '10-year compound earnings growth' },
  { label: 'Dividends ≥ 20 Years', desc: 'Uninterrupted dividend record' },
  { label: 'No Earnings Deficit', desc: 'No loss years in the past decade' },
]

export default function ScreenerPage() {
  const [results, setResults] = useState<ScreenedStock[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(50)
  const [minMarketCap, setMinMarketCap] = useState(1_000_000_000)

  const runScreen = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/screener?limit=${limit}&minMarketCap=${minMarketCap}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error)
      setResults(data.results)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const passingAll = results.filter(r => r.criteria.overallPass)
  const buySignals = results.filter(r => r.criteria.overallPass && r.intrinsicValue?.isBuySignal)

  return (
    <div className="flex flex-col gap-6 p-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Graham Screener</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Chapter 14 — Defensive Investor Criteria. All seven must pass to qualify.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium uppercase tracking-widest text-zinc-600">Candidates</label>
          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 focus:border-violet-700 focus:outline-none"
          >
            <option value={25}>25 stocks</option>
            <option value={50}>50 stocks</option>
            <option value={100}>100 stocks</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium uppercase tracking-widest text-zinc-600">Min Market Cap</label>
          <select
            value={minMarketCap}
            onChange={e => setMinMarketCap(Number(e.target.value))}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 focus:border-violet-700 focus:outline-none"
          >
            <option value={500_000_000}>$500M+</option>
            <option value={1_000_000_000}>$1B+</option>
            <option value={5_000_000_000}>$5B+</option>
            <option value={10_000_000_000}>$10B+</option>
          </select>
        </div>
        <button
          onClick={runScreen}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-40 transition-colors"
        >
          {loading ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Screening…
            </>
          ) : 'Run Screen'}
        </button>

        {results.length > 0 && (
          <div className="ml-auto flex gap-4 text-xs">
            <span className="text-zinc-600"><span className="text-zinc-300 font-mono">{results.length}</span> screened</span>
            <span className="text-zinc-600"><span className="text-emerald-400 font-mono">{passingAll.length}</span> pass all criteria</span>
            <span className="text-zinc-600"><span className="text-emerald-300 font-mono">{buySignals.length}</span> buy signals (≥30% MOS)</span>
          </div>
        )}
      </div>

      {/* Criteria grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {CRITERIA.map(({ label, desc }) => (
          <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <div className="text-xs font-medium text-zinc-300">{label}</div>
            <div className="mt-0.5 text-[10px] text-zinc-600 leading-tight">{desc}</div>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-800/50 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          {error}
        </div>
      )}

      {results.length > 0 && <ScreenerTable results={results} />}

      {!loading && results.length === 0 && !error && (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1} className="h-10 w-10 text-zinc-700">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <p className="text-sm text-zinc-600">Configure parameters above and run the screen.</p>
        </div>
      )}
    </div>
  )
}
