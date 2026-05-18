import { cn } from '@/lib/utils'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'danger' | 'warning' | 'neutral'
  className?: string
}

const variants = {
  default: 'bg-zinc-800 text-zinc-300',
  success: 'bg-emerald-900/60 text-emerald-400 border border-emerald-800',
  danger: 'bg-red-900/60 text-red-400 border border-red-800',
  warning: 'bg-yellow-900/60 text-yellow-400 border border-yellow-800',
  neutral: 'bg-zinc-800 text-zinc-400',
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium',
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
