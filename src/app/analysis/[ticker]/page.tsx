export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { MetricCard } from '@/components/ui/MetricCard'
import { CriteriaRow } from '@/components/ui/CriteriaRow'
import { MOSGauge } from '@/components/ui/MOSGauge'
import { FundamentalChart } from '@/components/ui/FundamentalChart'
import { formatCurrency, formatNumber, formatPct, cn } from '@/lib/utils'
import { getCompleteFundamentals, getTickerNews, getInsiderTransactions, getEarningsCalendar, getHistoricalValuationBands, getStockPeers } from '@/lib/fmp/client'
import { DeepDivePanel } from '@/components/ui/DeepDivePanel'
import { applyGrahamCriteria } from '@/lib/graham/screener'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import { scoreBuyDecision } from '@/lib/philosophy/scorer'

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ ticker: string }>
}) {
  const { ticker } = await params

  let fundamentals, criteria, iv, philosophy, news
  let fetchError: string | null = null
  try {
    fundamentals = await getCompleteFundamentals(ticker.toUpperCase())
    criteria = applyGrahamCriteria(fundamentals)
    iv = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding)
    news = await getTickerNews(ticker.toUpperCase()).catch(() => null)
    philosophy = scoreBuyDecision(fundamentals, criteria, iv, news ?? undefined)
  } catch (err: any) {
    const msg: string = err?.message ?? ''
    if (msg.includes('404') || msg.includes('not found')) notFound()
    fetchError = msg.includes('429')
      ? 'FMP API rate limit reached — resets at midnight UTC. Try again tomorrow or search a cached ticker.'
      : `Could not load data for ${ticker.toUpperCase()}: ${msg}`
  }

  if (fetchError || !fundamentals || !criteria || !iv || !philosophy) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
        <div className="rounded-xl border border-amber-800/40 bg-amber-900/10 px-6 py-5 max-w-md">
          <div className="text-sm font-semibold text-amber-400 mb-1">{ticker.toUpperCase()}</div>
          <p className="text-sm text-amber-400/80">{fetchError ?? 'No data available for this ticker.'}</p>
        </div>
        <a href="/analysis" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">← Back to search</a>
      </div>
    )
  }

  let insider: Awaited<ReturnType<typeof getInsiderTransactions>> = []
  let earnings: Awaited<ReturnType<typeof getEarningsCalendar>> = []
  let valuationBands: Awaited<ReturnType<typeof getHistoricalValuationBands>> = []
  let peers: Awaited<ReturnType<typeof getStockPeers>> = []

  try {
    ;[insider, earnings, valuationBands, peers] = await Promise.all([
      getInsiderTransactions(ticker.toUpperCase(), 10).catch(() => []),
      getEarningsCalendar(ticker.toUpperCase()).catch(() => []),
      getHistoricalValuationBands(ticker.toUpperCase()).catch(() => []),
      getStockPeers(ticker.toUpperCase()).catch(() => []),
    ])
  } catch {
    // enrichment data is optional — page still renders without it
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-zinc-100 font-mono">{ticker.toUpperCase()}</h1>
            <span className={`rounded-lg border px-2.5 py-0.5 text-xs font-semibold ${criteria.overallPass ? 'border-emerald-800/50 bg-emerald-900/20 text-emerald-400' : 'border-zinc-700 bg-zinc-900 text-zinc-500'}`}>
              {criteria.overallPass ? 'PASSES GRAHAM' : 'FAILS GRAHAM'}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {fundamentals.name} · {fundamentals.sector} · {fundamentals.exchange}
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-mono font-bold text-zinc-100">
            {formatCurrency(fundamentals.price)}
          </div>
          {fundamentals.marketCap && (
            <div className="text-xs text-zinc-600 mt-0.5">
              Mkt Cap: {formatCurrency(fundamentals.marketCap, 0)}
            </div>
          )}
        </div>
      </div>

      <DeepDivePanel ticker={ticker.toUpperCase()} />

      {/* MOS + Key Valuation */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <MOSGauge
          marginOfSafety={iv.marginOfSafety}
          intrinsicValue={iv.intrinsicValue}
          currentPrice={iv.currentPrice}
        />
        <div className="col-span-2 grid grid-cols-3 gap-3">
          <MetricCard label="Graham Number" value={iv.grahamNumber ? formatCurrency(iv.grahamNumber) : '—'} description="sqrt(22.5 × EPS × BV/share)" />
          <MetricCard label="DCF Value" value={iv.dcfValue ? formatCurrency(iv.dcfValue) : '—'} description={`Growth: ${iv.growthRateUsed ? formatPct(iv.growthRateUsed * 100, 1) : '—'}`} />
          <MetricCard label="Owner Earnings" value={iv.ownerEarnings ? formatCurrency(iv.ownerEarnings / (fundamentals.sharesOutstanding ?? 1)) : '—'} description="NI + D&A − CapEx per share" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Graham Criteria */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">
            Graham Chapter 14 — Defensive Investor Criteria
          </h2>
          <CriteriaRow label="P/E Ratio ≤ 15" passed={criteria.passedPE} value={criteria.peValue?.toFixed(1)} threshold="≤ 15" />
          <CriteriaRow label="Price/Book ≤ 1.5" passed={criteria.passedPB} value={criteria.pbValue?.toFixed(2)} threshold="≤ 1.5" />
          <CriteriaRow label="Current Ratio ≥ 2" passed={criteria.passedCurrentRatio} value={criteria.currentRatioValue?.toFixed(1)} threshold="≥ 2" />
          <CriteriaRow label="LT Debt ≤ Net Current Assets" passed={criteria.passedDebtToAssets} value={criteria.debtToAssetsValue?.toFixed(2)} threshold="≤ 1×" />
          <CriteriaRow label="EPS CAGR ≥ 3%/yr (10yr)" passed={criteria.passedEpsGrowth} value={criteria.epsGrowthValue ? `${criteria.epsGrowthValue.toFixed(1)}%` : undefined} threshold="≥ 3%" />
          <CriteriaRow label="Dividends ≥ 20 Consecutive Years" passed={criteria.passedDividends} value={criteria.dividendYears ? `${criteria.dividendYears} years` : undefined} threshold="≥ 20yr" />
          <CriteriaRow label="No Earnings Deficit (10yr)" passed={criteria.passedNoDeficit} />
          <div className="mt-4 flex items-center justify-between rounded bg-zinc-800 px-3 py-2">
            <span className="text-sm font-medium text-zinc-300">Overall Result</span>
            <span className={criteria.overallPass ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>
              {criteria.overallPass ? 'PASSES ALL CRITERIA' : 'DOES NOT QUALIFY'}
            </span>
          </div>
        </section>

        {/* Key Metrics */}
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">
            Key Fundamentals
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="P/E" value={fundamentals.pe ? formatNumber(fundamentals.pe, 1) : '—'} good={criteria.passedPE} />
            <MetricCard label="P/B" value={fundamentals.pb ? formatNumber(fundamentals.pb, 2) : '—'} good={criteria.passedPB} />
            <MetricCard label="PEG Ratio" value={fundamentals.peg ? formatNumber(fundamentals.peg, 2) : '—'} good={fundamentals.peg != null ? fundamentals.peg < 1 : undefined} description="Lynch: <1.0 = GARP" />
            <MetricCard label="Earnings Yield" value={fundamentals.earningsYield ? formatPct(fundamentals.earningsYield * 100, 1) : '—'} good={fundamentals.earningsYield != null ? fundamentals.earningsYield >= 0.10 : undefined} description="Greenblatt: EBIT/EV ≥10%" />
            <MetricCard label="P/FCF" value={fundamentals.priceToFreeCashFlow ? formatNumber(fundamentals.priceToFreeCashFlow, 1) + '×' : '—'} good={fundamentals.priceToFreeCashFlow != null ? fundamentals.priceToFreeCashFlow < 15 : undefined} description="Dreman: <15× preferred" />
            <MetricCard label="Current Ratio" value={fundamentals.currentRatio ? formatNumber(fundamentals.currentRatio, 1) : '—'} good={criteria.passedCurrentRatio} />
            <MetricCard label="Debt/Equity" value={fundamentals.debtToEquity ? formatNumber(fundamentals.debtToEquity, 2) : '—'} good={fundamentals.debtToEquity != null ? fundamentals.debtToEquity < 1 : undefined} />
            <MetricCard label="ROE" value={fundamentals.roe ? formatPct(fundamentals.roe * 100) : '—'} good={fundamentals.roe != null ? fundamentals.roe > 0.15 : undefined} />
            <MetricCard label="ROIC" value={fundamentals.roic ? formatPct(fundamentals.roic * 100) : '—'} good={fundamentals.roic != null ? fundamentals.roic > 0.15 : undefined} />
            <MetricCard label="Gross Margin" value={fundamentals.grossMargin ? formatPct(fundamentals.grossMargin * 100, 1) : '—'} good={fundamentals.grossMargin != null ? fundamentals.grossMargin > 0.40 : undefined} />
            <MetricCard label="Op. Margin Trend" value={fundamentals.operatingMarginTrend?.toUpperCase() ?? '—'} good={fundamentals.operatingMarginTrend === 'improving'} description="Fisher Point 5" />
            <MetricCard label="Net Cash" value={fundamentals.netCash ? formatCurrency(fundamentals.netCash) : '—'} good={fundamentals.netCash != null ? fundamentals.netCash > 0 : undefined} description="Cash − total debt" />
          </div>
        </section>
      </div>

      {/* Philosophy Score */}
      {philosophy && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
              Philosophy Engine Score
            </h2>
            <div className="flex items-center gap-3">
              {philosophy.vetoedBy.length > 0 && (
                <span className="rounded border border-red-800/50 bg-red-900/20 px-2.5 py-0.5 text-xs font-semibold text-red-400">
                  VETOED
                </span>
              )}
              <span className={cn(
                'rounded border px-3 py-1 text-sm font-bold font-mono',
                philosophy.signal === 'BUY' ? 'border-emerald-700 bg-emerald-900/30 text-emerald-400'
                  : philosophy.signal === 'HOLD' ? 'border-sky-700 bg-sky-900/30 text-sky-400'
                  : philosophy.signal === 'SELL' ? 'border-red-700 bg-red-900/30 text-red-400'
                  : 'border-zinc-700 bg-zinc-800 text-zinc-400'
              )}>
                {philosophy.signal}
              </span>
              <span className={cn(
                'text-2xl font-bold font-mono',
                philosophy.total >= 70 ? 'text-emerald-400'
                  : philosophy.total >= 50 ? 'text-amber-400'
                  : 'text-red-400'
              )}>
                {philosophy.vetoedBy.length > 0 ? '0' : philosophy.total}<span className="text-sm text-zinc-600">/100</span>
              </span>
            </div>
          </div>

          {/* Veto reasons */}
          {philosophy.vetoedBy.length > 0 && (
            <div className="mb-3 space-y-1">
              {philosophy.vetoedBy.map((v) => (
                <div key={v.id} className="flex items-start gap-2 rounded bg-red-950/30 border border-red-900/30 px-3 py-2">
                  <span className="mt-0.5 text-red-500 text-xs">✕</span>
                  <span className="text-xs text-red-300">{v.title}</span>
                </div>
              ))}
            </div>
          )}

          {/* Audit trail */}
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {philosophy.auditTrail.map((line, i) => {
              const isPass = line.startsWith('PASS')
              const isFail = line.startsWith('FAIL')
              const isWarn = line.startsWith('WARN')
              const isVeto = line.startsWith('VETO')
              const isComposite = line.startsWith('\nCOMPOSITE') || line.startsWith('COMPOSITE')
              return (
                <div key={i} className={cn(
                  'rounded px-3 py-1.5 text-xs leading-relaxed',
                  isPass ? 'bg-emerald-950/30 text-emerald-400'
                    : isVeto ? 'bg-red-950/40 text-red-400 font-medium'
                    : isFail ? 'bg-red-950/20 text-red-400'
                    : isWarn ? 'bg-amber-950/30 text-amber-400'
                    : isComposite ? 'bg-violet-950/30 text-violet-300 font-semibold'
                    : 'text-zinc-500'
                )}>
                  {line.trim()}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* News Panel */}
      {news && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
              Recent News
            </h2>
            <div className="flex items-center gap-2">
              {news.hardVetoFlags.length > 0 && (
                <span className="rounded border border-red-800/50 bg-red-900/20 px-2.5 py-0.5 text-xs font-semibold text-red-400">
                  ⚠ {news.hardVetoFlags.length} HARD VETO
                </span>
              )}
              {news.disruptionFlags.length > 0 && (
                <span className="rounded border border-amber-800/50 bg-amber-900/20 px-2.5 py-0.5 text-xs font-semibold text-amber-400">
                  {news.disruptionFlags.length} disruption flag{news.disruptionFlags.length > 1 ? 's' : ''}
                </span>
              )}
              <span className={cn(
                'rounded border px-2.5 py-0.5 text-xs font-semibold',
                news.sentiment === 'positive' ? 'border-emerald-700 text-emerald-400 bg-emerald-900/20'
                  : news.sentiment === 'negative' ? 'border-red-700 text-red-400 bg-red-900/20'
                  : 'border-zinc-700 text-zinc-400 bg-zinc-800'
              )}>
                {news.sentiment.toUpperCase()}
              </span>
            </div>
          </div>

          {news.hardVetoFlags.length > 0 && (
            <div className="mb-3 rounded border border-red-900/50 bg-red-950/30 px-3 py-2">
              <p className="text-xs font-semibold text-red-400 mb-1">Hard-veto events detected:</p>
              {news.hardVetoFlags.map((flag, i) => (
                <p key={i} className="text-xs text-red-300">• {flag}</p>
              ))}
            </div>
          )}

          {news.disruptionFlags.length > 0 && (
            <div className="mb-3 rounded border border-amber-900/50 bg-amber-950/20 px-3 py-2">
              <p className="text-xs font-semibold text-amber-400 mb-1">Disruption signals:</p>
              {news.disruptionFlags.map((flag, i) => (
                <p key={i} className="text-xs text-amber-300">• {flag}</p>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {news.items.slice(0, 8).map((item, i) => (
              <div key={i} className="flex items-start gap-3 rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-zinc-300 leading-snug line-clamp-2">{item.title}</p>
                  <p className="mt-0.5 text-[10px] text-zinc-600">{item.site} · {new Date(item.publishedDate).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
            {news.items.length === 0 && (
              <p className="text-xs text-zinc-600 py-2">No recent news found for {ticker.toUpperCase()}.</p>
            )}
          </div>
        </section>
      )}

      {/* Earnings Calendar */}
      {earnings.length > 0 && (() => {
        const today = new Date()
        const next = earnings.find(e => new Date(e.date) >= today)
        const daysUntil = next ? Math.round((new Date(next.date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null
        return (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">Earnings Calendar</h2>
            {next && (
              <div className={cn(
                'mb-3 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm',
                daysUntil !== null && daysUntil <= 21
                  ? 'border-amber-800/50 bg-amber-900/10 text-amber-400'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400'
              )}>
                <span className="font-semibold">Next:</span>
                <span>{next.date}</span>
                {daysUntil !== null && <span className="text-xs text-zinc-500">({daysUntil} days)</span>}
                {daysUntil !== null && daysUntil <= 21 && (
                  <span className="ml-auto text-xs font-semibold text-amber-500">⚠ Autopilot will wait</span>
                )}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-zinc-800">
                  {['Date', 'EPS Est.', 'EPS Act.', 'Beat?'].map(h => (
                    <th key={h} className="pb-2 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600 pr-4">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {earnings.slice(0, 5).map((e, i) => (
                    <tr key={i} className="py-1.5">
                      <td className="py-2 pr-4 font-mono text-zinc-400">{e.date}</td>
                      <td className="py-2 pr-4 font-mono text-zinc-500">{e.epsEstimated?.toFixed(2) ?? '—'}</td>
                      <td className="py-2 pr-4 font-mono text-zinc-300">{e.eps?.toFixed(2) ?? '—'}</td>
                      <td className="py-2">
                        {e.eps !== null && e.epsEstimated !== null ? (
                          <span className={cn('text-[10px] font-bold', e.eps >= e.epsEstimated ? 'text-emerald-400' : 'text-red-400')}>
                            {e.eps >= e.epsEstimated ? 'BEAT' : 'MISS'}
                          </span>
                        ) : <span className="text-zinc-700">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      {/* Insider Activity */}
      {insider.length > 0 && (() => {
        const buys = insider.filter(t => t.transactionType?.includes('P'))
        const sells = insider.filter(t => t.transactionType?.includes('S'))
        return (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <h2 className="mb-1 text-xs font-medium uppercase tracking-widest text-zinc-500">Insider Activity</h2>
            <p className="mb-3 text-xs text-zinc-600">SEC Form 4 filings — officer and director transactions</p>
            <div className="flex gap-4 mb-3 text-xs">
              <span className="text-emerald-400 font-semibold">{buys.length} purchases</span>
              <span className="text-red-400 font-semibold">{sells.length} sales</span>
              {buys.length > sells.length && <span className="text-zinc-500">— Net insider buying (bullish signal)</span>}
              {sells.length > buys.length * 2 && <span className="text-amber-500">— Heavy insider selling (caution)</span>}
            </div>
            <div className="space-y-1.5">
              {insider.slice(0, 6).map((t, i) => {
                const isBuy = t.transactionType?.includes('P')
                return (
                  <div key={i} className="flex items-center gap-3 text-xs rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold border shrink-0',
                      isBuy ? 'border-emerald-800 bg-emerald-900/30 text-emerald-400' : 'border-red-900 bg-red-900/20 text-red-400'
                    )}>{isBuy ? 'BUY' : 'SELL'}</span>
                    <span className="text-zinc-400 truncate">{t.reportingName}</span>
                    <span className="text-zinc-600 shrink-0">{t.transactionDate?.slice(0,10)}</span>
                    <span className="font-mono text-zinc-300 ml-auto shrink-0">
                      {t.securitiesTransacted?.toLocaleString()} shares
                      {t.price ? ` @ $${t.price.toFixed(2)}` : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Historical Valuation */}
      {valuationBands.length >= 3 && (() => {
        const pes = valuationBands.map(v => v.pe).filter((p): p is number => p !== null && p > 0 && p < 100)
        const avgPE = pes.length ? pes.reduce((a,b) => a+b, 0) / pes.length : null
        const currentPE = fundamentals?.pe
        const vsAvg = avgPE && currentPE ? ((currentPE - avgPE) / avgPE * 100) : null

        return (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">Historical Valuation Context</h2>
            <p className="mb-3 text-xs text-zinc-600">Is today&apos;s price cheap vs this stock&apos;s own history?</p>

            {currentPE && avgPE && (
              <div className={cn(
                'mb-4 rounded-lg border px-4 py-2.5 text-sm font-medium',
                currentPE <= avgPE * 0.85 ? 'border-emerald-800/50 bg-emerald-900/10 text-emerald-400' :
                currentPE >= avgPE * 1.15 ? 'border-amber-800/50 bg-amber-900/10 text-amber-400' :
                'border-zinc-800 bg-zinc-900 text-zinc-400'
              )}>
                Current P/E {currentPE.toFixed(1)}× is {vsAvg !== null ? `${Math.abs(vsAvg).toFixed(0)}% ${vsAvg < 0 ? 'below' : 'above'}` : ''} its {valuationBands.length}-year average of {avgPE.toFixed(1)}×
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-zinc-800">
                  {['Year', 'P/E', 'P/B', 'P/FCF'].map(h => (
                    <th key={h} className="pb-2 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600 pr-6">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {valuationBands.slice(-8).reverse().map((v, i) => (
                    <tr key={i}>
                      <td className="py-1.5 pr-6 font-mono text-zinc-500">{v.year}</td>
                      <td className={cn('py-1.5 pr-6 font-mono', v.pe && v.pe > 0 ? 'text-zinc-300' : 'text-zinc-700')}>{v.pe?.toFixed(1) ?? '—'}</td>
                      <td className={cn('py-1.5 pr-6 font-mono', v.pb && v.pb > 0 ? 'text-zinc-300' : 'text-zinc-700')}>{v.pb?.toFixed(1) ?? '—'}</td>
                      <td className={cn('py-1.5 font-mono', v.pfcf && v.pfcf > 0 ? 'text-zinc-300' : 'text-zinc-700')}>{v.pfcf?.toFixed(1) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      {/* Peer Comparison */}
      {peers.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">Sector Peers</h2>
          <div className="flex flex-wrap gap-2">
            {peers.map(peer => (
              <a
                key={peer}
                href={`/analysis/${peer}`}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-mono text-sm font-semibold text-zinc-300 hover:border-violet-700 hover:text-violet-400 transition-colors"
              >
                {peer}
              </a>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-700">Click any peer to compare valuations</p>
        </div>
      )}

      {/* 10-Year Trend Charts — NO price charts, fundamentals only */}
      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">
          10-Year Fundamental Trends
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <FundamentalChart
            data={fundamentals.epsHistory ?? []}
            label="EPS (Diluted)"
            format="currency"
          />
          <FundamentalChart
            data={fundamentals.revenueHistory ?? []}
            label="Revenue"
            format="currency"
          />
          <FundamentalChart
            data={fundamentals.fcfHistory ?? []}
            label="Free Cash Flow"
            format="currency"
          />
          <FundamentalChart
            data={fundamentals.bookValueHistory ?? []}
            label="Book Value / Share"
            format="currency"
          />
        </div>
      </section>
    </div>
  )
}
