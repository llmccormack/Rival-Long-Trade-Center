'use client'

import Link from 'next/link'
import { formatCurrency, formatPct, mosColor, mosLabel } from '@/lib/utils'
import type { PortfolioPosition } from '@/types'

interface PositionsTableProps {
  positions: PortfolioPosition[]
}

export function PositionsTable({ positions }: PositionsTableProps) {
  if (positions.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded border border-zinc-800 bg-zinc-900">
        <p className="text-sm text-zinc-600">No positions held. Buy with conviction.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded border border-zinc-800">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/50">
            {['Ticker', 'Shares', 'Avg Cost', 'Price', 'Value', 'Gain/Loss', 'Intrinsic', 'MOS'].map(
              (h) => (
                <th
                  key={h}
                  className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-widest text-zinc-600"
                >
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800 bg-zinc-900">
          {positions.map((pos) => (
            <tr key={pos.id} className="hover:bg-zinc-800/50">
              <td className="px-4 py-3">
                <Link
                  href={`/analysis/${pos.ticker}`}
                  className="font-medium text-zinc-100 hover:text-emerald-400"
                >
                  {pos.ticker}
                </Link>
                <div className="text-xs text-zinc-600">{pos.name}</div>
              </td>
              <td className="px-4 py-3 font-mono text-zinc-300">{pos.shares.toFixed(0)}</td>
              <td className="px-4 py-3 font-mono text-zinc-400">
                {formatCurrency(pos.avgCostBasis)}
              </td>
              <td className="px-4 py-3 font-mono text-zinc-300">
                {formatCurrency(pos.currentPrice)}
              </td>
              <td className="px-4 py-3 font-mono text-zinc-300">
                {formatCurrency(pos.currentValue)}
              </td>
              <td className="px-4 py-3 font-mono">
                <span className={pos.gainLoss >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {formatCurrency(pos.gainLoss)}
                  <span className="ml-1 text-xs opacity-70">
                    ({formatPct(pos.gainLossPct)})
                  </span>
                </span>
              </td>
              <td className="px-4 py-3 font-mono text-zinc-400">
                {pos.intrinsicValue ? formatCurrency(pos.intrinsicValue) : '—'}
              </td>
              <td className="px-4 py-3 font-mono">
                {pos.marginOfSafety != null ? (
                  <span className={mosColor(pos.marginOfSafety)}>
                    {pos.marginOfSafety.toFixed(1)}%
                    <div className="text-xs opacity-70">{mosLabel(pos.marginOfSafety)}</div>
                  </span>
                ) : (
                  <span className="text-zinc-600">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
