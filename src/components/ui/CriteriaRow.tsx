import { cn } from '@/lib/utils'

interface CriteriaRowProps {
  label: string
  passed: boolean
  value?: string
  threshold?: string
}

export function CriteriaRow({ label, passed, value, threshold }: CriteriaRowProps) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-800 py-2.5 last:border-0">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded-full text-xs',
            passed ? 'bg-emerald-900 text-emerald-400' : 'bg-red-900 text-red-400'
          )}
        >
          {passed ? '✓' : '✗'}
        </span>
        <span className="text-sm text-zinc-300">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        {value && (
          <span
            className={cn(
              'font-mono text-sm tabular-nums',
              passed ? 'text-emerald-400' : 'text-red-400'
            )}
          >
            {value}
          </span>
        )}
        {threshold && <span className="text-xs text-zinc-600">{threshold}</span>}
      </div>
    </div>
  )
}
