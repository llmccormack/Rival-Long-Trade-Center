'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useTradingMode } from '@/contexts/TradingMode'

const NAV = [
  {
    href: '/',
    label: 'Dashboard',
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  },
  {
    href: '/autopilot',
    label: 'Autopilot',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    pulse: true,
  },
  {
    href: '/screener',
    label: 'Screener',
    icon: 'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z',
  },
  {
    href: '/analysis',
    label: 'Analysis',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  },
  {
    href: '/portfolio',
    label: 'Portfolio',
    icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  },
  {
    href: '/chat',
    label: 'AI Analyst',
    icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  },
]

const SECONDARY = [
  {
    href: '/performance',
    label: 'Performance',
    icon: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z',
  },
  {
    href: '/journal',
    label: 'Journal',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  },
  {
    href: '/watchlist',
    label: 'Watchlist',
    icon: 'M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z',
  },
  {
    href: '/philosophy',
    label: 'Principles',
    icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  },
]

function NavLink({ item, pathname }: { item: typeof NAV[0]; pathname: string }) {
  const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
  return (
    <Link
      href={item.href}
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all',
        isActive
          ? 'bg-zinc-800 text-zinc-100'
          : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={isActive ? 2 : 1.5}
        className={cn('h-4 w-4 shrink-0 transition-colors', isActive ? 'text-zinc-300' : 'text-zinc-600 group-hover:text-zinc-400')}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
      </svg>
      <span className="flex-1">{item.label}</span>
      {'pulse' in item && item.pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
      )}
    </Link>
  )
}

export function SideNav() {
  const pathname = usePathname()
  const { mode } = useTradingMode()

  return (
    <aside className="hidden md:flex h-screen w-52 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">

      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 py-5 border-b border-zinc-800">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-white">
            <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-semibold text-zinc-100">Graham Capital</div>
          <div className={cn(
            'text-[10px] font-medium uppercase tracking-widest',
            mode === 'paper' ? 'text-amber-500' : 'text-emerald-500'
          )}>
            {mode === 'paper' ? 'Paper' : 'Live'}
          </div>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="flex flex-col gap-0.5 p-2 pt-3">
        {NAV.map(item => <NavLink key={item.href} item={item} pathname={pathname} />)}
      </nav>

      {/* Divider */}
      <div className="mx-4 my-1 border-t border-zinc-800" />

      {/* Secondary nav */}
      <nav className="flex flex-col gap-0.5 p-2">
        {SECONDARY.map(item => <NavLink key={item.href} item={item} pathname={pathname} />)}
      </nav>

      <div className="flex-1" />
    </aside>
  )
}
