'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

type Mode = 'thesis' | 'deepdive'

function MarkdownText({ text }: { text: string }) {
  const sections = text.split(/^## /m).filter(Boolean)
  if (sections.length <= 1) {
    return (
      <div>
        {text.split('\n\n').map((para, i) => (
          <p key={i} className={cn('text-sm text-zinc-300 leading-relaxed', i > 0 ? 'mt-3' : '')}>{para}</p>
        ))}
      </div>
    )
  }
  return (
    <div className="space-y-4">
      {sections.map((section, i) => {
        const lines = section.split('\n')
        const heading = lines[0].trim()
        const content = lines.slice(1).join('\n').trim()
        return (
          <div key={i}>
            <div className="text-xs font-semibold uppercase tracking-widest text-violet-400 mb-1.5">{heading}</div>
            <p className="text-sm text-zinc-300 leading-relaxed">{content}</p>
          </div>
        )
      })}
    </div>
  )
}

export function DeepDivePanel({ ticker }: { ticker: string }) {
  const [mode, setMode] = useState<Mode>('thesis')
  const [thesis, setThesis] = useState<string | null>(null)
  const [deepDive, setDeepDive] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentContent = mode === 'thesis' ? thesis : deepDive
  const hasContent = !!currentContent

  const generate = async () => {
    setLoading(true)
    setError(null)
    try {
      const endpoint = mode === 'thesis' ? `/api/thesis/${ticker}` : `/api/analysis/${ticker}`
      const res = await fetch(endpoint, { method: 'POST' })
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        if (mode === 'thesis') setThesis(data.thesis)
        else setDeepDive(data.analysis)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">Claude Analysis</h2>
          <p className="mt-0.5 text-xs text-zinc-600">AI-powered using Graham · Buffett · Lynch · Klarman principles</p>
        </div>
        <div className="flex items-center gap-2">
          {hasContent && (
            <button onClick={() => { if (mode === 'thesis') setThesis(null); else setDeepDive(null); setError(null) }}
              className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors">
              Regenerate
            </button>
          )}
        </div>
      </div>

      {/* Mode tabs */}
      <div className="flex rounded-lg bg-zinc-950 border border-zinc-800 p-0.5 mb-4 w-fit">
        {([['thesis', 'Investment Thesis'], ['deepdive', 'Deep Dive']] as [Mode, string][]).map(([m, label]) => (
          <button key={m} onClick={() => { setMode(m); setError(null) }}
            className={cn(
              'rounded-md px-4 py-1.5 text-xs font-semibold transition-all',
              mode === m
                ? 'bg-violet-600/20 text-violet-300 border border-violet-700/50'
                : 'text-zinc-600 hover:text-zinc-400'
            )}>
            {label}
          </button>
        ))}
      </div>

      {/* Description */}
      {!hasContent && !loading && !error && (
        <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-xs text-zinc-600">
          {mode === 'thesis'
            ? '4-paragraph investment case: business quality, valuation, risks, verdict.'
            : '5-section deep dive: business quality, valuation, what the philosophy engine found, red flags, verdict.'}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-900/50 bg-red-900/10 px-4 py-3 text-sm text-red-400">
          {error === 'ANTHROPIC_API_KEY not configured'
            ? 'Add ANTHROPIC_API_KEY to your Railway environment variables to enable Claude analysis.'
            : error}
        </div>
      )}

      {/* Content */}
      {currentContent && <MarkdownText text={currentContent} />}

      {/* Generate button */}
      {!hasContent && !loading && (
        <button onClick={generate}
          className="mt-2 flex items-center gap-2 rounded-lg border border-violet-700/50 bg-violet-900/20 px-4 py-2 text-sm font-medium text-violet-400 hover:bg-violet-900/30 transition-colors">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
          </svg>
          Generate {mode === 'thesis' ? 'Thesis' : 'Deep Dive'}
        </button>
      )}

      {loading && (
        <div className="flex items-center gap-3 mt-2 text-sm text-zinc-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          Analysing {ticker} with Claude…
        </div>
      )}
    </div>
  )
}
