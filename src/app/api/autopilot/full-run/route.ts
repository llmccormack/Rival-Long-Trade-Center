import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getMarketCandidates } from '@/lib/yahoo/screener'
import { getCompleteFundamentals, getTickerNews, getEarningsCalendar } from '@/lib/fmp/client'
import { applyGrahamCriteria } from '@/lib/graham/screener'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import { scoreBuyDecision } from '@/lib/philosophy/scorer'
import { allocateCapital } from '@/lib/philosophy/capital-allocator'
import { scoreSellDecision } from '@/lib/philosophy/sell-scorer'
import { sendTradeNotification, sendRunSummary, sendVetoAlert } from '@/lib/notifications/email'
import { pushTradeNotification, pushRunSummary, pushVetoAlert } from '@/lib/notifications/push'

// POST /api/autopilot/full-run
// Full pipeline: scan market → auto-populate watchlist → execute trades
// Step 1: Yahoo pre-screen + FMP scoring → promote qualifying stocks to watchlist
// Step 2: Run autopilot against full watchlist
export async function POST(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let config: any
  try {
    config = await prisma.autopilotConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    })
  } catch (err: any) {
    return Response.json({ error: 'DB unavailable: ' + err.message }, { status: 500 })
  }

  // ── Step 1: Market scan + watchlist population ───────────────────────────
  const scanStart = Date.now()
  const candidates = await getMarketCandidates({ maxPE: 18, maxPB: 2.0, minMarketCapM: 300 })
  const toAnalyse = candidates.slice(0, 40)

  const scanResults: any[] = []
  const promoted: string[] = []

  for (const candidate of toAnalyse) {
    try {
      const fundamentals = await getCompleteFundamentals(candidate.symbol)
      const criteria = applyGrahamCriteria(fundamentals)
      const iv = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding)
      const philosophy = scoreBuyDecision(fundamentals, criteria, iv)

      scanResults.push({
        ticker: candidate.symbol,
        philosophyScore: philosophy.total,
        signal: philosophy.signal,
        mos: iv.marginOfSafety,
        vetoCount: philosophy.vetoedBy.length,
      })

      // Auto-promote: no vetoes, score ≥ 55, MOS ≥ 30%
      if (
        philosophy.vetoedBy.length === 0 &&
        philosophy.total >= 55 &&
        iv.marginOfSafety >= 30
      ) {
        const stock = await prisma.stock.upsert({
          where: { ticker: candidate.symbol },
          create: {
            ticker: candidate.symbol,
            name: fundamentals.name,
            sector: fundamentals.sector,
            industry: fundamentals.industry,
            exchange: fundamentals.exchange,
          },
          update: { name: fundamentals.name },
        })
        await prisma.watchlistItem.upsert({
          where: { stockId: stock.id },
          create: {
            stockId: stock.id,
            targetPrice: iv.intrinsicValue * 0.7,
            notes: `Auto-added by full-run scan. Score: ${philosophy.total}/100, MOS: ${iv.marginOfSafety.toFixed(1)}%`,
            isActive: true,
          },
          update: { isActive: true },
        })
        promoted.push(candidate.symbol)
      }

      await new Promise(r => setTimeout(r, 200))
    } catch {
      // Skip tickers with no FMP data
    }
  }

  // ── Step 2: Execute trades against full watchlist ────────────────────────
  const tradeResults: any[] = []

  const watchlist = await prisma.watchlistItem.findMany({
    where: { isActive: true },
    include: { stock: true },
  })

  for (const item of watchlist) {
    try {
      const fundamentals = await getCompleteFundamentals(item.stock.ticker)
      const criteria = applyGrahamCriteria(fundamentals)
      const iv = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding)
      const news = await getTickerNews(item.stock.ticker).catch(() => undefined)
      const philosophy = scoreBuyDecision(fundamentals, criteria, iv, news)

      // Skip if earnings within 21 days — don't buy into earnings uncertainty
      const earningsEvents = await getEarningsCalendar(item.stock.ticker).catch(() => [])
      const today = new Date()
      const earningsIn21Days = earningsEvents.some(e => {
        const d = new Date(e.date)
        const daysUntil = (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        return daysUntil >= 0 && daysUntil <= 21
      })
      if (earningsIn21Days) {
        tradeResults.push({
          ticker: item.stock.ticker,
          action: 'SKIP',
          score: philosophy.total,
          mos: iv.marginOfSafety,
          reason: 'Earnings within 21 days — waiting for clarity',
        })
        continue
      }

      const passed =
        philosophy.vetoedBy.length === 0 &&
        philosophy.total >= config.minPhilosophyScore &&
        iv.marginOfSafety >= config.minMarginOfSafety

      if (!passed) {
        tradeResults.push({
          ticker: item.stock.ticker,
          action: philosophy.vetoedBy.length > 0 ? 'VETOED' : 'SKIP',
          score: philosophy.total,
          mos: iv.marginOfSafety,
          reason: philosophy.vetoedBy.length > 0
            ? philosophy.vetoedBy.map((p: any) => p.title).join('; ')
            : `Score ${philosophy.total} / MOS ${iv.marginOfSafety.toFixed(1)}% below thresholds`,
        })
        continue
      }

      if (config.mode === 'paper') {
        const stock = await prisma.stock.upsert({
          where: { ticker: item.stock.ticker },
          create: {
            ticker: item.stock.ticker,
            name: fundamentals.name,
            sector: fundamentals.sector,
            industry: fundamentals.industry,
            exchange: fundamentals.exchange,
          },
          update: { name: fundamentals.name },
        })

        const existing = await prisma.paperPortfolioItem.findFirst({
          where: { stockId: stock.id, isOpen: true },
        })
        const openCount = await prisma.paperPortfolioItem.count({ where: { isOpen: true } })
        const existingValue = existing
          ? existing.shares * (existing.currentPrice ?? existing.avgCostBasis)
          : 0

        const allocation = allocateCapital({
          totalCapital: config.totalCapital ?? 10000,
          conviction: philosophy.conviction,
          marginOfSafety: iv.marginOfSafety,
          philosophyScore: philosophy.total,
          price: fundamentals.price,
          maxPositionPct: config.maxPositionPct ?? 10,
          openPositionCount: openCount,
          maxPositions: config.maxPositions ?? 15,
          existingPositionValue: existingValue,
        })

        if (!allocation.canAllocate) {
          tradeResults.push({
            ticker: item.stock.ticker,
            action: 'SKIP',
            score: philosophy.total,
            mos: iv.marginOfSafety,
            reason: allocation.reason,
          })
          continue
        }

        if (existing) {
          const newShares = existing.shares + allocation.shares
          const newAvg = (existing.shares * existing.avgCostBasis + allocation.shares * fundamentals.price) / newShares
          await prisma.paperPortfolioItem.update({
            where: { id: existing.id },
            data: { shares: newShares, avgCostBasis: newAvg, currentPrice: fundamentals.price },
          })
        } else {
          await prisma.paperPortfolioItem.create({
            data: {
              stockId: stock.id,
              shares: allocation.shares,
              avgCostBasis: fundamentals.price,
              currentPrice: fundamentals.price,
              philosophyScore: philosophy.total,
              conviction: philosophy.conviction,
              mosAtPurchase: iv.marginOfSafety,
              auditTrail: [allocation.rationale, ...philosophy.auditTrail.slice(0, 9)],
            },
          })
        }

        await prisma.alert.create({
          data: {
            ticker: item.stock.ticker,
            type: 'paper_buy',
            message: `PAPER BUY: ${allocation.shares} shares of ${item.stock.ticker} @ $${fundamentals.price.toFixed(2)} ($${allocation.dollarAmount.toFixed(0)} · ${allocation.positionPct.toFixed(1)}% of capital) | Score: ${philosophy.total}/100 | MOS: ${iv.marginOfSafety.toFixed(1)}%`,
            severity: 'buy',
          },
        })

        tradeResults.push({
          ticker: item.stock.ticker,
          action: 'PAPER_BUY',
          shares: allocation.shares,
          price: fundamentals.price,
          dollarAmount: allocation.dollarAmount,
          positionPct: allocation.positionPct,
          score: philosophy.total,
          mos: iv.marginOfSafety,
          conviction: philosophy.conviction,
          rationale: allocation.rationale,
        })
        await Promise.all([
          sendTradeNotification({ type: 'buy', ticker: item.stock.ticker, shares: allocation.shares, price: fundamentals.price, score: philosophy.total, mos: iv.marginOfSafety, conviction: philosophy.conviction }).catch(() => {}),
          pushTradeNotification({ type: 'buy', ticker: item.stock.ticker, shares: allocation.shares, price: fundamentals.price, score: philosophy.total, mos: iv.marginOfSafety, conviction: philosophy.conviction }).catch(() => {}),
        ])
      } else {
        tradeResults.push({
          ticker: item.stock.ticker,
          action: 'QUEUED_LIVE',
          score: philosophy.total,
          mos: iv.marginOfSafety,
          reason: 'Live execution requires Schwab account connected in Settings',
        })
      }
    } catch (err: any) {
      tradeResults.push({ ticker: item.stock.ticker, action: 'ERROR', reason: err.message })
    }
  }

  // ── Step 3: Check sell signals on open positions ──────────────────────────
  const openPositions = await prisma.paperPortfolioItem.findMany({
    where: { isOpen: true },
    include: { stock: true },
  })

  const sellResults: any[] = []
  for (const pos of openPositions) {
    try {
      const f = await getCompleteFundamentals(pos.stock.ticker)
      const posIv = calculateIntrinsicValue(f, f.sharesOutstanding)
      const posNews = await getTickerNews(pos.stock.ticker).catch(() => undefined)
      const sellSignal = scoreSellDecision(f, posIv, posNews, pos.mosAtPurchase ?? undefined)

      if (sellSignal.shouldSell) {
        await prisma.paperPortfolioItem.update({
          where: { id: pos.id },
          data: {
            isOpen: false,
            closePrice: f.price,
            closedAt: new Date(),
            closeReason: sellSignal.reason,
          },
        })
        await prisma.alert.create({
          data: {
            ticker: pos.stock.ticker,
            type: 'paper_sell',
            message: `PAPER SELL: ${pos.stock.ticker} @ $${f.price.toFixed(2)} — ${sellSignal.reason}`,
            severity: sellSignal.urgency === 'immediate' ? 'danger' : 'warning',
          },
        })
        sellResults.push({ ticker: pos.stock.ticker, action: 'PAPER_SELL', reason: sellSignal.reason, urgency: sellSignal.urgency, price: f.price })
        await Promise.all([
          sendTradeNotification({ type: 'sell', ticker: pos.stock.ticker, shares: pos.shares, price: f.price, reason: sellSignal.reason }).catch(() => {}),
          pushTradeNotification({ type: 'sell', ticker: pos.stock.ticker, shares: pos.shares, price: f.price, reason: sellSignal.reason }).catch(() => {}),
          ...(sellSignal.vetoSell ? [
            sendVetoAlert({ ticker: pos.stock.ticker, reason: sellSignal.reason, isHeld: true }).catch(() => {}),
            pushVetoAlert({ ticker: pos.stock.ticker, reason: sellSignal.reason, isHeld: true }).catch(() => {}),
          ] : []),
        ])
      }
      await new Promise(r => setTimeout(r, 200))
    } catch { /* skip */ }
  }

  const summary = {
    ranAt: new Date().toISOString(),
    mode: config.mode,
    scanDurationMs: Date.now() - scanStart,
    // Scan phase
    candidatesScanned: toAnalyse.length,
    newlyPromoted: promoted,
    // Trade phase
    watchlistScanned: watchlist.length,
    buys: tradeResults.filter(r => r.action.includes('BUY')).length,
    skipped: tradeResults.filter(r => r.action === 'SKIP').length,
    vetoed: tradeResults.filter(r => r.action === 'VETOED').length,
    results: tradeResults,
    sells: sellResults.length, sellResults,
  }

  await Promise.all([
    sendRunSummary({ buys: summary.buys, sells: summary.sells ?? 0, vetoed: summary.vetoed, skipped: summary.skipped, newWatchlist: summary.newlyPromoted, results: summary.results, mode: summary.mode }).catch(() => {}),
    pushRunSummary({ buys: summary.buys, sells: summary.sells ?? 0, vetoed: summary.vetoed, newWatchlist: summary.newlyPromoted, mode: summary.mode }).catch(() => {}),
  ])

  await prisma.autopilotConfig.update({
    where: { id: 'singleton' },
    data: { lastRunAt: new Date(), lastRunResult: summary },
  })

  // Snapshot portfolio for performance tracking
  try {
    await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/performance`, { method: 'POST' })
  } catch { /* best effort */ }

  return Response.json(summary)
}
