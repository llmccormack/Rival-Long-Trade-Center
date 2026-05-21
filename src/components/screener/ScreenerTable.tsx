'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatCurrency, formatNumber, cn } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { CriteriaRow } from '@/components/ui/CriteriaRow'
import type { ScreenedStock } from '@/types'

interface ScreenerTableProps {
  results: ScreenedStock[]
}

function PassCount({ criteria }: { criteria: ScreenedStock['criteria'] }) {
  const flags = [
    criteria.passedPE,
    criteria.passedPB,
    criteria.passedCurrentRatio,
    criteria.passedDebtToAssets,
    criteria.passedEpsGrowth,
    criteria.passedDividends,
    criteria.passedNoDeficit,
  ]
  const count = flags.filter(Boolean).length
  return (
    <span className={cn('font-mono text-sm', count === 7 ? 'text-emerald-400' : count >= 5 ? 'text-yellow-400' : 'text-zinc-500')}>
      {count}/7
    </span>
  )
}

export function ScreenerTable({ results }: ScreenerTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set())

  const addToWatchlist = async (ticker: string) => {
    await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker }),
    })
    setWatchlist((prev) => new Set([...prev, ticker]))
  }

  return (
    <div className="overflow-x-auto rounded border border-zinc-800">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/50">
            {['Ticker', 'Price', 'P/E', 'P/B', 'Cur. Ratio', 'Graham Score', 'MOS', 'Signal', ''].map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-widest text-zinc-600"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800 bg-zinc-900">
          {results.map((stock) => (
            <>
              <tr
                key={stock.ticker}
                className="cursor-pointer hover:bg-zinc-800/50"
                onClick={() => setExpanded(expanded === stock.ticker ? null : stock.ticker)}
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/analysis/${stock.ticker}`}
                    className="font-medium text-zinc-100 hover:text-emerald-400"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {stock.ticker}
                  </Link>
                  <div className="text-xs text-zinc-600">{stock.name}</div>
                </td>
                <td className="px-4 py-3 font-mono text-zinc-300">{formatCurrency(stock.price)}</td>
                <td className={cn('px-4 py-3 font-mono', stock.criteria.passedPE ? 'text-emerald-400' : 'text-red-400')}>
                  {stock.criteria.peValue ? formatNumber(stock.criteria.peValue, 1) : '—'}
                </td>
                <td className={cn('px-4 py-3 font-mono', stock.criteria.passedPB ? 'text-emerald-400' : 'text-red-400')}>
                  {stock.criteria.pbValue ? formatNumber(stock.criteria.pbValue, 2) : '—'}
                </td>
                <td className={cn('px-4 py-3 font-mono', stock.criteria.passedCurrentRatio ? 'text-emerald-400' : 'text-red-400')}>
                  {stock.criteria.currentRatioValue ? formatNumber(stock.criteria.currentRatioValue, 1) : '—'}
                </td>
                <td className="px-4 py-3">
                  <PassCount criteria={stock.criteria} />
                </td>
                <td className="px-4 py-3 font-mono">
                  {stock.intrinsicValue ? (
                    <span className={stock.intrinsicValue.marginOfSafety >= 30 ? 'text-emerald-400' : stock.intrinsicValue.marginOfSafety >= 0 ? 'text-yellow-400' : 'text-red-400'}>
                      {stock.intrinsicValue.marginOfSafety.toFixed(1)}%
                    </span>
                  ) : '—'}
                </td>
                <td className="px-4 py-3">
                  {stock.criteria.overallPass && stock.intrinsicValue?.isBuySignal ? (
                    <Badge variant="success">BUY</Badge>
                  ) : stock.criteria.overallPass ? (
                    <Badge variant="warning">WATCH</Badge>
                  ) : (
                    <Badge variant="neutral">SCREEN</Badge>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={(e) => { e.stopPropagation(); addToWatchlist(stock.ticker) }}
                    disabled={watchlist.has(stock.ticker)}
                    className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:border-emerald-700 hover:text-emerald-400 disabled:opacity-40"
                  >
                    {watchlist.has(stock.ticker) ? 'Added' : '+ Watch'}
                  </button>
                </td>
              </tr>
              {expanded === stock.ticker && (
                <tr key={`${stock.ticker}-detail`}>
                  <td colSpan={9} className="bg-zinc-900/80 px-6 py-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <h4 className="mb-2 text-xs font-medium uppercase tracking-widest text-zinc-500">
                          Graham Criteria
                        </h4>
                        <CriteriaRow label="P/E ≤ 15" passed={stock.criteria.passedPE} value={stock.criteria.peValue?.toFixed(1)} threshold="≤ 15" />
                        <CriteriaRow label="P/B ≤ 1.5" passed={stock.criteria.passedPB} value={stock.criteria.pbValue?.toFixed(2)} threshold="≤ 1.5" />
                        <CriteriaRow label="Current Ratio ≥ 2" passed={stock.criteria.passedCurrentRatio} value={stock.criteria.currentRatioValue?.toFixed(1)} threshold="≥ 2" />
                        <CriteriaRow label="LTD ≤ Net Current Assets" passed={stock.criteria.passedDebtToAssets} value={stock.criteria.debtToAssetsValue?.toFixed(2)} threshold="≤ 1×" />
                        <CriteriaRow label="EPS Growth ≥ 3%/yr" passed={stock.criteria.passedEpsGrowth} value={stock.criteria.epsGrowthValue ? `${stock.criteria.epsGrowthValue.toFixed(1)}%` : undefined} threshold="≥ 3%" />
                        <CriteriaRow label="Dividends ≥ 20 Years" passed={stock.criteria.passedDividends} value={stock.criteria.dividendYears ? `${stock.criteria.dividendYears}yr` : undefined} threshold="≥ 20yr" />
                        <CriteriaRow label="No Earnings Deficit (10yr)" passed={stock.criteria.passedNoDeficit} />
                      </div>
                      {stock.intrinsicValue && (
                        <div>
                          <h4 className="mb-2 text-xs font-medium uppercase tracking-widest text-zinc-500">
                            Valuation
                          </h4>
                          <div className="space-y-1.5 text-xs">
                            <div className="flex justify-between"><span className="text-zinc-500">Graham Number</span><span className="font-mono text-zinc-300">{stock.intrinsicValue.grahamNumber ? formatCurrency(stock.intrinsicValue.grahamNumber) : '—'}</span></div>
                            <div className="flex justify-between"><span className="text-zinc-500">DCF Value</span><span className="font-mono text-zinc-300">{stock.intrinsicValue.dcfValue ? formatCurrency(stock.intrinsicValue.dcfValue) : '—'}</span></div>
                            <div className="flex justify-between"><span className="text-zinc-500">Intrinsic Value</span><span className="font-mono text-emerald-400">{formatCurrency(stock.intrinsicValue.intrinsicValue)}</span></div>
                            <div className="flex justify-between"><span className="text-zinc-500">Current Price</span><span className="font-mono text-zinc-300">{formatCurrency(stock.intrinsicValue.currentPrice)}</span></div>
                            <div className="flex justify-between border-t border-zinc-800 pt-1.5"><span className="text-zinc-400">Margin of Safety</span><span className={`font-mono font-medium ${stock.intrinsicValue.marginOfSafety >= 30 ? 'text-emerald-400' : 'text-yellow-400'}`}>{stock.intrinsicValue.marginOfSafety.toFixed(1)}%</span></div>
                          </div>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}
