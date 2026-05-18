'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

function MarkdownText({ text }: { text: string }) {
  const sections = text.split(/^## /m).filter(Boolean)
  if (sections.length <= 1) {
    return <p className="text-sm text-zinc-300 leading-relaxed">{text}</p>
  }
  return (
    <div className="space-y-4">
      {sections.map((section, i) => {
        const lines = section.split('\n')
        const heading = lines[0].trim()
        const content = lines.slice(1).join('\n').trim()
        const isGrade = heading === 'Portfolio Grade'
        return (
          <div key={i} className={cn('rounded-lg p-3', isGrade ? 'border border-violet-800/40 bg-violet-900/10' : '')}>
            <div className={cn('text-xs font-semibold uppercase tracking-widest mb-1.5', isGrade ? 'text-violet-400' : 'text-zinc-500')}>{heading}</div>
            <p className={cn('text-sm leading-relaxed', isGrade ? 'text-violet-300 font-semibold' : 'text-zinc-300')}>{content}</p>
          </div>
        )
      })}
    </div>
  )
}

export function PortfolioReviewPanel() {
  const [review, setReview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<{ positionCount: number; generatedAt: string } | null>(null)

  const generate = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/portfolio/review', { method: 'POST' })
      const data = await res.json()
      if (data.error) setError(data.error)
      else {
        setReview(data.review)
        setMeta({ positionCount: data.positionCount, generatedAt: data.generatedAt })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-violet-900/30 bg-violet-900/5 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-widest text-violet-500">Claude Portfolio Review</h2>
          <p className="mt-0.5 text-xs text-zinc-600">AI analysis of your entire portfolio — risks, concentration, what to trim or add to</p>
        </div>
        {review && (
          <div className="flex items-center gap-3">
            {meta && <span className="text-[10px] text-zinc-700">{meta.positionCount} positions · {new Date(meta.generatedAt).toLocaleTimeString()}</span>}
            <button onClick={() => { setReview(null); setError(null) }} className="text-xs text-zinc-700 hover:text-zinc-500">Refresh</button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-900/10 px-4 py-3 text-sm text-red-400 mb-4">
          {error === 'ANTHROPIC_API_KEY not configured'
            ? 'Add ANTHROPIC_API_KEY to your Railway environment variables.'
            : error === 'No open positions to review'
            ? 'Run the autopilot first to build a portfolio, then come back for a review.'
            : error}
        </div>
      )}

      {review && <MarkdownText text={review} />}

      {!review && !loading && !error && (
        <button onClick={generate}
          className="flex items-center gap-2 rounded-lg border border-violet-700/50 bg-violet-900/20 px-4 py-2 text-sm font-medium text-violet-400 hover:bg-violet-900/30 transition-colors">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
          </svg>
          Review My Portfolio with Claude
        </button>
      )}

      {loading && (
        <div className="flex items-center gap-3 text-sm text-zinc-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          Claude is reviewing your portfolio…
        </div>
      )}
    </div>
  )
}
