'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useMobileMenu } from '@/contexts/MobileMenu'
import { useTradingMode } from '@/contexts/TradingMode'

const NAV = [
  { href: '/',            label: 'Dashboard',        icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { href: '/autopilot',   label: 'Autopilot',         icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { href: '/screener',    label: 'Graham Screener',   icon: 'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z' },
  { href: '/analysis',    label: 'Stock Analysis',    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { href: '/watchlist',   label: 'Watchlist',         icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z' },
  { href: '/portfolio',   label: 'Portfolio',         icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
  { href: '/performance', label: 'Performance',       icon: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z' },
  { href: '/philosophy',  label: 'Philosophy Engine', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
  { href: '/settings',    label: 'Settings',          icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
]

const BOTTOM_TABS = [
  { href: '/',          label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { href: '/autopilot', label: 'Autopilot', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { href: '/portfolio', label: 'Portfolio', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
  { href: '/watchlist', label: 'Watchlist', icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z' },
]

export function MobileNav() {
  const pathname = usePathname()
  const { isOpen, open, close } = useMobileMenu()
  const { mode, setMode } = useTradingMode()

  // Close drawer on route change
  useEffect(() => {
    close()
  }, [pathname, close])

  return (
    <>
      {/* ── Overlay backdrop ─────────────────────────────────────────── */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      {/* ── Slide-in drawer ──────────────────────────────────────────── */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-72 flex flex-col bg-zinc-950 border-r border-zinc-800/80 transition-transform duration-300 md:hidden',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 pt-6 pb-5 border-b border-zinc-800/80">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 shadow-lg shadow-violet-900/40">
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-white">
                <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <div className="text-xs font-bold tracking-[0.15em] text-zinc-100 uppercase">Rival</div>
              <div className="text-[10px] tracking-[0.12em] text-zinc-500 uppercase -mt-0.5">Automations</div>
            </div>
          </div>
          <button
            onClick={close}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300 transition-colors"
            aria-label="Close menu"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mode toggle */}
        <div className="px-4 py-3 border-b border-zinc-800/80">
          <div className="mb-1.5">
            <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-600">Trading Mode</span>
          </div>
          <div className="flex rounded-lg bg-zinc-900 p-0.5 border border-zinc-800">
            <button
              onClick={() => setMode('paper')}
              className={cn(
                'flex-1 rounded-md py-1.5 text-[11px] font-semibold tracking-wide transition-all',
                mode === 'paper'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'text-zinc-600 hover:text-zinc-400'
              )}
            >
              PAPER
            </button>
            <button
              onClick={() => setMode('live')}
              className={cn(
                'flex-1 rounded-md py-1.5 text-[11px] font-semibold tracking-wide transition-all',
                mode === 'live'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'text-zinc-600 hover:text-zinc-400'
              )}
            >
              LIVE
            </button>
          </div>
          {mode === 'paper' && (
            <p className="mt-1.5 text-[10px] text-amber-600/80">Simulated trades only — no real money</p>
          )}
          {mode === 'live' && (
            <p className="mt-1.5 text-[10px] text-emerald-600/80">Connected to Schwab brokerage</p>
          )}
        </div>

        {/* Navigation links */}
        <nav className="flex flex-col gap-0.5 px-2 py-3 flex-1 overflow-y-auto">
          {NAV.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all',
                  isActive
                    ? 'bg-violet-600/15 text-zinc-100 border border-violet-600/20'
                    : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'
                )}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={isActive ? 2 : 1.5}
                  className={cn('h-4 w-4 shrink-0', isActive ? 'text-violet-400' : 'text-zinc-600 group-hover:text-zinc-400')}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                <span className="flex-1 text-[13px]">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Risk Parameters */}
        <div className="px-4 py-3 border-t border-zinc-800/80">
          <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-600 mb-2">Risk Parameters</div>
          <div className="space-y-1.5">
            {[
              { label: 'Min Phil. Score', value: '55 / 100' },
              { label: 'Min Margin of Safety', value: '30%' },
              { label: 'Max Position Size', value: '10%' },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-600">{label}</span>
                <span className="text-[11px] font-mono text-zinc-400">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bottom tab bar ───────────────────────────────────────────── */}
      <nav
        className="fixed bottom-0 inset-x-0 z-30 flex border-t border-zinc-800/80 bg-zinc-950 md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {BOTTOM_TABS.map((tab) => {
          const isActive = pathname === tab.href || (tab.href !== '/' && pathname.startsWith(tab.href))
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={isActive ? 2 : 1.5}
                className={cn('h-5 w-5', isActive ? 'text-violet-400' : 'text-zinc-600')}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
              </svg>
              <span className={cn('text-[10px] font-medium', isActive ? 'text-violet-400' : 'text-zinc-600')}>
                {tab.label}
              </span>
            </Link>
          )
        })}
        {/* More button */}
        <button
          onClick={open}
          className="flex flex-1 flex-col items-center justify-center gap-1 py-2 text-zinc-600 transition-colors hover:text-zinc-400"
          aria-label="Open menu"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>
    </>
  )
}
