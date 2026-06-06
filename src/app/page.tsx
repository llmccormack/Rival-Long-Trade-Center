export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { prisma } from '@/lib/db/client'
import { AlertsFeed } from '@/components/dashboard/AlertsFeed'
import { PositionsTable } from '@/components/portfolio/PositionsTable'
import { MarketTemperatureWidget } from '@/components/dashboard/MarketTemperatureWidget'
import { formatCurrency, cn } from '@/lib/utils'
import Link from 'next/link'

async function withTimeout<T>(promise: Promise<T>, fallback: T, ms = 2000): Promise<T> {
  return Promise.race([promise, new Promise<T>(r => setTimeout(() => r(fallback), ms))])
}

async function getDashboardData() {
  let portfolioItems: any[] = []
  let paperPortfolioItems: any[] = []
  let watchlistCount = 0, alertCount = 0, screenPasses = 0
  let autopilotConfig: any = null
  let topOpportunities: any[] = []

  try {
    ;[portfolioItems, paperPortfolioItems, watchlistCount, alertCount, screenPasses, autopilotConfig, topOpportunities] = await Promise.all([
      withTimeout(prisma.portfolioItem.findMany({
        include: {
          stock: {
            include: { intrinsicValues: { orderBy: { calculatedAt: 'desc' }, take: 1 } },
          },
        },
      }), []),
      withTimeout(prisma.paperPortfolioItem.findMany({
        where: { isOpen: true },
        include: { stock: { include: { intrinsicValues: { orderBy: { calculatedAt: 'desc' }, take: 1 } } } },
        take: 10,
      }), []),
      withTimeout(prisma.watchlistItem.count({ where: { isActive: true } }), 0),
      withTimeout(prisma.alert.count({ where: { isRead: false } }), 0),
      withTimeout(prisma.screenResult.count({ where: { overallPass: true } }), 0),
      withTimeout(prisma.autopilotConfig.findUnique({ where: { id: 'singleton' } }), null),
      withTimeout(prisma.watchlistItem.findMany({
        where: { isActive: true, lastScore: { not: null } },
        orderBy: { lastScore: 'desc' },
        take: 8,
        include: {
          stock: {
            include: { intrinsicValues: { take: 1, orderBy: { calculatedAt: 'desc' } } }
          }
        }
      }), []),
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

  const opportunities = topOpportunities.map((item: any) => {
    const iv = item.stock.intrinsicValues?.[0]
    return {
      id: item.id,
      ticker: item.stock.ticker,
      name: item.stock.name,
      lastScore: item.lastScore,
      lastMos: item.lastMos,
      lastAction: item.lastAction,
      lastSkipReason: item.lastSkipReason,
      marginOfSafety: iv?.marginOfSafety,
      isBuySignal: iv?.isBuySignal ?? false,
    }
  })

  const paperPositions = paperPortfolioItems.map((h: any) => {
    const iv = h.stock.intrinsicValues?.[0]
    const currentPrice = iv?.intrinsicValue ? h.avgCostBasis : h.avgCostBasis
    const currentValue = h.shares * h.avgCostBasis
    const gainLossPct = h.entryPrice > 0 ? ((h.avgCostBasis - h.entryPrice) / h.entryPrice) * 100 : 0
    return {
      id: h.id,
      ticker: h.stock.ticker,
      name: h.stock.name,
      shares: h.shares,
      entryPrice: h.entryPrice ?? h.avgCostBasis,
      avgCostBasis: h.avgCostBasis,
      currentPrice: iv?.intrinsicValue ?? h.avgCostBasis,
      currentValue,
      gainLossPct,
    }
  })

  return { positions, paperPositions, watchlistCount, alertCount, screenPasses, autopilotConfig, opportunities }
}

export default async function DashboardPage() {
  const { positions, paperPositions, watchlistCount, alertCount, screenPasses, autopilotConfig, opportunities } = await getDashboardData()

  const totalValue = positions.reduce((s, p) => s + p.currentValue, 0)
  const avgMOS = positions.filter(p => p.marginOfSafety != null).length > 0
    ? positions.reduce((s, p) => s + (p.marginOfSafety ?? 0), 0) / positions.filter(p => p.marginOfSafety != null).length
    : null

  // Status bar data from last autopilot run
  const lastRunResult = autopilotConfig?.lastRunResult as any ?? null
  const lastRunAt = autopilotConfig?.lastRunAt ? new Date(autopilotConfig.lastRunAt) : null
  const marketTemp = lastRunResult?.macro?.marketTemperature as string | undefined
  const openPositions = positions.length
  const dailyRundown = autopilotConfig?.dailyRundown as string | undefined

  const tempColors: Record<string, string> = {
    cold: 'text-sky-400 border-sky-800/50 bg-sky-900/15',
    fair: 'text-emerald-400 border-emerald-800/50 bg-emerald-900/15',
    warm: 'text-amber-400 border-amber-800/50 bg-amber-900/15',
    hot: 'text-orange-400 border-orange-800/50 bg-orange-900/15',
    extreme: 'text-red-400 border-red-800/50 bg-red-900/15',
  }

  const stats = [
    { label: 'Portfolio Value', value: totalValue > 0 ? formatCurrency(totalValue) : '—', sub: 'at cost basis', href: '/portfolio', good: totalValue > 0 },
    { label: 'Active Holdings', value: positions.length || '—', sub: 'max 30 positions', href: '/portfolio' },
    { label: 'Avg Margin of Safety', value: avgMOS != null ? `${avgMOS.toFixed(1)}%` : '—', sub: avgMOS != null && avgMOS >= 30 ? 'Above threshold' : 'Below 30% threshold', href: '/portfolio', good: avgMOS != null ? avgMOS >= 30 : undefined },
    { label: 'Graham Passes', value: screenPasses || '—', sub: 'all 7 criteria met', href: '/screener' },
    { label: 'Watchlist', value: watchlistCount || '—', sub: 'waiting for price', href: '/watchlist' },
    { label: 'Unread Alerts', value: alertCount || '—', sub: 'review recommended', href: '/portfolio', bad: alertCount > 0 },
  ]

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">

      {/* Section 1: Status Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          <Link href="/autopilot" className="text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors">
            Autopilot {autopilotConfig?.isEnabled ? 'Active' : 'Paused'}
          </Link>
        </div>
        <span className="text-zinc-800">|</span>
        {lastRunAt && (
          <>
            <span className="text-xs text-zinc-600">
              Last run: <span className="text-zinc-400">{lastRunAt.toLocaleString()}</span>
            </span>
            <span className="text-zinc-800">|</span>
          </>
        )}
        {marketTemp && (
          <>
            <span className={cn('rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase', tempColors[marketTemp] ?? 'text-zinc-400 border-zinc-700 bg-zinc-900')}>
              Market: {marketTemp}
            </span>
            <span className="text-zinc-800">|</span>
          </>
        )}
        <span className="text-xs text-zinc-600">
          Open positions: <span className="font-mono text-zinc-300">{openPositions}</span>
        </span>
        {lastRunResult?.macro?.effectiveMinScore && (
          <>
            <span className="text-zinc-800">|</span>
            <span className="text-xs text-zinc-600">
              Score gate: <span className="font-mono text-zinc-300">{lastRunResult.macro.effectiveMinScore}</span>
            </span>
          </>
        )}
        <div className="ml-auto flex gap-2">
          <Link href="/watchlist" className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors">Watchlist →</Link>
        </div>
      </div>

      {/* Welcome bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Command Center</h1>
          <p className="text-xs text-zinc-600 mt-0.5">
            Systematic value investing — Graham grounded, Buffett refined, Fisher completed.
          </p>
        </div>
        <Link
          href="/autopilot"
          className="flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 px-5 py-2 text-sm font-semibold text-white transition-all shadow-lg shadow-violet-900/30"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
          </svg>
          Full Auto Run
        </Link>
      </div>

      {/* Section 2: Top Opportunities */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">Top Opportunities</h2>
          {opportunities.length > 0 && (
            <Link href="/watchlist" className="text-[11px] text-zinc-600 hover:text-violet-400 transition-colors">
              View all →
            </Link>
          )}
        </div>
        {opportunities.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40">
            <p className="text-sm text-zinc-600">Run the autopilot to discover top opportunities</p>
            <Link href="/autopilot" className="text-xs text-violet-500 hover:text-violet-400 transition-colors">Go to Autopilot →</Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4">
            {opportunities.map((opp: any) => {
              const scoreColor = opp.lastScore >= 60 ? 'text-emerald-400' : opp.lastScore >= 45 ? 'text-amber-400' : 'text-zinc-500'
              const actionStyle: Record<string, string> = {
                PAPER_BUY: 'bg-emerald-900/50 text-emerald-400 border-emerald-800',
                QUEUED_LIVE: 'bg-blue-900/50 text-blue-400 border-blue-800',
                VETOED: 'bg-red-900/50 text-red-400 border-red-800',
                SKIP: 'bg-zinc-800/80 text-zinc-600 border-zinc-700',
              }
              return (
                <Link
                  key={opp.id}
                  href={`/analysis/${opp.ticker}`}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 hover:border-zinc-700 hover:bg-zinc-800/40 transition-all group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-mono font-bold text-zinc-100 group-hover:text-violet-400 transition-colors">{opp.ticker}</div>
                      <div className="text-[10px] text-zinc-600 mt-0.5 truncate max-w-[100px]">{opp.name}</div>
                    </div>
                    {opp.lastScore != null && (
                      <span className={cn('font-mono text-lg font-bold tabular-nums', scoreColor)}>
                        {opp.lastScore}
                      </span>
                    )}
                  </div>
                  {opp.lastMos != null && (
                    <div className="text-xs text-zinc-500 mb-2">
                      MOS: <span className={cn('font-mono font-semibold', opp.lastMos >= 15 ? 'text-emerald-400' : opp.lastMos >= 0 ? 'text-amber-400' : 'text-red-400')}>
                        {opp.lastMos >= 0 ? '+' : ''}{opp.lastMos.toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {opp.lastAction && (
                    <div className={cn('rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide inline-block mb-2', actionStyle[opp.lastAction] ?? 'text-zinc-500 border-zinc-700 bg-zinc-800')}>
                      {opp.lastAction}
                    </div>
                  )}
                  {opp.lastSkipReason && (
                    <div className="text-[10px] text-zinc-700 line-clamp-2 leading-relaxed">{opp.lastSkipReason}</div>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* Section 3: Daily Rundown */}
      {dailyRundown && (
        <div className="rounded-xl border border-violet-800/30 bg-violet-900/10 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-violet-400">Daily Market Rundown</span>
            {lastRunAt && <span className="text-xs text-zinc-600">{lastRunAt.toLocaleDateString()}</span>}
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed">{dailyRundown}</p>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {stats.map(({ label, value, sub, href, good, bad }: any) => (
          <Link key={label} href={href} className="group rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 hover:border-zinc-700 transition-all">
            <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-600">{label}</div>
            <div className={cn('mt-1.5 font-mono text-2xl font-bold tabular-nums transition-colors',
              good === true ? 'text-emerald-400' : bad ? 'text-amber-400' : 'text-zinc-100')}>
              {value}
            </div>
            <div className="mt-0.5 text-xs text-zinc-600 group-hover:text-zinc-500 transition-colors">{sub}</div>
          </Link>
        ))}
      </div>

      {/* Section 4: Quick Actions */}
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
          href="/autopilot"
          className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 hover:border-amber-800/50 hover:bg-amber-900/10 transition-all group"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-900/40 border border-amber-800/30 group-hover:bg-amber-800/40 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4 text-amber-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-medium text-zinc-300 group-hover:text-zinc-100 transition-colors">Run Autopilot</div>
            <div className="text-xs text-zinc-600">Full auto discovery + analysis</div>
          </div>
        </Link>
      </div>

      {/* Market Temperature */}
      <MarketTemperatureWidget />

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

      {/* Paper Positions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">Paper Portfolio</h2>
          <Link href="/autopilot" className="text-[11px] text-zinc-600 hover:text-violet-400 transition-colors">
            View autopilot →
          </Link>
        </div>
        {paperPositions.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 text-sm rounded-xl border border-zinc-800 bg-zinc-900/40">
            No paper positions yet — the autopilot will enter trades when it finds qualifying stocks
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/80">
                  {['Ticker', 'Shares', 'Entry', 'Current IV', 'Return %'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 bg-zinc-900/40">
                {paperPositions.map((p: any) => (
                  <tr key={p.id} className="hover:bg-zinc-800/20 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-zinc-100">{p.ticker}</td>
                    <td className="px-4 py-3 font-mono text-zinc-400">{p.shares}</td>
                    <td className="px-4 py-3 font-mono text-zinc-500">${p.entryPrice.toFixed(2)}</td>
                    <td className="px-4 py-3 font-mono text-zinc-300">${p.currentPrice.toFixed(2)}</td>
                    <td className={cn('px-4 py-3 font-mono text-xs', p.gainLossPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {p.gainLossPct >= 0 ? '+' : ''}{p.gainLossPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
