'use client'

// Decision Journal — the app's memory of its own judgment.
// Weekly investor letters + AI post-mortems on every closed trade, each with a
// verdict on whether the thesis played out, was wrong, or the exit was the mistake.

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface PostMortem {
  id: string
  ticker: string
  entryMode: string
  openedAt: string
  closedAt: string
  holdingDays: number
  returnPct: number
  dividendsEarned: number
  closeReason: string
  thesisAtPurchase: string[]
  verdict: string
  lessons: string
}

interface Letter {
  id: string
  generatedAt: string
  content: string
}

interface JournalData {
  postMortems: PostMortem[]
  letters: Letter[]
  verdictCounts: Record<string, number>
  error?: string
}

const VERDICT_META: Record<string, { label: string; cls: string }> = {
  thesis_played_out: { label: 'Thesis played out', cls: 'border-emerald-800 bg-emerald-900/30 text-emerald-400' },
  thesis_wrong:      { label: 'Thesis wrong',      cls: 'border-red-800 bg-red-900/30 text-red-400' },
  exit_discipline:   { label: 'Exit discipline',   cls: 'border-blue-800 bg-blue-900/30 text-blue-400' },
  exit_premature:    { label: 'Exit premature',    cls: 'border-amber-800 bg-amber-900/30 text-amber-400' },
  inconclusive:      { label: 'Inconclusive',      cls: 'border-zinc-700 bg-zinc-900 text-zinc-500' },
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const meta = VERDICT_META[verdict] ?? VERDICT_META.inconclusive
  return (
    <span className={cn('rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border', meta.cls)}>
      {meta.label}
    </span>
  )
}

function ModeBadge({ mode }: { mode: string }) {
  return (
    <span className={cn(
      'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide border',
      mode === 'quality'
        ? 'border-sky-800 bg-sky-900/30 text-sky-400'
        : 'border-violet-800 bg-violet-900/30 text-violet-400'
    )}>
      {mode}
    </span>
  )
}

export default function JournalPage() {
  const [data, setData] = useState<JournalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedThesis, setExpandedThesis] = useState<string | null>(null)
  const [letterIndex, setLetterIndex] = useState(0)

  useEffect(() => {
    fetch('/api/journal')
      .then(r => r.json())
      .then(setData)
      .catch(() => setData({ postMortems: [], letters: [], verdictCounts: {}, error: 'Failed to load journal' }))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="h-8 w-48 animate-pulse rounded bg-zinc-800" />
      <div className="h-40 animate-pulse rounded-xl bg-zinc-800" />
      <div className="h-24 animate-pulse rounded-xl bg-zinc-800" />
    </div>
  )

  const letters = data?.letters ?? []
  const postMortems = data?.postMortems ?? []
  const verdictCounts = data?.verdictCounts ?? {}
  const letter = letters[letterIndex]

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Decision Journal</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          What every closed trade taught us, and the weekly letter. Verdicts compare outcomes against the thesis recorded at purchase — no hindsight rewriting.
        </p>
      </div>

      {/* Verdict scoreboard */}
      {postMortems.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(VERDICT_META).map(([key, meta]) => (
            <div key={key} className={cn('rounded-lg border px-3 py-2 flex items-center gap-2', meta.cls)}>
              <span className="font-mono text-lg font-bold">{verdictCounts[key] ?? 0}</span>
              <span className="text-[10px] font-medium uppercase tracking-wide opacity-80">{meta.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Weekly letter */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800 bg-zinc-900/80 flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
            {letter ? `Investor Letter — ${new Date(letter.generatedAt).toLocaleDateString('en-US', { dateStyle: 'long' })}` : 'Investor Letter'}
          </h2>
          {letters.length > 1 && (
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={() => setLetterIndex(i => Math.min(letters.length - 1, i + 1))}
                disabled={letterIndex >= letters.length - 1}
                className="px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
              >← older</button>
              <button
                onClick={() => setLetterIndex(i => Math.max(0, i - 1))}
                disabled={letterIndex === 0}
                className="px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
              >newer →</button>
            </div>
          )}
        </div>
        <div className="px-5 py-4">
          {letter ? (
            <div className="space-y-3">
              {letter.content.split('\n').filter(l => l.trim()).map((para, i) => (
                <p key={i} className="text-sm leading-relaxed text-zinc-300">{para}</p>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-600">
              No letter yet — the first one generates Sunday morning once the weekly cron is set up
              (see <code className="text-violet-400">SETUP-TODO.md</code>), or trigger it manually:
              POST <code className="text-violet-400">/api/reports/weekly</code>.
            </p>
          )}
        </div>
      </div>

      {/* Post-mortems */}
      <div>
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500 mb-3">
          Trade Post-Mortems {postMortems.length > 0 && <span className="text-zinc-700">({postMortems.length})</span>}
        </h2>

        {postMortems.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-6 text-sm text-zinc-600">
            No closed trades yet. When the autopilot sells a position, the outcome gets compared
            against the thesis recorded at purchase and the verdict lands here automatically.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {postMortems.map(m => (
              <div key={m.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-base font-bold text-zinc-100">{m.ticker}</span>
                    <ModeBadge mode={m.entryMode} />
                    <VerdictBadge verdict={m.verdict} />
                  </div>
                  <div className="flex items-center gap-3 text-xs font-mono">
                    <span className={cn('text-sm font-bold', m.returnPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {m.returnPct >= 0 ? '+' : ''}{m.returnPct.toFixed(1)}%
                    </span>
                    <span className="text-zinc-600">{m.holdingDays}d held</span>
                    <span className="text-zinc-700">{new Date(m.closedAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <p className="mt-2.5 text-sm leading-relaxed text-zinc-300">{m.lessons}</p>

                <div className="mt-2.5 flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs text-zinc-600">
                    Sold because: <span className="text-zinc-500">{m.closeReason}</span>
                  </span>
                  {m.thesisAtPurchase.length > 0 && (
                    <button
                      onClick={() => setExpandedThesis(expandedThesis === m.id ? null : m.id)}
                      className="text-xs text-violet-400 hover:text-violet-300"
                    >
                      {expandedThesis === m.id ? 'hide original thesis' : 'show original thesis'}
                    </button>
                  )}
                </div>

                {expandedThesis === m.id && (
                  <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-1">
                    <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-600 mb-1.5">
                      Thesis recorded at purchase ({new Date(m.openedAt).toLocaleDateString()})
                    </div>
                    {m.thesisAtPurchase.map((line, i) => (
                      <p key={i} className="text-xs leading-relaxed text-zinc-500 font-mono">· {line}</p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
