export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { MetricCard } from '@/components/ui/MetricCard'
import { CriteriaRow } from '@/components/ui/CriteriaRow'
import { MOSGauge } from '@/components/ui/MOSGauge'
import { FundamentalChart } from '@/components/ui/FundamentalChart'
import { formatCurrency, formatNumber, formatPct, cn } from '@/lib/utils'
import { getCompleteFundamentals, getTickerNews } from '@/lib/fmp/client'
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
  try {
    fundamentals = await getCompleteFundamentals(ticker.toUpperCase())
    criteria = applyGrahamCriteria(fundamentals)
    iv = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding)
    news = await getTickerNews(ticker.toUpperCase()).catch(() => null)
    philosophy = scoreBuyDecision(fundamentals, criteria, iv, news ?? undefined)
  } catch {
    notFound()
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
