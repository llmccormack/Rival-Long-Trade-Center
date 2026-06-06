export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/db/client'
import { PositionsTable } from '@/components/portfolio/PositionsTable'
import { formatCurrency } from '@/lib/utils'
import Link from 'next/link'
import { cn } from '@/lib/utils'

async function getPortfolioData() {
  let holdings: any[] = []
  try {
    holdings = await prisma.portfolioItem.findMany({
      include: {
        stock: { include: { intrinsicValues: { orderBy: { calculatedAt: 'desc' }, take: 1 } } },
      },
    })
  } catch {}

  const positions = holdings.map((h) => {
    const iv = h.stock.intrinsicValues[0]
    const currentValue = h.shares * h.avgCostBasis
    return {
      id: h.id, ticker: h.stock.ticker, name: h.stock.name, shares: h.shares,
      avgCostBasis: h.avgCostBasis, currentPrice: h.avgCostBasis, currentValue,
      costBasis: currentValue, gainLoss: 0, gainLossPct: 0,
      intrinsicValue: iv?.intrinsicValue, marginOfSafety: iv?.marginOfSafety,
      firstPurchased: h.firstPurchased,
    }
  })

  let lastRebalance = null
  try {
    lastRebalance = await prisma.quarterlyRebalance.findFirst({ orderBy: { executedAt: 'desc' } })
  } catch {}

  let closedPositions: any[] = []
  try {
    closedPositions = await prisma.paperPortfolioItem.findMany({
      where: { isOpen: false },
      include: { stock: true },
      orderBy: { closedAt: 'desc' },
      take: 20,
    })
  } catch {}

  return { positions, lastRebalance, closedPositions }
}

export default async function PortfolioPage() {
  const { positions, lastRebalance, closedPositions } = await getPortfolioData()

  const totalValue = positions.reduce((s, p) => s + p.currentValue, 0)
  const avgMOS = positions.filter(p => p.marginOfSafety != null).length > 0
    ? positions.reduce((s, p) => s + (p.marginOfSafety ?? 0), 0) / positions.filter(p => p.marginOfSafety != null).length
    : null
  const healthScore = avgMOS != null ? Math.min(100, Math.round(avgMOS + 50)) : null

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      {/* Paper Trading Mode Banner */}
      <div className="rounded-xl border border-violet-800/30 bg-violet-900/10 px-4 py-3 flex items-center justify-between">
        <div>
          <span className="text-xs font-semibold text-violet-400 uppercase tracking-widest">Paper Trading Mode</span>
          <p className="text-xs text-zinc-500 mt-0.5">Simulated trades only — no real money. Connect Schwab in Settings to go live.</p>
        </div>
        <a href="/settings" className="text-xs text-zinc-600 hover:text-zinc-400">Settings →</a>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Portfolio</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Long-term value holdings — bought with conviction, held for years.</p>
        </div>
        {lastRebalance && (
          <div className="text-right">
            <div className="text-[10px] text-zinc-600 uppercase tracking-widest">Last Rebalance</div>
            <div className="text-xs text-zinc-500 mt-0.5">{new Date(lastRebalance.executedAt).toLocaleDateString()}</div>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Total Value', value: totalValue > 0 ? formatCurrency(totalValue) : '—', sub: 'at cost basis' },
          { label: 'Positions', value: positions.length || '—', sub: 'max 30 per portfolio' },
          { label: 'Avg Margin of Safety', value: avgMOS != null ? `${avgMOS.toFixed(1)}%` : '—', sub: 'below intrinsic value', good: avgMOS != null ? avgMOS >= 30 : undefined },
          { label: 'Health Score', value: healthScore != null ? `${healthScore}/100` : '—', sub: 'based on avg MOS', good: healthScore != null ? healthScore >= 75 : undefined },
        ].map(({ label, value, sub, good }) => (
          <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-600">{label}</div>
            <div className={cn(
              'mt-1.5 font-mono text-2xl font-bold tabular-nums',
              good === true ? 'text-emerald-400' : good === false ? 'text-red-400' : 'text-zinc-100'
            )}>
              {value}
            </div>
            <div className="mt-0.5 text-xs text-zinc-600">{sub}</div>
          </div>
        ))}
      </div>

      {/* Holdings table */}
      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">Holdings</h2>
        <PositionsTable positions={positions} />
      </section>

      {/* Closed positions */}
      {closedPositions.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-300 mb-3">Closed Positions</h2>
          <div className="rounded-xl border border-zinc-800 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/50">
                  <th className="px-4 py-2.5 text-left text-zinc-500 font-medium">Ticker</th>
                  <th className="px-4 py-2.5 text-right text-zinc-500 font-medium">Entry</th>
                  <th className="px-4 py-2.5 text-right text-zinc-500 font-medium">Exit</th>
                  <th className="px-4 py-2.5 text-right text-zinc-500 font-medium">Return</th>
                  <th className="px-4 py-2.5 text-left text-zinc-500 font-medium">Reason</th>
                  <th className="px-4 py-2.5 text-right text-zinc-500 font-medium">Closed</th>
                </tr>
              </thead>
              <tbody>
                {closedPositions.map((p: any) => {
                  const ret = p.closePrice && p.avgCostBasis ? ((p.closePrice - p.avgCostBasis) / p.avgCostBasis * 100) : null
                  return (
                    <tr key={p.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/30">
                      <td className="px-4 py-2.5 font-mono font-bold text-zinc-300">{p.stock.ticker}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-zinc-400">${p.avgCostBasis.toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-zinc-400">{p.closePrice ? `$${p.closePrice.toFixed(2)}` : '—'}</td>
                      <td className={cn('px-4 py-2.5 text-right font-mono font-bold', ret == null ? 'text-zinc-600' : ret >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {ret != null ? `${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600 max-w-[200px] truncate">{p.closeReason ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-600">{p.closedAt ? new Date(p.closedAt).toLocaleDateString() : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sell discipline card */}
      <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/60 p-5">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">Sell Discipline</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { title: 'Never on Price', desc: 'Price decline is not a sell signal. A fundamentally sound business at a lower price is a better opportunity, not a worse one.' },
            { title: 'Fundamental Triggers Only', desc: 'Sell when: current ratio falls below 1.5, debt exceeds assets, two consecutive loss years, or ROIC drops 50% from 5yr average.' },
            { title: 'Quarterly Review', desc: 'Every holding is evaluated by the philosophy engine each quarter. Rebalancing is discipline-based, never market-reaction.' },
          ].map(({ title, desc }) => (
            <div key={title} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="text-sm font-medium text-zinc-300 mb-1">{title}</div>
              <div className="text-xs text-zinc-600 leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Link href="/philosophy?category=sell_discipline" className="text-[11px] text-zinc-600 hover:text-violet-400 transition-colors">
            View sell discipline principles →
          </Link>
        </div>
      </div>
    </div>
  )
}
