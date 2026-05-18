export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { prisma } from '@/lib/db/client'
import { AlertsFeed } from '@/components/dashboard/AlertsFeed'
import { PositionsTable } from '@/components/portfolio/PositionsTable'
import { formatCurrency } from '@/lib/utils'
import Link from 'next/link'

async function getDashboardData() {
  let portfolioItems: any[] = []
  let watchlistCount = 0, alertCount = 0, screenPasses = 0

  try {
    ;[portfolioItems, watchlistCount, alertCount, screenPasses] = await Promise.all([
      prisma.portfolioItem.findMany({
        include: {
          stock: {
            include: { intrinsicValues: { orderBy: { calculatedAt: 'desc' }, take: 1 } },
          },
        },
      }),
      prisma.watchlistItem.count({ where: { isActive: true } }),
      prisma.alert.count({ where: { isRead: false } }),
      prisma.screenResult.count({ where: { overallPass: true } }),
    ])
  } catch {
    // DB not connected — render empty state
  }

  const positions = portfolioItems.map((h) => {
    const iv = h.stock.intrinsicValues[0]
    const val = h.shares * h.avgCostBasis
    return {
      id: h.id, ticker: h.stock.ticker, name: h.stock.name, shares: h.shares,
      avgCostBasis: h.avgCostBasis, currentPrice: h.avgCostBasis,
      currentValue: val, costBasis: val, gainLoss: 0, gainLossPct: 0,
      intrinsicValue: iv?.intrinsicValue, marginOfSafety: iv?.marginOfSafety,
      firstPurchased: h.firstPurchased,
    }
  })

  return { positions, watchlistCount, alertCount, screenPasses }
}

const STAT_NAV = [
  { href: '/portfolio',  label: 'Portfolio Value',        key: 'value',    suffix: '' },
  { href: '/portfolio',  label: 'Holdings',               key: 'positions', suffix: '' },
  { href: '/watchlist',  label: 'On Watchlist',           key: 'watchlist', suffix: '' },
  { href: '/screener',   label: 'Graham Passes',          key: 'screen',    suffix: '' },
]

export default async function DashboardPage() {
  const { positions, watchlistCount, alertCount, screenPasses } = await getDashboardData()

  const totalValue = positions.reduce((s, p) => s + p.currentValue, 0)
  const avgMOS = positions.filter(p => p.marginOfSafety != null).length > 0
    ? positions.reduce((s, p) => s + (p.marginOfSafety ?? 0), 0) / positions.filter(p => p.marginOfSafety != null).length
    : null

  const stats = [
    { label: 'Portfolio Value', value: totalValue > 0 ? formatCurrency(totalValue) : '—', sub: 'at cost basis', href: '/portfolio', good: totalValue > 0 },
    { label: 'Active Holdings', value: positions.length || '—', sub: 'max 30 positions', href: '/portfolio' },
    { label: 'Avg Margin of Safety', value: avgMOS != null ? `${avgMOS.toFixed(1)}%` : '—', sub: avgMOS != null && avgMOS >= 30 ? 'Above threshold ✓' : 'Below 30% threshold', href: '/portfolio', good: avgMOS != null ? avgMOS >= 30 : undefined },
    { label: 'Graham Passes', value: screenPasses || '—', sub: 'all 7 criteria met', href: '/screener' },
    { label: 'Watchlist', value: watchlistCount || '—', sub: 'waiting for price', href: '/watchlist' },
    { label: 'Unread Alerts', value: alertCount || '—', sub: 'review recommended', href: '/portfolio', bad: alertCount > 0 },
  ]

  return (
    <div className="flex flex-col gap-6 p-6">

      {/* Welcome bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Overview</h1>
          <p className="text-xs text-zinc-600 mt-0.5">
            Systematic value investing — Graham grounded, Buffett refined, Fisher completed.
          </p>
        </div>
        <Link
          href="/autopilot"
          className="flex items-center gap-2 rounded-lg border border-emerald-800/50 bg-emerald-900/20 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-900/30 transition-colors"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          Autopilot Active
        </Link>
      </div>

      {/* Philosophy quote */}
      <blockquote className="rounded-xl border border-zinc-800/60 bg-gradient-to-r from-violet-950/20 to-zinc-900/40 px-5 py-3">
        <p className="text-xs italic text-zinc-500">
          "The investor&apos;s chief problem — and even his worst enemy — is likely to be himself."
          <span className="ml-1 not-italic text-zinc-600">— Benjamin Graham, The Intelligent Investor</span>
        </p>
      </blockquote>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {stats.map(({ label, value, sub, href, good, bad }) => (
          <Link key={label} href={href} className="group rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 hover:border-zinc-700 transition-all">
            <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-600">{label}</div>
            <div className={`mt-1.5 font-mono text-2xl font-bold tabular-nums transition-colors
              ${good === true ? 'text-emerald-400' : bad ? 'text-amber-400' : 'text-zinc-100'}`}>
              {value}
            </div>
            <div className="mt-0.5 text-xs text-zinc-600 group-hover:text-zinc-500 transition-colors">{sub}</div>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          href="/screener"
          className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 hover:border-violet-800/50 hover:bg-violet-900/10 transition-all group"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-900/40 border border-violet-800/30 group-hover:bg-violet-800/40 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4 text-violet-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-medium text-zinc-300 group-hover:text-zinc-100 transition-colors">Run Graham Screen</div>
            <div className="text-xs text-zinc-600">7-criteria Chapter 14 filter</div>
          </div>
        </Link>

        <Link
          href="/analysis"
          className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 hover:border-emerald-800/50 hover:bg-emerald-900/10 transition-all group"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-900/40 border border-emerald-800/30 group-hover:bg-emerald-800/40 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4 text-emerald-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-medium text-zinc-300 group-hover:text-zinc-100 transition-colors">Analyse a Stock</div>
            <div className="text-xs text-zinc-600">Full intrinsic value + audit</div>
          </div>
        </Link>

        <Link
          href="/philosophy"
          className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 hover:border-amber-800/50 hover:bg-amber-900/10 transition-all group"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-900/40 border border-amber-800/30 group-hover:bg-amber-800/40 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4 text-amber-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-medium text-zinc-300 group-hover:text-zinc-100 transition-colors">Philosophy Library</div>
            <div className="text-xs text-zinc-600">241 active principles</div>
          </div>
        </Link>
      </div>

      {/* Holdings + Alerts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">Current Holdings</h2>
            <Link href="/portfolio" className="text-[11px] text-zinc-600 hover:text-violet-400 transition-colors">
              View portfolio →
            </Link>
          </div>
          <PositionsTable positions={positions} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">Recent Alerts</h2>
            {alertCount > 0 && (
              <span className="rounded-full bg-amber-900/50 border border-amber-800/50 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                {alertCount} unread
              </span>
            )}
          </div>
          <Suspense fallback={<div className="h-48 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900" />}>
            <AlertsFeed />
          </Suspense>
        </div>
      </div>

      {/* Philosophy snapshot */}
      <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/60 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">Philosophy Engine</h2>
          <Link href="/philosophy" className="text-[11px] text-zinc-600 hover:text-violet-400 transition-colors">
            View all 241 principles →
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {[
            { source: 'Intell. Investor', count: 38, color: 'text-blue-400', bg: 'bg-blue-900/20', border: 'border-blue-900/40' },
            { source: 'Security Analysis', count: 21, color: 'text-violet-400', bg: 'bg-violet-900/20', border: 'border-violet-900/40' },
            { source: 'Buffett Letters', count: 56, color: 'text-amber-400', bg: 'bg-amber-900/20', border: 'border-amber-900/40' },
            { source: 'Sell Discipline', count: 10, color: 'text-emerald-400', bg: 'bg-emerald-900/20', border: 'border-emerald-900/40' },
            { source: 'Phil Fisher', count: 12, color: 'text-rose-400', bg: 'bg-rose-900/20', border: 'border-rose-900/40' },
            { source: 'Greenblatt', count: 15, color: 'text-cyan-400', bg: 'bg-cyan-900/20', border: 'border-cyan-900/40' },
            { source: 'Munger', count: 15, color: 'text-orange-400', bg: 'bg-orange-900/20', border: 'border-orange-900/40' },
            { source: 'Lynch', count: 13, color: 'text-lime-400', bg: 'bg-lime-900/20', border: 'border-lime-900/40' },
            { source: 'Klarman', count: 11, color: 'text-red-400', bg: 'bg-red-900/20', border: 'border-red-900/40' },
            { source: 'H. Marks', count: 13, color: 'text-sky-400', bg: 'bg-sky-900/20', border: 'border-sky-900/40' },
            { source: 'Schloss', count: 10, color: 'text-teal-400', bg: 'bg-teal-900/20', border: 'border-teal-900/40' },
            { source: 'Templeton', count: 8, color: 'text-yellow-400', bg: 'bg-yellow-900/20', border: 'border-yellow-900/40' },
            { source: 'Pabrai', count: 8, color: 'text-pink-400', bg: 'bg-pink-900/20', border: 'border-pink-900/40' },
            { source: 'Dreman', count: 10, color: 'text-indigo-400', bg: 'bg-indigo-900/20', border: 'border-indigo-900/40' },
          ].map(({ source, count, color, bg, border }) => (
            <div key={source} className={`rounded-lg border ${border} ${bg} p-3`}>
              <div className={`text-lg font-mono font-bold tabular-nums ${color}`}>{count}</div>
              <div className="text-[10px] text-zinc-600 mt-0.5 leading-tight">{source}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
