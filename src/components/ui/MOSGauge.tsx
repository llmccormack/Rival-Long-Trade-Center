'use client'

import { cn, mosColor, mosLabel } from '@/lib/utils'

interface MOSGaugeProps {
  marginOfSafety: number
  intrinsicValue: number
  currentPrice: number
  size?: 'sm' | 'lg'
}

export function MOSGauge({ marginOfSafety, intrinsicValue, currentPrice, size = 'lg' }: MOSGaugeProps) {
  // Clamp to -50% → +80% for display
  const clamped = Math.max(-50, Math.min(80, marginOfSafety))
  const pct = ((clamped + 50) / 130) * 100

  return (
    <div className={cn('rounded border border-zinc-800 bg-zinc-900', size === 'lg' ? 'p-6' : 'p-3')}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          Margin of Safety
        </span>
        <span
          className={cn(
            'rounded px-2 py-0.5 text-xs font-medium',
            marginOfSafety >= 30
              ? 'bg-emerald-900/60 text-emerald-400'
              : marginOfSafety >= 0
              ? 'bg-yellow-900/60 text-yellow-400'
              : 'bg-red-900/60 text-red-400'
          )}
        >
          {mosLabel(marginOfSafety)}
        </span>
      </div>

      <div className={cn('font-mono font-bold tabular-nums', mosColor(marginOfSafety), size === 'lg' ? 'text-4xl' : 'text-xl')}>
        {marginOfSafety >= 0 ? '+' : ''}{marginOfSafety.toFixed(1)}%
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            marginOfSafety >= 30 ? 'bg-emerald-500' : marginOfSafety >= 0 ? 'bg-yellow-500' : 'bg-red-500'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {size === 'lg' && (
        <div className="mt-3 flex justify-between text-xs text-zinc-600">
          <span>Intrinsic: ${intrinsicValue.toFixed(2)}</span>
          <span>Price: ${currentPrice.toFixed(2)}</span>
        </div>
      )}
    </div>
  )
}
