'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTradingMode } from '@/contexts/TradingMode'
import { useMobileMenu } from '@/contexts/MobileMenu'
import { cn } from '@/lib/utils'

export function TopBar() {
  const pathname = usePathname()
  const router = useRouter()
  const { isPaper } = useTradingMode()
  const { open } = useMobileMenu()
  const [query, setQuery] = useState('')

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const t = query.trim().toUpperCase()
    if (t) { router.push(`/analysis/${t}`); setQuery('') }
  }

  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-950 px-4">

      {/* Hamburger — mobile only */}
      <button
        onClick={open}
        className="rounded-md p-1.5 text-zinc-600 hover:text-zinc-400 md:hidden"
        aria-label="Open menu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Mode badge — mobile only (desktop shows in sidenav) */}
      <div className={cn(
        'md:hidden flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest',
        isPaper
          ? 'border-amber-800/50 bg-amber-900/20 text-amber-400'
          : 'border-emerald-800/50 bg-emerald-900/20 text-emerald-400'
      )}>
        {!isPaper && (
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
        )}
        {isPaper ? 'Paper' : 'Live'}
      </div>

      <div className="flex-1" />

      {/* Ticker search */}
      <form onSubmit={handleSearch} className="relative">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600 pointer-events-none">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search ticker…"
          value={query}
          onChange={e => setQuery(e.target.value.toUpperCase())}
          className="w-40 md:w-52 rounded-lg border border-zinc-800 bg-zinc-900 pl-8 pr-3 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-700 focus:border-zinc-600 focus:outline-none transition-colors"
        />
      </form>
    </div>
  )
}
