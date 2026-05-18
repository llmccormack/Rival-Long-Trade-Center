'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

export function ThesisPanel({ ticker }: { ticker: string }) {
  const [thesis, setThesis] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/thesis/${ticker}`, { method: 'POST' })
      const data = await res.json()
      if (data.error) setError(data.error)
      else setThesis(data.thesis)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">Investment Thesis</h2>
          <p className="mt-0.5 text-xs text-zinc-600">AI-generated using Graham · Buffett · Lynch · Klarman principles</p>
        </div>
        {!thesis && (
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-violet-700/50 bg-violet-900/20 px-4 py-2 text-sm font-medium text-violet-400 hover:bg-violet-900/30 disabled:opacity-40 transition-colors"
          >
            {loading ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
                Generating…
              </>
            ) : (
              <>
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                </svg>
                Generate Thesis
              </>
            )}
          </button>
        )}
        {thesis && (
          <button
            onClick={() => { setThesis(null); setError(null) }}
            className="text-xs text-zinc-600 hover:text-zinc-400"
          >
            Regenerate
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-900/10 px-4 py-3 text-sm text-red-400">
          {error === 'ANTHROPIC_API_KEY not configured'
            ? 'Add ANTHROPIC_API_KEY to your Railway environment variables to enable thesis generation.'
            : error}
        </div>
      )}

      {thesis && (
        <div className="prose prose-sm prose-invert max-w-none">
          {thesis.split('\n\n').map((para, i) => (
            <p key={i} className={cn('text-sm text-zinc-300 leading-relaxed', i > 0 ? 'mt-3' : '')}>{para}</p>
          ))}
        </div>
      )}

      {!thesis && !error && !loading && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-8 text-center text-xs text-zinc-600">
          Click Generate Thesis to get an AI-written investment case for {ticker}
        </div>
      )}
    </div>
  )
}
