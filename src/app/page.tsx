export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { prisma } from '@/lib/db/client'
import { cn, formatCurrency } from '@/lib/utils'
import Link from 'next/link'

async function withTimeout<T>(p: Promise<T>, fallback: T, ms = 2000): Promise<T> {
  return Promise.race([p, new Promise<T>(r => setTimeout(() => r(fallback), ms))])
}

async function getDashboardData() {
  try {
    const [topScores, openPositions, config, alerts] = await Promise.all([
      withTimeout(
        prisma.stockScore.findMany({
          orderBy: { score: 'desc' },
          take: 12,
        }),
        []
      ),
      withTimeout(
        prisma.paperPortfolioItem.findMany({
          where: { isOpen: true },
          include: { stock: true },
          orderBy: { firstPurchased: 'desc' },
          take: 8,
        }),
        []
      ),
      withTimeout(prisma.autopilotConfig.findUnique({ where: { id: 'singleton' } }), null),
      withTimeout(prisma.alert.count({ where: { isRead: false } }), 0),
    ])

    return { topScores, openPositions, config, alerts }
  } catch {
    return { topScores: [], openPositions: [], config: null, alerts: 0 }
  }
}

function ScoreBar({ score, threshold = 45 }: { score: number; threshold?: number }) {
  const pct = Math.min(100, (score / 100) * 100)
  const thresholdPct = threshold
  const passed = score >= threshold
  return (
    <div className="relative h-1 w-full rounded-full bg-zinc-800">
      {/* Threshold marker */}
      <div className="absolute top-1/2 -translate-y-1/2 w-px h-2.5 bg-zinc-600 z-10" style={{ left: `${thresholdPct}%` }} />
      {/* Score fill */}
      <div
        className={cn('h-full rounded-full transition-all', passed ? 'bg-emerald-500' : 'bg-zinc-600')}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export default async function DashboardPage() {
  const { topScores, openPositions, config, alerts } = await getDashboardData()

  const lastRun = config?.lastRunAt ? new Date(config.lastRunAt) : null
  const lastRunResult = config?.lastRunResult as any
  const threshold = config?.minPhilosophyScore ?? 45
  const buySignals = topScores.filter((s: any) => s.signal === 'BUY').length
  const aboveThreshold = topScores.filter((s: any) => s.score >= threshold).length

  const portfolioValue = openPositions.reduce((sum: number, p: any) => sum + p.shares * (p.currentPrice ?? p.avgCostBasis), 0)
  const portfolioCost  = openPositions.reduce((sum: number, p: any) => sum + p.shares * p.avgCostBasis, 0)
  const portfolioReturn = portfolioCost > 0 ? ((portfolioValue - portfolioCost) / portfolioCost) * 100 : 0

  const marketTemp = lastRunResult?.macro?.marketTemperature as string | undefined
  const tempConfig: Record<string, { label: string; color: string }> = {
    cold:    { label: 'Cold',    color: 'text-sky-400' },
    fair:    { label: 'Fair',    color: 'text-emerald-400' },
    warm:    { label: 'Warm',    color: 'text-amber-400' },
    hot:     { label: 'Hot',     color: 'text-orange-400' },
    extreme: { label: 'Extreme', color: 'text-red-400' },
  }
  const temp = marketTemp ? tempConfig[marketTemp] : null

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6 max-w-6xl">

      {/* ── Header row ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Dashboard</h1>
          <p className="text-xs text-zinc-600 mt-0.5">
            {lastRun
              ? `Last run ${lastRun.toLocaleString()} · ${lastRunResult?.totalAnalysed ?? lastRunResult?.watchlistScanned ?? 0} stocks scored`
              : 'Run the autopilot to start scoring stocks'}
          </p>
        </div>
        <Link
          href="/autopilot"
          className="flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-semibold text-white transition-colors"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
          </svg>
          Run Autopilot
        </Link>
      </div>

      {/* ── Key metrics ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: 'Portfolio',
            value: portfolioValue > 0 ? formatCurrency(portfolioValue) : '—',
            sub: portfolioCost > 0 ? `${portfolioReturn >= 0 ? '+' : ''}${portfolioReturn.toFixed(1)}% return` : `${openPositions.length} positions`,
            color: portfolioReturn > 0 ? 'text-emerald-400' : portfolioReturn < 0 ? 'text-red-400' : 'text-zinc-100',
            href: '/portfolio',
          },
          {
            label: 'Buy Signals',
            value: buySignals || '—',
            sub: `of ${topScores.length} scored`,
            color: buySignals > 0 ? 'text-emerald-400' : 'text-zinc-100',
            href: '/screener',
          },
          {
            label: 'Above Threshold',
            value: aboveThreshold || '—',
            sub: `score ≥ ${threshold}/100`,
            color: aboveThreshold > 0 ? 'text-violet-400' : 'text-zinc-100',
            href: '/screener',
          },
          {
            label: 'Market',
            value: temp?.label ?? '—',
            sub: lastRunResult?.macro?.sp500Cape ? `CAPE ${lastRunResult.macro.sp500Cape.toFixed(0)}` : 'no macro data',
            color: temp?.color ?? 'text-zinc-100',
            href: '/autopilot',
          },
        ].map(({ label, value, sub, color, href }) => (
          <Link key={label} href={href} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 hover:border-zinc-700 transition-all group">
            <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-600">{label}</div>
            <div className={cn('mt-1.5 text-2xl font-mono font-bold tabular-nums', color)}>{value}</div>
            <div className="mt-0.5 text-[11px] text-zinc-600">{sub}</div>
          </Link>
        ))}
      </div>

      {/* ── Score Board ─────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Score Board</h2>
          <Link href="/screener" className="text-[11px] text-zinc-600 hover:text-violet-400 transition-colors">
            Full board →
          </Link>
        </div>

        {topScores.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-xl border border-zinc-800 border-dashed bg-zinc-900/30">
            <p className="text-sm text-zinc-600">No stocks scored yet</p>
            <Link href="/autopilot" className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 text-xs font-medium text-zinc-300 transition-colors">
              Run autopilot to populate →
            </Link>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/80">
                  {['Ticker', 'Name', 'Price', 'MOS', 'Score', '', 'Signal'].map(h => (
                    <th key={h} className={cn(
                      'py-2.5 text-[10px] font-medium uppercase tracking-widest text-zinc-600',
                      h === '' ? 'px-3' : h === 'Ticker' ? 'pl-4 pr-3 text-left' : h === 'Name' ? 'px-3 text-left hidden sm:table-cell' : 'px-3 text-right'
                    )}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {topScores.map((s: any) => (
                  <tr key={s.ticker} className="bg-zinc-900/40 hover:bg-zinc-800/40 transition-colors group">
                    <td className="pl-4 pr-3 py-3">
                      <Link href={`/analysis/${s.ticker}`} className="font-mono text-sm font-bold text-zinc-100 group-hover:text-violet-400 transition-colors">
                        {s.ticker}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-500 max-w-[140px] truncate hidden sm:table-cell">{s.name ?? '—'}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-zinc-400">${s.price?.toFixed(2) ?? '—'}</td>
                    <td className={cn('px-3 py-3 text-right font-mono text-xs', s.mos >= 30 ? 'text-emerald-400' : s.mos > 0 ? 'text-amber-400' : 'text-zinc-600')}>
                      {s.mos != null ? `${s.mos.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className={cn(
                        'font-mono text-sm font-bold tabular-nums',
                        s.score >= 70 ? 'text-emerald-400' : s.score >= threshold ? 'text-violet-400' : s.score >= 35 ? 'text-amber-400' : 'text-zinc-600'
                      )}>
                        {s.score}
                      </span>
                    </td>
                    <td className="px-3 py-3 w-24 hidden md:table-cell">
                      <ScoreBar score={s.score} threshold={threshold} />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className={cn(
                        'inline-block rounded border px-2 py-0.5 text-[10px] font-semibold',
                        s.signal === 'BUY'
                          ? 'border-emerald-700 bg-emerald-900/30 text-emerald-400'
                          : s.vetoCount > 0
                          ? 'border-red-800 bg-red-900/20 text-red-500'
                          : 'border-zinc-700 bg-zinc-800 text-zinc-500'
                      )}>
                        {s.vetoCount > 0 && s.signal !== 'BUY' ? 'VETO' : s.signal}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Paper Portfolio ──────────────────────────────────────────────── */}
      {openPositions.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Open Positions</h2>
            <Link href="/portfolio" className="text-[11px] text-zinc-600 hover:text-violet-400 transition-colors">
              View all →
            </Link>
          </div>
          <div className="rounded-xl border border-zinc-800 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/80">
                  {['Ticker', 'Shares', 'Entry', 'Score'].map(h => (
                    <th key={h} className={cn('py-2.5 px-4 text-[10px] font-medium uppercase tracking-widest text-zinc-600', h === 'Ticker' ? 'text-left' : 'text-right')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {openPositions.map((p: any) => (
                  <tr key={p.id} className="bg-zinc-900/40 hover:bg-zinc-800/40 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/analysis/${p.stock.ticker}`} className="font-mono text-sm font-bold text-zinc-100 hover:text-violet-400 transition-colors">
                        {p.stock.ticker}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-zinc-400">{p.shares}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-zinc-400">${p.avgCostBasis.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">
                      {p.philosophyScore != null ? (
                        <span className={cn('font-mono text-xs font-bold', p.philosophyScore >= 60 ? 'text-emerald-400' : p.philosophyScore >= 45 ? 'text-amber-400' : 'text-zinc-500')}>
                          {p.philosophyScore}
                        </span>
                      ) : <span className="text-zinc-700 text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Daily rundown ────────────────────────────────────────────────── */}
      {config?.dailyRundown && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-2">Latest Rundown</div>
          <p className="text-sm text-zinc-400 leading-relaxed">{config.dailyRundown as string}</p>
        </div>
      )}

      {/* ── Alerts nudge ────────────────────────────────────────────────── */}
      {alerts > 0 && (
        <Link
          href="/portfolio"
          className="flex items-center gap-3 rounded-xl border border-amber-800/40 bg-amber-900/10 px-4 py-3 hover:border-amber-700/50 transition-colors"
        >
          <div className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
          <span className="text-sm text-amber-400 font-medium">{alerts} unread alert{alerts !== 1 ? 's' : ''}</span>
          <span className="ml-auto text-xs text-zinc-600">Review →</span>
        </Link>
      )}
    </div>
  )
}
