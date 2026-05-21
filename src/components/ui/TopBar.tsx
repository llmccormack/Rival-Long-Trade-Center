'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTradingMode } from '@/contexts/TradingMode'
import { useMobileMenu } from '@/contexts/MobileMenu'
import { cn } from '@/lib/utils'

const LABELS: Record<string, string> = {
  '/': 'Dashboard',
  '/autopilot': 'Autopilot',
  '/screener': 'Graham Screener',
  '/analysis': 'Stock Analysis',
  '/watchlist': 'Watchlist',
  '/portfolio': 'Portfolio',
  '/philosophy': 'Philosophy Engine',
}

function getLabel(pathname: string) {
  if (pathname.startsWith('/analysis/')) return 'Stock Analysis'
  return LABELS[pathname] ?? pathname.replace('/', '')
}

export function TopBar() {
  const pathname = usePathname()
  const router = useRouter()
  const { isPaper } = useTradingMode()
  const { open } = useMobileMenu()
  const [query, setQuery] = useState('')

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const t = query.trim().toUpperCase()
    if (t) {
      router.push(`/analysis/${t}`)
      setQuery('')
    }
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-4 border-b border-zinc-800/80 bg-zinc-950/80 px-6 backdrop-blur-sm">

      {/* Hamburger — mobile only */}
      <button onClick={open} className="mr-2 rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300 md:hidden" aria-label="Open menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-600">
          Rival Automations
        </span>
        <span className="text-zinc-800">/</span>
        <span className="text-sm font-medium text-zinc-300 truncate">
          {getLabel(pathname)}
        </span>
      </div>

      {/* Paper mode banner */}
      {isPaper && (
        <div className="flex items-center gap-1.5 rounded-full border border-amber-800/50 bg-amber-900/20 px-3 py-0.5">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          <span className="text-[11px] font-medium text-amber-400 tracking-wide">PAPER TRADING</span>
        </div>
      )}
      {!isPaper && (
        <div className="flex items-center gap-1.5 rounded-full border border-emerald-800/50 bg-emerald-900/20 px-3 py-0.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          <span className="text-[11px] font-medium text-emerald-400 tracking-wide">LIVE TRADING</span>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Quick ticker search */}
      <form onSubmit={handleSearch} className="relative hidden md:block">
        <input
          type="text"
          placeholder="Quick analysis… (e.g. KO)"
          value={query}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          className="w-52 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-700 focus:border-violet-700 focus:outline-none focus:ring-1 focus:ring-violet-700/30 transition-colors"
        />
        <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-[9px] text-zinc-600">
          ↵
        </kbd>
      </form>

      {/* Schwab status */}
      <div className={cn(
        'hidden md:flex items-center gap-1.5 text-[11px]',
        isPaper ? 'text-zinc-600' : 'text-zinc-500'
      )}>
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
        </svg>
        <span>Schwab</span>
        <span className={cn('h-1.5 w-1.5 rounded-full', isPaper ? 'bg-zinc-700' : 'bg-emerald-500')} />
      </div>
    </div>
  )
}
