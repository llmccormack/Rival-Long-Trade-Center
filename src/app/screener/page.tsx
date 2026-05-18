'use client'

import { useState } from 'react'
import { ScreenerTable } from '@/components/screener/ScreenerTable'
import { cn } from '@/lib/utils'
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

type Tab = 'graham' | 'market'

export default function ScreenerPage() {
  const [tab, setTab] = useState<Tab>('market')

  // Graham screener state
  const [grahamResults, setGrahamResults] = useState<ScreenedStock[]>([])
  const [grahamLoading, setGrahamLoading] = useState(false)
  const [grahamError, setGrahamError] = useState<string | null>(null)
  const [limit, setLimit] = useState(50)
  const [minMarketCap, setMinMarketCap] = useState(1_000_000_000)

  // Market scan state
  const [scanResults, setScanResults] = useState<any[]>([])
  const [scanMeta, setScanMeta] = useState<any>(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [autoPromote, setAutoPromote] = useState(false)
  const [scanLimit, setScanLimit] = useState(40)

  const runGrahamScreen = async () => {
    setGrahamLoading(true)
    setGrahamError(null)
    try {
      const res = await fetch(`/api/screener?limit=${limit}&minMarketCap=${minMarketCap}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error)
      setGrahamResults(data.results)
    } catch (e: any) {
      setGrahamError(e.message)
    } finally {
      setGrahamLoading(false)
    }
  }

  const runMarketScan = async () => {
    setScanLoading(true)
    setScanError(null)
    try {
      const params = new URLSearchParams({
        limit: String(scanLimit),
        autoPromote: String(autoPromote),
      })
      const res = await fetch(`/api/screener/market-scan?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Scan failed')
      setScanResults(data.results)
      setScanMeta(data)
    } catch (e: any) {
      setScanError(e.message)
    } finally {
      setScanLoading(false)
    }
  }

  const passingAll = grahamResults.filter(r => r.criteria.overallPass)
  const buySignals = grahamResults.filter(r => r.criteria.overallPass && r.intrinsicValue?.isBuySignal)

  return (
    <div className="flex flex-col gap-6 p-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Screener</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Find undervalued stocks — Graham criteria or whole-market philosophy scan.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex rounded-xl border border-zinc-800 bg-zinc-900/60 p-1 gap-1 w-fit">
        <button
          onClick={() => setTab('market')}
          className={cn(
            'rounded-lg px-4 py-2 text-sm font-medium transition-all',
            tab === 'market'
              ? 'bg-violet-600/20 text-violet-300 border border-violet-700/40'
              : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          <span className="flex items-center gap-2">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            Market Scan
          </span>
        </button>
        <button
          onClick={() => setTab('graham')}
          className={cn(
            'rounded-lg px-4 py-2 text-sm font-medium transition-all',
            tab === 'graham'
              ? 'bg-violet-600/20 text-violet-300 border border-violet-700/40'
              : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          Graham Ch.14
        </button>
      </div>

      {/* ── MARKET SCAN TAB ────────────────────────────────────────────── */}
      {tab === 'market' && (
        <>
          {/* How it works */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { step: '1', label: 'Yahoo Finance pre-screen', desc: 'Pulls 200+ candidates from value screens across the whole US market — free, no API key', color: 'text-sky-400 border-sky-900/40 bg-sky-950/20' },
              { step: '2', label: 'FMP deep analysis', desc: 'Runs full fundamentals on each candidate — income, balance sheet, key metrics, operating margin trend', color: 'text-violet-400 border-violet-900/40 bg-violet-950/20' },
              { step: '3', label: 'Philosophy scoring', desc: 'All 241 principles applied — Graham, Greenblatt, Lynch, Klarman, Munger and more. Vetoes block bad buys', color: 'text-emerald-400 border-emerald-900/40 bg-emerald-950/20' },
            ].map(({ step, label, desc, color }) => (
              <div key={step} className={cn('rounded-xl border p-4', color)}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold text-zinc-300">{step}</span>
                  <span className="text-xs font-semibold text-zinc-200">{label}</span>
                </div>
                <p className="text-[11px] text-zinc-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-widest text-zinc-600">Stocks to analyse</label>
              <select
                value={scanLimit}
                onChange={e => setScanLimit(Number(e.target.value))}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 focus:border-violet-700 focus:outline-none"
              >
                <option value={20}>20 stocks (~80 FMP calls)</option>
                <option value={40}>40 stocks (~160 FMP calls)</option>
                <option value={60}>60 stocks (~240 FMP calls)</option>
              </select>
            </div>
            <div className="flex items-center gap-2 self-end pb-1">
              <input
                id="autop"
                type="checkbox"
                checked={autoPromote}
                onChange={e => setAutoPromote(e.target.checked)}
                className="rounded border-zinc-600 bg-zinc-800 accent-violet-500"
              />
              <label htmlFor="autop" className="text-xs text-zinc-400 cursor-pointer">
                Auto-add qualifying stocks to watchlist
              </label>
            </div>
            <button
              onClick={runMarketScan}
              disabled={scanLoading}
              className="flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-40 transition-colors"
            >
              {scanLoading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Scanning market…
                </>
              ) : 'Scan Market'}
            </button>

            {scanMeta && (
              <div className="ml-auto flex gap-4 text-xs">
                <span className="text-zinc-600"><span className="font-mono text-zinc-300">{scanMeta.candidatesFromYahoo}</span> from Yahoo</span>
                <span className="text-zinc-600"><span className="font-mono text-zinc-300">{scanMeta.analysed}</span> deep-analysed</span>
                <span className="text-zinc-600"><span className="font-mono text-emerald-400">{scanMeta.buySignals}</span> buy signals</span>
                <span className="text-zinc-600"><span className="font-mono text-zinc-500">{scanMeta.fmpCallsUsed}</span> FMP calls used</span>
                {scanMeta.autoPromoted?.length > 0 && (
                  <span className="text-zinc-600"><span className="font-mono text-violet-400">{scanMeta.autoPromoted.length}</span> added to watchlist</span>
                )}
              </div>
            )}
          </div>

          {scanError && (
            <div className="rounded-xl border border-red-800/50 bg-red-900/20 px-4 py-3 text-sm text-red-400">
              {scanError}
            </div>
          )}

          {/* Results table */}
          {scanResults.length > 0 && (
            <div className="rounded-xl border border-zinc-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900">
                    <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">Ticker</th>
                    <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">Name</th>
                    <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">Sector</th>
                    <th className="px-4 py-3 text-right text-[10px] font-medium uppercase tracking-widest text-zinc-600">Price</th>
                    <th className="px-4 py-3 text-right text-[10px] font-medium uppercase tracking-widest text-zinc-600">P/E</th>
                    <th className="px-4 py-3 text-right text-[10px] font-medium uppercase tracking-widest text-zinc-600">P/B</th>
                    <th className="px-4 py-3 text-right text-[10px] font-medium uppercase tracking-widest text-zinc-600">MOS</th>
                    <th className="px-4 py-3 text-right text-[10px] font-medium uppercase tracking-widest text-zinc-600">Score</th>
                    <th className="px-4 py-3 text-center text-[10px] font-medium uppercase tracking-widest text-zinc-600">Signal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {scanResults.map((r) => (
                    <tr key={r.ticker} className="bg-zinc-900 hover:bg-zinc-800/60 transition-colors group">
                      <td className="px-4 py-3">
                        <a href={`/analysis/${r.ticker}`} className="font-mono text-sm font-semibold text-violet-400 hover:text-violet-300">
                          {r.ticker}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-400 max-w-[160px] truncate">{r.name}</td>
                      <td className="px-4 py-3 text-[11px] text-zinc-600">{r.sector ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-zinc-300">${r.price?.toFixed(2) ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-zinc-300">{r.pe?.toFixed(1) ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-zinc-300">{r.pb?.toFixed(2) ?? '—'}</td>
                      <td className={cn('px-4 py-3 text-right font-mono text-xs', r.mos >= 30 ? 'text-emerald-400' : r.mos > 0 ? 'text-amber-400' : 'text-red-400')}>
                        {r.mos > 0 ? `${r.mos.toFixed(1)}%` : `${r.mos.toFixed(1)}%`}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn(
                          'font-mono text-sm font-bold',
                          r.philosophyScore >= 70 ? 'text-emerald-400'
                            : r.philosophyScore >= 50 ? 'text-amber-400'
                            : 'text-zinc-500'
                        )}>
                          {r.philosophyScore}
                        </span>
                        <span className="text-[10px] text-zinc-700">/100</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn(
                          'rounded border px-2 py-0.5 text-[10px] font-semibold',
                          r.signal === 'BUY' ? 'border-emerald-700 bg-emerald-900/30 text-emerald-400'
                            : r.signal === 'HOLD' ? 'border-sky-700 bg-sky-900/30 text-sky-400'
                            : r.vetoCount > 0 ? 'border-red-800 bg-red-900/20 text-red-500'
                            : 'border-zinc-700 bg-zinc-800 text-zinc-500'
                        )}>
                          {r.vetoCount > 0 && r.signal !== 'BUY' ? 'VETO' : r.signal}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!scanLoading && scanResults.length === 0 && !scanError && (
            <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1} className="h-10 w-10 text-zinc-700">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <p className="text-sm text-zinc-600">Hit <span className="text-zinc-400">Scan Market</span> to search the whole US market for value opportunities.</p>
              <p className="text-xs text-zinc-700">Yahoo Finance pre-screens ~200 candidates · FMP analyses the top {scanLimit}</p>
            </div>
          )}
        </>
      )}

      {/* ── GRAHAM CH.14 TAB ──────────────────────────────────────────── */}
      {tab === 'graham' && (
        <>
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
              onClick={runGrahamScreen}
              disabled={grahamLoading}
              className="flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-40 transition-colors"
            >
              {grahamLoading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Screening…
                </>
              ) : 'Run Screen'}
            </button>
            {grahamResults.length > 0 && (
              <div className="ml-auto flex gap-4 text-xs">
                <span className="text-zinc-600"><span className="text-zinc-300 font-mono">{grahamResults.length}</span> screened</span>
                <span className="text-zinc-600"><span className="text-emerald-400 font-mono">{passingAll.length}</span> pass all criteria</span>
                <span className="text-zinc-600"><span className="text-emerald-300 font-mono">{buySignals.length}</span> buy signals</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {CRITERIA.map(({ label, desc }) => (
              <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="text-xs font-medium text-zinc-300">{label}</div>
                <div className="mt-0.5 text-[10px] text-zinc-600 leading-tight">{desc}</div>
              </div>
            ))}
          </div>

          {grahamError && (
            <div className="rounded-xl border border-red-800/50 bg-red-900/20 px-4 py-3 text-sm text-red-400">
              {grahamError}
            </div>
          )}

          {grahamResults.length > 0 && <ScreenerTable results={grahamResults} />}

          {!grahamLoading && grahamResults.length === 0 && !grahamError && (
            <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1} className="h-10 w-10 text-zinc-700">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <p className="text-sm text-zinc-600">Configure parameters above and run the screen.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
