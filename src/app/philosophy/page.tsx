'use client'

import { useState, useMemo } from 'react'
import {
  ALL_PRINCIPLES,
  SELL_PRINCIPLES,
  SOURCE_LABELS,
  CATEGORY_LABELS,
  type Source,
  type Category,
  type Principle,
} from '@/lib/philosophy/principles'
import { cn } from '@/lib/utils'

const SOURCES: Source[] = [
  'intelligent_investor', 'security_analysis', 'buffett_letter', 'buffett_essay', 'phil_fisher',
  'greenblatt', 'munger', 'peter_lynch', 'klarman', 'howard_marks',
  'walter_schloss', 'templeton', 'pabrai', 'dreman', 'academic',
]
const CATEGORIES: Category[] = [
  'margin_of_safety', 'valuation', 'earnings_power', 'balance_sheet',
  'moat', 'business_quality', 'management', 'capital_allocation',
  'market_behaviour', 'risk', 'sell_discipline', 'position_sizing', 'temperament',
]

const SOURCE_COLORS: Record<Source, string> = {
  intelligent_investor: 'border-blue-800 bg-blue-900/20 text-blue-400',
  security_analysis:    'border-violet-800 bg-violet-900/20 text-violet-400',
  buffett_letter:       'border-amber-800 bg-amber-900/20 text-amber-400',
  buffett_essay:        'border-emerald-800 bg-emerald-900/20 text-emerald-400',
  phil_fisher:          'border-rose-800 bg-rose-900/20 text-rose-400',
  greenblatt:           'border-cyan-800 bg-cyan-900/20 text-cyan-400',
  munger:               'border-orange-800 bg-orange-900/20 text-orange-400',
  peter_lynch:          'border-lime-800 bg-lime-900/20 text-lime-400',
  klarman:              'border-red-800 bg-red-900/20 text-red-400',
  howard_marks:         'border-sky-800 bg-sky-900/20 text-sky-400',
  walter_schloss:       'border-teal-800 bg-teal-900/20 text-teal-400',
  templeton:            'border-yellow-800 bg-yellow-900/20 text-yellow-400',
  pabrai:               'border-pink-800 bg-pink-900/20 text-pink-400',
  dreman:               'border-indigo-800 bg-indigo-900/20 text-indigo-400',
  academic:             'border-slate-600 bg-slate-800/40 text-slate-300',
}

const CATEGORY_COLORS: Record<Category, string> = {
  margin_of_safety: 'bg-emerald-900/40 text-emerald-400',
  valuation: 'bg-blue-900/40 text-blue-400',
  earnings_power: 'bg-cyan-900/40 text-cyan-400',
  balance_sheet: 'bg-indigo-900/40 text-indigo-400',
  moat: 'bg-amber-900/40 text-amber-400',
  business_quality: 'bg-yellow-900/40 text-yellow-400',
  management: 'bg-orange-900/40 text-orange-400',
  capital_allocation: 'bg-pink-900/40 text-pink-400',
  market_behaviour: 'bg-red-900/40 text-red-400',
  risk: 'bg-rose-900/40 text-rose-400',
  sell_discipline: 'bg-zinc-700/60 text-zinc-300',
  position_sizing: 'bg-teal-900/40 text-teal-400',
  temperament: 'bg-purple-900/40 text-purple-400',
}

const ALL = [...ALL_PRINCIPLES, ...SELL_PRINCIPLES]

export default function PhilosophyPage() {
  const [activeSource, setActiveSource] = useState<Source | 'all'>('all')
  const [activeCategory, setActiveCategory] = useState<Category | 'all'>('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const filtered = useMemo(() => {
    return ALL.filter((p) => {
      if (activeSource !== 'all' && p.source !== activeSource) return false
      if (activeCategory !== 'all' && p.category !== activeCategory) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        return (
          p.title.toLowerCase().includes(q) ||
          p.rule.toLowerCase().includes(q) ||
          p.category.includes(q)
        )
      }
      return true
    })
  }, [activeSource, activeCategory, search])

  const bySource = SOURCES.map((s) => ({
    source: s,
    count: ALL.filter((p) => p.source === s).length,
  }))

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Philosophy Engine</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          130+ active principles from 14 sources — the brain behind every trade.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total Principles', value: ALL.length, color: 'text-violet-400' },
          { label: 'Hard Vetoes (weight 9–10)', value: ALL.filter(p => p.weight >= 9).length, color: 'text-red-400' },
          { label: 'Buy Signals', value: ALL.filter(p => p.appliesTo.includes('buy')).length, color: 'text-emerald-400' },
          { label: 'Sell Triggers', value: ALL.filter(p => p.appliesTo.includes('sell')).length, color: 'text-amber-400' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className={cn('text-2xl font-bold tabular-nums', s.color)}>{s.value}</div>
            <div className="mt-0.5 text-xs text-zinc-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Capital allocation explainer */}
      <div className="rounded-xl border border-amber-900/30 bg-amber-950/15 p-5">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-amber-500">How Capital Is Allocated by Conviction</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-sm">
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-zinc-300">Conviction Gate</div>
            <p className="text-xs text-zinc-500 leading-relaxed">Only <span className="text-emerald-400 font-semibold">Strong Buy</span> (score ≥75, MOS ≥30%, Graham pass) and <span className="text-emerald-400 font-semibold">Buy</span> (score ≥60, MOS ≥30%) trigger capital deployment. All other signals wait.</p>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-zinc-300">Sizing Formula</div>
            <div className="text-xs text-zinc-500 space-y-0.5">
              <div className="flex justify-between"><span>Strong Buy base</span><span className="font-mono text-zinc-300">12% of capital</span></div>
              <div className="flex justify-between"><span>Buy base</span><span className="font-mono text-zinc-300">7% of capital</span></div>
              <div className="flex justify-between"><span>MOS ≥50% boost</span><span className="font-mono text-emerald-400">+30%</span></div>
              <div className="flex justify-between"><span>Score ≥80 boost</span><span className="font-mono text-emerald-400">+15%</span></div>
              <div className="flex justify-between"><span>Portfolio crowding</span><span className="font-mono text-red-400">−15–30%</span></div>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-zinc-300">Hard Caps</div>
            <p className="text-xs text-zinc-500 leading-relaxed">No single position exceeds <span className="text-red-400">maxPositionPct</span> of total capital. Portfolio capped at <span className="text-red-400">maxPositions</span> open slots — Buffett's punch-card principle. Configure both in Settings.</p>
          </div>
        </div>
      </div>

      {/* Source totals */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
        {bySource.map(({ source, count }) => (
          <button
            key={source}
            onClick={() => setActiveSource(activeSource === source ? 'all' : source)}
            className={cn(
              'rounded-xl border p-3 text-left transition-all',
              activeSource === source
                ? SOURCE_COLORS[source]
                : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
            )}
          >
            <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 leading-tight mb-1">
              {SOURCE_LABELS[source].split('(')[0].trim()}
            </div>
            <div className="text-xl font-bold font-mono text-zinc-100">{count}</div>
            <div className="mt-0.5 text-[10px] text-zinc-700">principles</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search principles…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
        />
        <button
          onClick={() => { setActiveSource('all'); setActiveCategory('all'); setSearch('') }}
          className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300"
        >
          Clear filters
        </button>
        <span className="ml-auto self-center text-xs text-zinc-600">
          {filtered.length} of {ALL.length} principles
        </span>
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveCategory('all')}
          className={cn(
            'rounded-full px-3 py-0.5 text-xs transition-colors',
            activeCategory === 'all' ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300'
          )}
        >
          All categories
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(activeCategory === cat ? 'all' : cat)}
            className={cn(
              'rounded-full px-3 py-0.5 text-xs transition-colors',
              activeCategory === cat
                ? CATEGORY_COLORS[cat]
                : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300'
            )}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Principles list */}
      <div className="flex flex-col divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800">
        {filtered.length === 0 && (
          <div className="flex h-24 items-center justify-center text-sm text-zinc-600">
            No principles match this filter.
          </div>
        )}
        {filtered.map((principle) => (
          <PrincipleRow
            key={principle.id}
            principle={principle}
            expanded={expanded === principle.id}
            onToggle={() => setExpanded(expanded === principle.id ? null : principle.id)}
          />
        ))}
      </div>
    </div>
  )
}

function PrincipleRow({
  principle,
  expanded,
  onToggle,
}: {
  principle: Principle
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div
      className={cn('cursor-pointer bg-zinc-900 hover:bg-zinc-800/60 transition-colors', expanded && 'bg-zinc-800/40')}
      onClick={onToggle}
    >
      <div className="flex items-start gap-4 px-5 py-4">
        {/* Weight indicator */}
        <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
          <div
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full font-mono text-sm font-bold',
              principle.weight >= 9 ? 'bg-emerald-900 text-emerald-400'
                : principle.weight >= 7 ? 'bg-yellow-900 text-yellow-400'
                : 'bg-zinc-800 text-zinc-400'
            )}
          >
            {principle.weight}
          </div>
          <span className="text-xs text-zinc-700">wt</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-zinc-100">{principle.title}</span>
            <span className={cn('rounded px-1.5 py-0.5 text-xs', CATEGORY_COLORS[principle.category])}>
              {CATEGORY_LABELS[principle.category]}
            </span>
            <span className={cn('rounded border px-1.5 py-0.5 text-xs', SOURCE_COLORS[principle.source])}>
              {principle.chapter
                ? `${SOURCE_LABELS[principle.source]} — ${principle.chapter}`
                : principle.year
                ? `Buffett Letter ${principle.year}`
                : SOURCE_LABELS[principle.source]}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            {principle.appliesTo.map((a) => (
              <span key={a} className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500">
                {a.toUpperCase()}
              </span>
            ))}
          </div>

          {expanded && (
            <p className="mt-3 text-sm leading-relaxed text-zinc-400 border-l-2 border-zinc-700 pl-4">
              {principle.rule}
            </p>
          )}
        </div>

        <span className="shrink-0 text-zinc-700 text-sm">{expanded ? '▲' : '▼'}</span>
      </div>
    </div>
  )
}
