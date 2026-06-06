'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const SUGGESTIONS = ['KO', 'JNJ', 'PG', 'WMT', 'BRK.B', 'V', 'MCD', 'MSFT', 'JPM', 'XOM']

export default function AnalysisLandingPage() {
  const router = useRouter()
  const [ticker, setTicker] = useState('')

  const go = (t: string) => {
    const clean = t.trim().toUpperCase()
    if (clean) router.push(`/analysis/${clean}`)
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-4 md:p-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-zinc-100">Stock Analysis</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Full Graham screener · intrinsic value · philosophy audit for any ticker
        </p>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); go(ticker) }}
        className="flex w-full max-w-md items-center gap-2"
      >
        <input
          autoFocus
          type="text"
          placeholder="Enter ticker (e.g. KO, JNJ, WMT)"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 font-mono text-base text-zinc-100 placeholder:text-zinc-700 focus:border-violet-700 focus:outline-none focus:ring-1 focus:ring-violet-700/30 transition-colors"
        />
        <button
          type="submit"
          disabled={!ticker.trim()}
          className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-30 transition-colors"
        >
          Analyse →
        </button>
      </form>

      <div className="flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((t) => (
          <button
            key={t}
            onClick={() => go(t)}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-500 hover:border-zinc-600 hover:text-zinc-300 transition-all"
          >
            {t}
          </button>
        ))}
      </div>

      <p className="text-center text-xs text-zinc-700 max-w-sm">
        Analysis runs Graham Chapter 14 criteria, calculates intrinsic value using owner earnings DCF + Graham Number, and scores against 130+ philosophy principles.
      </p>
    </div>
  )
}
