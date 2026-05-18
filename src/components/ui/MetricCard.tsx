import { cn } from '@/lib/utils'

interface MetricCardProps {
  label: string
  value: string | number | undefined
  subValue?: string
  good?: boolean | null
  description?: string
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

export function MetricCard({
  label,
  value,
  subValue,
  good,
  description,
  className,
  size = 'md',
}: MetricCardProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded border border-zinc-800 bg-zinc-900 p-4',
        className
      )}
    >
      <span className="text-xs font-medium uppercase tracking-widest text-zinc-500">{label}</span>
      <span
        className={cn(
          'font-mono font-semibold tabular-nums',
          size === 'lg' && 'text-2xl',
          size === 'md' && 'text-xl',
          size === 'sm' && 'text-base',
          good === true && 'text-emerald-400',
          good === false && 'text-red-400',
          good === null || good === undefined ? 'text-zinc-100' : ''
        )}
      >
        {value ?? '—'}
      </span>
      {subValue && <span className="text-xs text-zinc-500">{subValue}</span>}
      {description && <span className="mt-1 text-xs text-zinc-600">{description}</span>}
    </div>
  )
}
