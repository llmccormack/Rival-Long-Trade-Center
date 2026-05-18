'use client'

import { useState, useEffect } from 'react'

interface MacroContext {
  available: boolean
  sp500Cape?: number
  treasury10yr?: number
  treasury10yrPct?: number
  marketTemperature?: 'cold' | 'fair' | 'warm' | 'hot' | 'extreme'
  excessEarningsYieldPct?: number
  cashReserveAdj?: number
  minScoreAdj?: number
  fetchedAt?: string
  interpretation?: string
  reason?: string
}

const TEMP_CONFIG = {
  cold:    { label: 'COLD',    color: 'text-sky-300',    border: 'border-sky-800/50',    bg: 'bg-sky-900/15',    dot: 'bg-sky-400',    bar: 'bg-sky-500' },
  fair:    { label: 'FAIR',    color: 'text-emerald-400', border: 'border-emerald-800/50', bg: 'bg-emerald-900/15', dot: 'bg-emerald-400', bar: 'bg-emerald-500' },
  warm:    { label: 'WARM',    color: 'text-amber-400',  border: 'border-amber-800/50',  bg: 'bg-amber-900/15',  dot: 'bg-amber-400',  bar: 'bg-amber-500' },
  hot:     { label: 'HOT',     color: 'text-orange-400', border: 'border-orange-800/50', bg: 'bg-orange-900/15', dot: 'bg-orange-400', bar: 'bg-orange-500' },
  extreme: { label: 'EXTREME', color: 'text-red-400',    border: 'border-red-800/50',    bg: 'bg-red-900/15',    dot: 'bg-red-400',    bar: 'bg-red-500' },
}

// CAPE scale: 0→cold(<15), 15→fair, 20→warm, 25→hot, 33→extreme, 40+→max
function capeToBarPct(cape: number): number {
  return Math.min(100, Math.max(0, (cape / 40) * 100))
}

export function MarketTemperatureWidget() {
  const [ctx, setCtx] = useState<MacroContext | null>(null)

  useEffect(() => {
    fetch('/api/macro/context').then(r => r.json()).then(setCtx).catch(() => null)
  }, [])

  if (!ctx) {
    return (
      <div className="h-28 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900" />
    )
  }

  if (!ctx.available) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
        <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-600 mb-1">Market Temperature</div>
        <p className="text-xs text-zinc-600">{ctx.reason}</p>
      </div>
    )
  }

  const temp = ctx.marketTemperature!
  const cfg = TEMP_CONFIG[temp]
  const barPct = capeToBarPct(ctx.sp500Cape!)

  return (
    <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-4`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-500 mb-1">
            S&amp;P 500 Market Temperature
          </div>
          <div className="flex items-center gap-2">
            <span className={`relative flex h-2 w-2 shrink-0`}>
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.dot} opacity-75`} />
              <span className={`relative inline-flex h-2 w-2 rounded-full ${cfg.dot}`} />
            </span>
            <span className={`text-lg font-bold font-mono tracking-wider ${cfg.color}`}>{cfg.label}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-zinc-600">Shiller CAPE</div>
          <div className={`text-2xl font-mono font-bold tabular-nums ${cfg.color}`}>
            {ctx.sp500Cape?.toFixed(1)}×
          </div>
        </div>
      </div>

      {/* CAPE bar */}
      <div className="relative mb-3">
        <div className="h-1.5 w-full rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all ${cfg.bar}`}
            style={{ width: `${barPct}%` }}
          />
        </div>
        {/* Zone markers */}
        <div className="flex justify-between mt-1 text-[9px] text-zinc-700 font-mono">
          <span>15</span><span>20</span><span>25</span><span>33</span><span>40+</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <div className="text-[10px] text-zinc-600">10Y Treasury</div>
          <div className="font-mono font-semibold text-zinc-300">{ctx.treasury10yrPct?.toFixed(2)}%</div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-600">Excess Earn. Yield</div>
          <div className={`font-mono font-semibold ${(ctx.excessEarningsYieldPct ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {(ctx.excessEarningsYieldPct ?? 0) > 0 ? '+' : ''}{ctx.excessEarningsYieldPct?.toFixed(2)}%
          </div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-600">Autopilot Adj.</div>
          <div className={`font-mono font-semibold ${(ctx.cashReserveAdj ?? 0) > 0 ? 'text-amber-400' : 'text-sky-400'}`}>
            {(ctx.cashReserveAdj ?? 0) > 0 ? '+' : ''}{ctx.cashReserveAdj}% cash
          </div>
        </div>
      </div>

      {ctx.interpretation && (
        <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed border-t border-zinc-800/60 pt-2">
          {ctx.interpretation}
        </p>
      )}
    </div>
  )
}
