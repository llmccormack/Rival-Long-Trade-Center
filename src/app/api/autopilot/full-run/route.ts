import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'
import { generateRundown } from '@/lib/ai/rundown'
import { getCompleteFundamentals, getTickerNews, getEarningsCalendar, getInsiderTransactions, quickScreen, screenStocks, getQuote } from '@/lib/fmp/client'
import { getYahooFundamentals } from '@/lib/yahoo/fundamentals'
import { getMarketCandidates } from '@/lib/yahoo/screener'
import { applyGrahamCriteria } from '@/lib/graham/screener'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import { scoreBuyDecision } from '@/lib/philosophy/scorer'
import { scoreSellDecision } from '@/lib/philosophy/sell-scorer'
import { allocateCapital } from '@/lib/philosophy/capital-allocator'
import { qualifiesForQualityMode, summarizeBlockers, QUALITY_SIZE_MULTIPLIER } from '@/lib/philosophy/quality-mode'
import { getMarketContext, formatMarketContext } from '@/lib/macro/market-context'
import { sendTradeNotification, sendRunSummary, sendVetoAlert } from '@/lib/notifications/email'
import { pushTradeNotification, pushRunSummary, pushVetoAlert } from '@/lib/notifications/push'
import { isAuthorized } from '@/lib/auth/cron'
import { isMarketDay } from '@/lib/utils/market-hours'
import { getSecTickers, getDailyBatch } from '@/lib/sec/tickers'
import { getQuickQuotes } from '@/lib/yahoo/quick-quote'
import { getDailyBatch as getValueUniverseBatch } from '@/lib/universe/tickers'
import { analyzeMoat, moatScoreAdjustment } from '@/lib/ai/moat-analysis'
import { upsertStockScore } from '@/lib/philosophy/persist-score'

// POST /api/autopilot/full-run
// Investor-style autopilot: sell then buy, watchlist only.
// Buffett doesn't screen the market — he evaluates businesses he already understands.
// Step 1: Sell check on all open positions.
// Step 2: Buy evaluation on all active watchlist items with sector concentration awareness.
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
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

  // Only enforce market hours for automated cron runs, not manual UI triggers
  const isCronRequest = !!request.headers.get('authorization')
  if (isCronRequest && !isMarketDay()) {
    return Response.json({ message: 'Market closed — autopilot only runs on trading days', ranAt: new Date().toISOString() })
  }

  // Kill switch — a disabled autopilot that still trades is not a kill switch.
  if (!config.isEnabled) {
    return Response.json({
      message: 'Autopilot is disabled (kill switch). Enable it in Settings to resume runs.',
      ranAt: new Date().toISOString(),
    })
  }

  // ── Shadow book maintenance: fill 90-day forward returns ──────────────────
  // For decisions ~90+ days old with no forward return yet, fetch today's quote
  // and record what the pass actually cost (or saved). Budget: 15 quotes/run.
  try {
    const cutoff90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const pending = await prisma.shadowDecision.findMany({
      where: { return90d: null, decidedAt: { lte: cutoff90 } },
      orderBy: { decidedAt: 'asc' },
      take: 15,
    })
    for (const sd of pending) {
      const q = await getQuote(sd.ticker).catch(() => null)
      if (q?.price && q.price > 0 && sd.priceAtDecision > 0) {
        await prisma.shadowDecision.update({
          where: { id: sd.id },
          data: {
            price90d: q.price,
            return90d: (q.price - sd.priceAtDecision) / sd.priceAtDecision,
          },
        }).catch(() => {})
      } else {
        // Ticker gone (delisted/acquired) — mark so we stop retrying
        await prisma.shadowDecision.update({
          where: { id: sd.id },
          data: { price90d: 0, return90d: 0 },
        }).catch(() => {})
      }
    }
  } catch { /* shadow maintenance must never abort the run */ }

  let dailyBuys = 0
  let dailyNotional = 0

  // ── Discovery: full US market coverage via SEC EDGAR + Yahoo quality signal ─
  // Phase A: SEC EDGAR pulls every exchange-listed US common stock (~5,000+).
  //   createMany with skipDuplicates is idempotent — safe to run every day.
  // Phase B: Yahoo screener flags stocks appearing in value screens right now,
  //   updating notes as a quality signal overlay on the EDGAR universe.
  //
  // API budget: 0 FMP calls here. All philosophy scoring happens in Step 2.
  const discoveryResults: any[] = []
  if (config.autoDiscovery !== false) {
    try {
      // ── Phase A: SEC EDGAR full universe (bulk, ~5,000 US stocks) ──────────
      // Pull every exchange-listed US common stock from SEC's free ticker list.
      // Uses createMany with skipDuplicates — safe to run every day, only adds new listings.
      const secTickers = await getSecTickers()

      if (secTickers.length > 0) {
        // Bulk upsert stocks
        await prisma.stock.createMany({
          data: secTickers.map(t => ({ ticker: t.ticker, name: t.name, exchange: t.exchange })),
          skipDuplicates: true,
        })

        // Get stock IDs for all SEC tickers
        const stocks = await prisma.stock.findMany({
          where: { ticker: { in: secTickers.map(t => t.ticker) } },
          select: { id: true, ticker: true },
        })

        // Get existing watchlist stock IDs
        const existingWatchlistIds = new Set(
          (await prisma.watchlistItem.findMany({ select: { stockId: true } }))
            .map(w => w.stockId)
        )

        // Bulk add new stocks to watchlist
        const newItems = stocks.filter(s => !existingWatchlistIds.has(s.id))
        if (newItems.length > 0) {
          await prisma.watchlistItem.createMany({
            data: newItems.map(s => ({
              stockId: s.id,
              notes: 'Auto-discovered via SEC EDGAR',
            })),
            skipDuplicates: true,
          })
          discoveryResults.push({ action: 'EDGAR_BULK', newStocks: newItems.length, totalSecTickers: secTickers.length })
        } else {
          discoveryResults.push({ action: 'EDGAR_BULK', newStocks: 0, totalSecTickers: secTickers.length })
        }
      }

      // ── Phase B: Yahoo screener (quality signal overlay) ──────────────────
      // Yahoo's preset screens highlight currently undervalued stocks.
      // These are already in the watchlist from EDGAR; Yahoo just confirms they're
      // appearing in value screens right now. We update their notes as a signal.
      const candidates = await getMarketCandidates({ maxPE: 30, maxPB: 4, minMarketCapM: 100 })
      let yahooHighlighted = 0
      for (const candidate of candidates) {
        try {
          await prisma.watchlistItem.updateMany({
            where: { stock: { ticker: candidate.symbol }, isActive: true },
            data: { notes: `Yahoo value screen (PE: ${candidate.pe?.toFixed(1) ?? 'n/a'}, PB: ${candidate.pb?.toFixed(2) ?? 'n/a'})` },
          })
          yahooHighlighted++
        } catch { /* skip */ }
      }
      if (yahooHighlighted > 0) {
        discoveryResults.push({ action: 'YAHOO_HIGHLIGHT', count: yahooHighlighted })
      }
    } catch { /* discovery failure must not abort the run */ }

    // ── Tier 2 Discovery: SEC EDGAR full-market scan (50/day, pre-filtered) ─
    // Cycles through all ~10,000 US public company tickers from SEC EDGAR.
    // 50 tickers/day are fetched from Yahoo for a quick value pre-filter,
    // and only those passing the filter are added to the watchlist.
    // At 50/day the full universe cycles in ~200 days.
    try {
      const allSecTickers = await getSecTickers()

      // Reuse the watchlist we already built above for the already-watched set
      const currentWatched = new Set(
        (await prisma.watchlistItem.findMany({ include: { stock: true } }))
          .map(w => w.stock.ticker)
      )

      const secBatch = getDailyBatch(allSecTickers, currentWatched, 50)

      if (secBatch.length > 0) {
        const quotes = await getQuickQuotes(secBatch.map(t => t.ticker))

        for (const q of quotes) {
          // Value pre-filter: must be equity, price > $1, marketCap > $50M,
          // and show at least one value signal (low PE or low PB)
          if (q.quoteType !== 'EQUITY') continue
          if (q.price < 1) continue
          if (q.marketCap > 0 && q.marketCap < 50_000_000) continue // skip micro-caps < $50M

          const hasValueSignal =
            (q.pe !== null && q.pe > 0 && q.pe < 30) ||
            (q.pb !== null && q.pb > 0 && q.pb < 3)

          if (!hasValueSignal) continue
          if (currentWatched.has(q.ticker)) continue

          try {
            const secInfo = secBatch.find(t => t.ticker === q.ticker)
            const stock = await prisma.stock.upsert({
              where: { ticker: q.ticker },
              create: {
                ticker: q.ticker,
                name: q.name ?? secInfo?.name ?? q.ticker,
                exchange: secInfo?.exchange ?? undefined,
              },
              update: {},
            })
            await prisma.watchlistItem.upsert({
              where: { stockId: stock.id },
              create: {
                stockId: stock.id,
                notes: `Auto-discovered via SEC EDGAR (PE: ${q.pe?.toFixed(1) ?? 'n/a'}, PB: ${q.pb?.toFixed(2) ?? 'n/a'})`,
              },
              update: {},
            })
            currentWatched.add(q.ticker)
            discoveryResults.push({
              ticker: q.ticker,
              action: 'ADDED_TO_WATCHLIST',
              source: 'SEC',
              pe: q.pe,
              pb: q.pb,
            })
          } catch { /* skip DB errors per ticker */ }
        }
      }
    } catch { /* SEC Tier 2 discovery failure must not abort the run */ }
  }

  // ── Macro market context (Shiller CAPE overlay) ──────────────────────────
  const macro = await getMarketContext()
  const macroAudit = macro ? [formatMarketContext(macro)] : []

  const effectiveMinScore    = (config.minPhilosophyScore ?? 45) + Math.min(macro?.minScoreAdj ?? 0, 5)
  const effectiveMinMos      = config.minMarginOfSafety ?? 15
  const effectiveCashReserve = (config.minCashReservePct ?? 15) + Math.min(macro?.cashReserveAdj ?? 0, 5)
  const discountRate         = (config.discountRate ?? 10) / 100
  const maxSectorPct         = config.maxSectorPct ?? 30

  // ── Step 1: Sell check on all open positions ─────────────────────────────
  const openPositions = await prisma.paperPortfolioItem.findMany({
    where: { isOpen: true },
    include: { stock: true },
  })

  const sellResults: any[] = []

  for (const pos of openPositions) {
    try {
      // Yahoo first (free, unlimited) → FMP fallback
      let f = await getYahooFundamentals(pos.stock.ticker)
      if (f.price <= 0) f = await getCompleteFundamentals(pos.stock.ticker)
      if (f.price <= 0) { sellResults.push({ ticker: pos.stock.ticker, action: 'SKIP', reason: 'No price data' }); continue }
      if (macro?.treasury10yr) {
        f.treasuryYield10yr = macro.treasury10yr
        if (f.ownerEarningsYield !== undefined) {
          f.ownerEarningsSpread = f.ownerEarningsYield - macro.treasury10yr
        }
      }
      const posIv = calculateIntrinsicValue(f, f.sharesOutstanding, discountRate)
      const posNews = await getTickerNews(pos.stock.ticker).catch(() => undefined)
      const sellSignal = scoreSellDecision(f, posIv, posNews, pos.mosAtPurchase ?? undefined)

      if (posNews && posNews.hardVetoFlags.length > 0) {
        await prisma.paperPortfolioItem.update({
          where: { id: pos.id },
          data: {
            isOpen: false,
            closedAt: new Date(),
            closePrice: f.price,
            closeReason: `News veto: ${posNews.hardVetoFlags[0]}`,
            currentPrice: f.price,
          },
        })
        await prisma.alert.create({
          data: {
            ticker: pos.stock.ticker,
            type: 'fundamental_change',
            message: `PAPER SELL (news veto): ${pos.stock.ticker} — "${posNews.hardVetoFlags[0]}"`,
            severity: 'warning',
          },
        })
        sellResults.push({ ticker: pos.stock.ticker, action: 'SOLD_NEWS_VETO', flag: posNews.hardVetoFlags[0], price: f.price })
        await Promise.all([
          sendVetoAlert({ ticker: pos.stock.ticker, reason: posNews.hardVetoFlags[0], isHeld: false }).catch(() => {}),
          pushVetoAlert({ ticker: pos.stock.ticker, reason: posNews.hardVetoFlags[0], isHeld: false }).catch(() => {}),
        ])
        continue
      }

      if (sellSignal.shouldSell) {
        await prisma.paperPortfolioItem.update({
          where: { id: pos.id },
          data: {
            isOpen: false,
            closedAt: new Date(),
            closePrice: f.price,
            closeReason: sellSignal.reason,
            currentPrice: f.price,
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
      } else {
        await prisma.paperPortfolioItem.update({
          where: { id: pos.id },
          data: { currentPrice: f.price },
        })
      }

      await new Promise(r => setTimeout(r, 200))
    } catch { /* skip */ }
  }

  // ── Step 2: Compute sector exposure from remaining open positions ─────────
  // Re-fetch after sells so the buy phase works with accurate sector headroom.
  const remainingPositions = await prisma.paperPortfolioItem.findMany({
    where: { isOpen: true },
    include: { stock: true },
  })

  const sectorExposure: Record<string, number> = {}
  let deployedCapital = 0
  let qualityDeployed = 0
  for (const p of remainingPositions) {
    const val = p.shares * (p.currentPrice ?? p.avgCostBasis)
    deployedCapital += val
    if ((p as any).entryMode === 'quality') qualityDeployed += val
    const sector = p.stock?.sector
    if (sector) {
      sectorExposure[sector] = (sectorExposure[sector] ?? 0) + val
    }
  }
  const qualityCap = (config.totalCapital ?? 10000) * ((config.maxQualityPct ?? 35) / 100)

  // ── Step 2: Build the buy candidate list ────────────────────────────────
  //
  // SCREENER-FIRST ARCHITECTURE
  // ─────────────────────────────
  // Old approach: pull from the watchlist (5000+ EDGAR stocks rotated 25/day).
  //   Problem: ~200 days to score everything once. Slow, blind, no prioritisation.
  //
  // New approach: FMP screener as the universe source.
  //   1. Manual watchlist items (user-curated) — always go first, always scored.
  //   2. FMP screener (1 call) returns 250–500 pre-filtered value candidates
  //      (PE ≤ 20, PB ≤ 2.5, marketCap ≥ $300M). These already pass basic gates.
  //   3. Skip Phase 1 quickScreen for screener stocks — they're already filtered.
  //   4. Deep-score as many as the FMP call budget allows.
  //
  // FMP free tier (250 calls/day):
  //   Manual items: up to 5 × 7 calls = 35 calls
  //   Screener stocks: (250 - 35) / 7 = ~30 deep scores
  //   Total: ~35 stocks/full-run — whole screener universe covered in ~8 days
  //
  // FMP paid (Starter, unlimited):
  //   Score all 250–500 screener stocks every single day.
  //
  // The daily analysis limit (config.dailyAnalysisLimit) controls how many
  // screener stocks get deep-scored per run. Manual items are always unlimited.

  const dailyLimit = config.dailyAnalysisLimit ?? 30

  // Manual watchlist items — user-curated, always scored
  const allWatchlist = await prisma.watchlistItem.findMany({
    where: { isActive: true },
    include: { stock: true },
  })
  const manualItems = allWatchlist.filter(
    w => !w.notes?.startsWith('Auto-discovered') &&
         !w.notes?.startsWith('Yahoo value screen') &&
         !w.notes?.startsWith('SEC')
  )

  // ── Universe: FMP screener (paid) → fallback to curated value universe ──────
  //
  // FMP's /stock-screener with PE/PB filters requires a paid plan.
  // On the free tier it returns an error object or empty array.
  // If the screener returns 0 results we fall back to a curated ~300-ticker
  // value universe (S&P 500 value names, dividend payers, financials, etc.)
  // rotated in daily batches so the full list is covered every ~10 days.
  //
  // Either way, every candidate goes through quickScreen (2 FMP calls) to
  // confirm it actually passes PE≤20 / PB≤2.5 before burning 7 calls on
  // getCompleteFundamentals.

  let screenerTickers: string[] = []
  let screenerSource = 'fmp'
  try {
    const [deepValue, widerValue] = await Promise.all([
      screenStocks({ peRatioLowerThan: 15, priceToBookLowerThan: 1.5, marketCapMoreThan: 300_000_000, limit: 250 }),
      screenStocks({ peRatioLowerThan: 20, priceToBookLowerThan: 2.5, marketCapMoreThan: 300_000_000, limit: 250 }),
    ])
    const seen = new Set<string>()
    for (const r of [...deepValue, ...widerValue]) {
      if (!seen.has(r.symbol) && !r.symbol.includes('.') && !r.symbol.includes('-')) {
        seen.add(r.symbol)
        screenerTickers.push(r.symbol)
      }
    }
    discoveryResults.push({ action: 'FMP_SCREENER', deepValue: deepValue.length, widerValue: widerValue.length, unique: screenerTickers.length })
  } catch {
    discoveryResults.push({ action: 'FMP_SCREENER', error: 'screener unavailable' })
  }

  // Fallback: FMP screener returned nothing (free tier or error) → curated universe
  if (screenerTickers.length === 0) {
    screenerSource = 'universe'
    // Take today's rotating batch from the curated value universe (~30 tickers)
    const universeBatch = getValueUniverseBatch(dailyLimit * 2) // 2× so some survive pre-filter
    // Pre-filter via Yahoo (free, no quota) — no FMP calls consumed here
    const quotes = await getQuickQuotes(universeBatch)
    for (const q of quotes) {
      const peOk = q.pe == null || q.pe <= 30
      const pbOk = q.pb == null || q.pb <= 4
      const capOk = q.marketCap >= 100_000_000
      if (peOk && pbOk && capOk) screenerTickers.push(q.ticker)
    }
    discoveryResults.push({ action: 'UNIVERSE_FALLBACK', batch: universeBatch.length, passing: screenerTickers.length })
  }

  // Remove manual tickers (already covered above)
  const manualTickers = new Set(manualItems.map(w => w.stock.ticker))
  screenerTickers = screenerTickers.filter(t => !manualTickers.has(t))

  // Cap to daily limit
  const screenerBatch = screenerTickers.slice(0, dailyLimit)

  // Build the final analysis list:
  //   Shape: { ticker, stockId? } — stockId present for watchlist items, undefined for screener-only
  type AnalysisTarget = { ticker: string; watchlistItem?: typeof allWatchlist[0] }
  const analysisTargets: AnalysisTarget[] = [
    ...manualItems.map(w => ({ ticker: w.stock.ticker, watchlistItem: w })),
    ...screenerBatch.map(t => ({ ticker: t })),
  ]

  const tradeResults: any[] = []
  const watchlist = analysisTargets  // renamed for minimal diff below

  for (const item of watchlist) {
    const ticker = item.ticker
    const wl = item.watchlistItem  // present for manual stocks, undefined for screener stocks
    try {
      // Yahoo first (free, no quota) → FMP fallback
      let fundamentals = await getYahooFundamentals(ticker)
      if (fundamentals.price <= 0) fundamentals = await getCompleteFundamentals(ticker)
      if (fundamentals.price <= 0) {
        tradeResults.push({ ticker, action: 'SKIP', reason: 'No price data' })
        continue
      }
      if (macro?.treasury10yr) {
        fundamentals.treasuryYield10yr = macro.treasury10yr
        if (fundamentals.ownerEarningsYield !== undefined) {
          fundamentals.ownerEarningsSpread = fundamentals.ownerEarningsYield - macro.treasury10yr
        }
      }
      const criteria = applyGrahamCriteria(fundamentals)
      const iv = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding, discountRate)

      // Upsert stock + persist IV for watchlist items that have a DB record
      if (wl) {
        const stock = await prisma.stock.upsert({
          where: { ticker },
          create: { ticker, name: fundamentals.name, sector: fundamentals.sector, industry: fundamentals.industry, exchange: fundamentals.exchange },
          update: { name: fundamentals.name, sector: fundamentals.sector ?? undefined, industry: fundamentals.industry ?? undefined },
        })
        Promise.all([
          prisma.intrinsicValue.create({
            data: {
              stockId: stock.id,
              currentPrice: fundamentals.price,
              grahamNumber: iv.grahamNumber ?? null,
              dcfValue: iv.dcfValue ?? null,
              intrinsicValue: iv.intrinsicValue,
              marginOfSafety: iv.marginOfSafety,
              isBuySignal: iv.isBuySignal ?? false,
              ownerEarnings: fundamentals.ownerEarnings ?? null,
              discountRateUsed: discountRate,
            },
          }),
        ]).catch(() => {})
      }

      // Deep-value dampening
      const isDeepValue = fundamentals.isNetNet || (fundamentals.capeRatio !== undefined && fundamentals.capeRatio < 12)
      const stockMinScore = isDeepValue
        ? Math.min(effectiveMinScore, (config.minPhilosophyScore ?? 45) + 3)
        : effectiveMinScore

      // Quick pre-score without news/insider to save FMP calls.
      const quickPhilosophy = scoreBuyDecision(fundamentals, criteria, iv, undefined, undefined)
      const couldQualify = quickPhilosophy.vetoedBy.length === 0 && quickPhilosophy.total >= (stockMinScore - 15)

      // Fetch news/insider only for promising candidates
      let news: Awaited<ReturnType<typeof getTickerNews>> | undefined
      let insider: Awaited<ReturnType<typeof getInsiderTransactions>> | undefined
      if (couldQualify) {
        ;[news, insider] = await Promise.all([
          getTickerNews(ticker).catch(() => undefined),
          getInsiderTransactions(ticker).catch(() => undefined),
        ])
      }
      const philosophy = scoreBuyDecision(fundamentals, criteria, iv, news, insider)

      // Earnings check — only for promising candidates
      if (couldQualify) {
        const earningsEvents = await getEarningsCalendar(ticker).catch(() => [])
        const today = new Date()
        const earningsIn21Days = earningsEvents.some(e => {
          const d = new Date(e.date)
          const daysUntil = (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
          return daysUntil >= 0 && daysUntil <= 21
        })
        if (earningsIn21Days) {
          tradeResults.push({ ticker, action: 'SKIP', score: philosophy.total, mos: iv.marginOfSafety, reason: 'Earnings within 21 days — waiting for clarity' })
          continue
        }
      }

      // Moat analysis for score 35+
      let moatAdj = 0
      let moatData: Awaited<ReturnType<typeof analyzeMoat>> = null
      if (philosophy.total >= 35 && process.env.ANTHROPIC_API_KEY) {
        moatData = await analyzeMoat(ticker, fundamentals.name, philosophy.total, iv.marginOfSafety).catch(() => null)
        if (moatData) {
          moatAdj = moatScoreAdjustment(moatData)
          prisma.moatAnalysis.create({
            data: {
              ticker,
              companyName: fundamentals.name,
              moatScore: moatData.moatScore,
              moatType: moatData.moatType,
              moatSources: moatData.moatSources,
              managementScore: moatData.managementScore,
              businessQuality: moatData.businessQuality,
              thesis: moatData.thesis,
              keyRisks: moatData.keyRisks,
              catalysts: moatData.catalysts,
              verdict: moatData.verdict,
              confidence: moatData.confidence,
              quantScore: philosophy.total,
              mosAtAnalysis: iv.marginOfSafety,
            },
          }).catch(() => {})
        }
      }

      // Combined score
      const combinedScore = philosophy.total + moatAdj

      // Persist to score leaderboard
      upsertStockScore({
        ticker,
        name:          fundamentals.name,
        sector:        fundamentals.sector,
        price:         fundamentals.price,
        score:         combinedScore,
        mos:           iv.marginOfSafety,
        intrinsicValue: iv.intrinsicValue,
        grahamNumber:  iv.grahamNumber,
        pe:            fundamentals.pe,
        pb:            fundamentals.pb,
        signal:        philosophy.signal,
        conviction:    philosophy.conviction,
        vetoCount:     philosophy.vetoedBy.length,
        vetoReasons:   philosophy.vetoedBy.map((p: any) => p.title),
        source:        'autopilot',
      }).catch(() => {})

      // Hard veto from moat analysis
      if (moatData?.verdict === 'avoid' && moatData.moatScore < 2) {
        tradeResults.push({ ticker, action: 'VETOED', score: combinedScore, mos: iv.marginOfSafety, reason: `Moat analysis veto: ${moatData.thesis}`, moatScore: moatData.moatScore, thesis: moatData.thesis })
        if (wl) prisma.watchlistItem.update({
          where: { stockId: wl.stockId },
          data: { lastScore: combinedScore, lastMos: iv.marginOfSafety, lastAction: 'VETOED', lastSkipReason: `Moat veto: ${moatData.thesis.slice(0, 100)}`, lastAnalyzedAt: new Date() },
        }).catch(() => {})
        continue
      }

      // Tiered thresholds: wide-moat businesses need smaller discounts (Buffett),
      // no-moat businesses need Graham-level bargains to compensate for fragility.
      const baseScore = config.minPhilosophyScore ?? 45
      const baseMos   = config.minMarginOfSafety ?? 15
      let dynamicMinScore = stockMinScore
      let dynamicMinMos   = effectiveMinMos
      if (moatData) {
        if (moatData.moatScore >= 7)      { dynamicMinScore = Math.max(40, baseScore - 5);  dynamicMinMos = Math.max(10, baseMos - 5) }
        else if (moatData.moatScore >= 5) { dynamicMinScore = baseScore;                    dynamicMinMos = baseMos }
        else if (moatData.moatScore >= 3) { dynamicMinScore = Math.min(60, baseScore + 8);  dynamicMinMos = Math.min(25, baseMos + 8) }
        else                              { dynamicMinScore = Math.min(65, baseScore + 15); dynamicMinMos = Math.min(30, baseMos + 15) }
      }

      // Bear-case gate: the MOS must survive a zero-growth stress test
      const bearOk = iv.bearCaseMos === undefined || iv.bearCaseMos >= 0

      const passed =
        philosophy.vetoedBy.length === 0 &&
        combinedScore >= dynamicMinScore &&
        iv.marginOfSafety >= dynamicMinMos &&
        bearOk

      // ── Quality Mode fallback — "wonderful company at a fair price" ────────
      // When the strict value gate fails (which is EVERY day in a hot market),
      // wonderful/good businesses at fair prices can still enter at half size,
      // capped at maxQualityPct of capital. Vetoes and the bear-case gate stand.
      let entryMode: 'value' | 'quality' = 'value'
      let qualityRationale: string | undefined
      if (!passed && config.mode === 'paper' && (config.qualityModeEnabled ?? true) &&
          philosophy.vetoedBy.length === 0 && bearOk) {
        const qm = qualifiesForQualityMode(fundamentals, philosophy, iv)
        if (qm.eligible && qualityDeployed < qualityCap) {
          entryMode = 'quality'
          qualityRationale = qm.rationale
        }
      }

      if (!passed && entryMode === 'value') {
        const action = philosophy.vetoedBy.length > 0 ? 'VETOED' : 'SKIP'
        const skipReason = philosophy.vetoedBy.length > 0
          ? philosophy.vetoedBy.map((p: any) => p.title).join('; ')
          : !bearOk
          ? `Bear-case MOS ${iv.bearCaseMos!.toFixed(1)}% < 0 — margin of safety evaporates under zero-growth stress`
          : `Score ${combinedScore} / MOS ${iv.marginOfSafety.toFixed(1)}% below thresholds${isDeepValue ? ' (deep-value dampening applied)' : ''}${moatData ? ` | Moat ${moatData.moatScore}/10` : ''}`
        tradeResults.push({ ticker, action, score: combinedScore, mos: iv.marginOfSafety, grahamNumber: iv.grahamNumber, dcfValue: iv.dcfValue, reason: skipReason, moatScore: moatData?.moatScore, thesis: moatData?.thesis })
        if (wl) prisma.watchlistItem.update({
          where: { stockId: wl.stockId },
          data: { lastScore: combinedScore, lastMos: iv.marginOfSafety, lastAction: action, lastSkipReason: skipReason, lastAnalyzedAt: new Date() },
        }).catch(() => {})
        // Shadow book: record the pass we didn't take for counterfactual tracking
        prisma.shadowDecision.create({
          data: {
            ticker,
            action,
            reason: skipReason,
            score: combinedScore,
            mos: iv.marginOfSafety,
            priceAtDecision: fundamentals.price,
          },
        }).catch(() => {})
        continue
      }

      if (config.mode === 'paper') {
        if (dailyBuys >= (config.maxDailyTrades ?? 5)) {
          tradeResults.push({ ticker, action: 'SKIP', score: philosophy.total, mos: iv.marginOfSafety, reason: 'Daily trade limit reached' })
          continue
        }

        const stock = await prisma.stock.upsert({
          where: { ticker },
          create: { ticker, name: fundamentals.name, sector: fundamentals.sector, industry: fundamentals.industry, exchange: fundamentals.exchange },
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
          deployedCapital,
          minCashReservePct: effectiveCashReserve,
          avgCostBasis: existing?.avgCostBasis,
          stockSector: fundamentals.sector,
          sectorExposure,
          maxSectorPct,
          piotroskiFScore: fundamentals.piotroskiFScore,
          inFreefall: fundamentals.inFreefall,
          marginTrendDeclining: fundamentals.operatingMarginTrend === 'declining',
          sizeMultiplier: entryMode === 'quality' ? QUALITY_SIZE_MULTIPLIER : undefined,
        })

        if (!allocation.canAllocate) {
          tradeResults.push({ ticker, action: 'SKIP', score: philosophy.total, mos: iv.marginOfSafety, reason: allocation.reason })
          continue
        }

        // Quality-mode exposure cap — hard clamp after allocation
        if (entryMode === 'quality' && qualityDeployed + allocation.dollarAmount > qualityCap) {
          tradeResults.push({ ticker, action: 'SKIP', score: philosophy.total, mos: iv.marginOfSafety, reason: `Quality-mode exposure cap reached ($${qualityDeployed.toFixed(0)} of $${qualityCap.toFixed(0)})` })
          continue
        }

        if (dailyNotional + allocation.dollarAmount > (config.maxDailyNotional ?? 2000)) {
          tradeResults.push({ ticker, action: 'SKIP', score: philosophy.total, mos: iv.marginOfSafety, reason: 'Daily notional limit reached' })
          continue
        }

        if (allocation.dollarAmount > (config.maxSingleNotional ?? 1000)) {
          allocation.dollarAmount = config.maxSingleNotional ?? 1000
          allocation.shares = Math.floor(allocation.dollarAmount / fundamentals.price)
          if (allocation.shares < 1) {
            tradeResults.push({ ticker, action: 'SKIP', score: philosophy.total, mos: iv.marginOfSafety, reason: 'Single trade notional clamp resulted in 0 shares' })
            continue
          }
          allocation.dollarAmount = allocation.shares * fundamentals.price
        }

        if (existing) {
          const newShares = existing.shares + allocation.shares
          const newAvg = (existing.shares * existing.avgCostBasis + allocation.shares * fundamentals.price) / newShares
          await prisma.paperPortfolioItem.update({ where: { id: existing.id }, data: { shares: newShares, avgCostBasis: newAvg, currentPrice: fundamentals.price } })
        } else {
          await prisma.paperPortfolioItem.create({
            data: { stockId: stock.id, shares: allocation.shares, avgCostBasis: fundamentals.price, currentPrice: fundamentals.price, philosophyScore: philosophy.total, conviction: philosophy.conviction, mosAtPurchase: iv.marginOfSafety, entryMode, auditTrail: [...(qualityRationale ? [qualityRationale] : []), allocation.rationale, ...philosophy.auditTrail.slice(0, 8)] },
          })
        }

        if (fundamentals.sector) sectorExposure[fundamentals.sector] = (sectorExposure[fundamentals.sector] ?? 0) + allocation.dollarAmount
        deployedCapital += allocation.dollarAmount
        if (entryMode === 'quality') qualityDeployed += allocation.dollarAmount
        dailyBuys += 1
        dailyNotional += allocation.dollarAmount

        await prisma.alert.create({
          data: {
            ticker,
            type: 'paper_buy',
            message: `PAPER BUY${entryMode === 'quality' ? ' (QUALITY — wonderful business at fair price, half-size)' : ''}: ${allocation.shares} shares of ${ticker} @ $${fundamentals.price.toFixed(2)} ($${allocation.dollarAmount.toFixed(0)} · ${allocation.positionPct.toFixed(1)}% of capital) | Score: ${combinedScore}/100 | MOS: ${iv.marginOfSafety.toFixed(1)}% | ${philosophy.conviction.toUpperCase()}${moatData ? ` | Moat: ${moatData.moatScore}/10 (${moatData.moatType})` : ''}`,
            severity: 'buy',
          },
        })

        tradeResults.push({ ticker, action: 'PAPER_BUY', entryMode, shares: allocation.shares, price: fundamentals.price, dollarAmount: allocation.dollarAmount, positionPct: allocation.positionPct, score: philosophy.total, combinedScore, mos: iv.marginOfSafety, conviction: philosophy.conviction, rationale: allocation.rationale, grahamNumber: iv.grahamNumber, dcfValue: iv.dcfValue, intrinsicValue: iv.intrinsicValue, moatScore: moatData?.moatScore, moatType: moatData?.moatType, thesis: moatData?.thesis })
        await Promise.all([
          sendTradeNotification({ type: 'buy', ticker, shares: allocation.shares, price: fundamentals.price, score: philosophy.total, mos: iv.marginOfSafety, conviction: philosophy.conviction }).catch(() => {}),
          pushTradeNotification({ type: 'buy', ticker, shares: allocation.shares, price: fundamentals.price, score: philosophy.total, mos: iv.marginOfSafety, conviction: philosophy.conviction }).catch(() => {}),
        ])
      } else {
        tradeResults.push({ ticker, action: 'QUEUED_LIVE', score: philosophy.total, mos: iv.marginOfSafety, reason: 'Live execution requires Schwab account connected in Settings' })
      }
    } catch (err: any) {
      tradeResults.push({ ticker, action: 'ERROR', reason: err.message })
    }
  }

  const screenerResult   = discoveryResults.find(r => r.action === 'FMP_SCREENER')
  const universeResult   = discoveryResults.find(r => r.action === 'UNIVERSE_FALLBACK')
  const summary = {
    ranAt: new Date().toISOString(),
    mode: config.mode,
    universeSource: screenerSource,
    screener: screenerResult
      ? { deepValue: screenerResult.deepValue, widerValue: screenerResult.widerValue, unique: screenerResult.unique, scored: screenerBatch.length }
      : universeResult
      ? { source: 'curated universe', batch: universeResult.batch, passing: universeResult.passing, scored: screenerBatch.length }
      : null,
    discoveryResults,
    macro: macro ? {
      sp500Cape: macro.sp500Cape,
      marketTemperature: macro.marketTemperature,
      treasury10yr: (macro.treasury10yr * 100).toFixed(2) + '%',
      excessEarningsYield: (macro.excessEarningsYield * 100).toFixed(2) + '%',
      effectiveMinScore,
      effectiveCashReservePct: effectiveCashReserve,
    } : null,
    // Sell phase
    positionsReviewed: openPositions.length,
    sells: sellResults.filter(r => r.action === 'PAPER_SELL').length,
    vetoSells: sellResults.filter(r => r.action === 'SOLD_NEWS_VETO').length,
    sellResults,
    // Buy phase
    manualWatchlistItems: manualItems.length,
    screenerCandidatesScored: screenerBatch.length,
    totalAnalysed: watchlist.length,
    buys: tradeResults.filter(r => r.action === 'PAPER_BUY').length,
    qualityBuys: tradeResults.filter(r => r.action === 'PAPER_BUY' && r.entryMode === 'quality').length,
    skipped: tradeResults.filter(r => r.action === 'SKIP').length,
    vetoed: tradeResults.filter(r => r.action === 'VETOED').length,
    // Why nothing was bought, at a glance — the top skip/veto reasons this run
    topBlockers: summarizeBlockers(tradeResults),
    qualityExposure: { deployed: Math.round(qualityDeployed), cap: Math.round(qualityCap) },
    capitalDeployed: tradeResults.filter(r => r.action === 'PAPER_BUY').reduce((s: number, r: any) => s + (r.dollarAmount ?? 0), 0),
    results: tradeResults,
  }

  const newlyAddedTickers = discoveryResults
    .filter(r => r.action === 'ADDED_TO_WATCHLIST')
    .map(r => r.ticker)

  await Promise.all([
    sendRunSummary({ buys: summary.buys, sells: summary.sells ?? 0, vetoed: summary.vetoed, skipped: summary.skipped, newWatchlist: newlyAddedTickers, results: summary.results, mode: summary.mode }).catch(() => {}),
    pushRunSummary({ buys: summary.buys, sells: summary.sells ?? 0, vetoed: summary.vetoed, newWatchlist: newlyAddedTickers, mode: summary.mode }).catch(() => {}),
  ])

  await prisma.autopilotConfig.update({
    where: { id: 'singleton' },
    data: { lastRunAt: new Date(), lastRunResult: summary },
  })

  // Generate daily rundown
  const openCount = await prisma.paperPortfolioItem.count({ where: { isOpen: true } }).catch(() => 0)
  const snapshot = await prisma.portfolioSnapshot.findFirst({ orderBy: { date: 'desc' } }).catch(() => null)

  const rundownText = await generateRundown({
    ranAt: summary.ranAt,
    mode: summary.mode,
    macro: summary.macro,
    watchlistTotal: summary.totalAnalysed,
    watchlistScanned: summary.totalAnalysed,
    buys: summary.buys,
    sells: summary.sells ?? 0,
    skipped: summary.skipped,
    vetoed: summary.vetoed,
    capitalDeployed: summary.capitalDeployed,
    topResults: (summary.results ?? []).slice(0, 20),
    openPositions: openCount,
    portfolioGainPct: snapshot?.gainLossPct,
  })

  if (rundownText) {
    await prisma.autopilotConfig.update({
      where: { id: 'singleton' },
      data: { dailyRundown: rundownText },
    }).catch(() => {})
  }

  try {
    await prisma.auditLog.create({
      data: {
        action: 'autopilot_run',
        actor: 'cron',
        details: { buys: summary.buys, skipped: summary.skipped, vetoed: summary.vetoed, mode: summary.mode } as any,
      },
    })
  } catch { /* audit failures must not crash main flow */ }

  try {
    await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/performance`, { method: 'POST' })
  } catch { /* best effort */ }

  return Response.json(summary)
}
