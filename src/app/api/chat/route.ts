// ─── AI Analyst Chat — tool-using agent ───────────────────────────────────────
//
// Previously a single-shot completion over a static context dump: it could not
// answer its own suggested questions ("why hasn't the bot bought anything?")
// because it never saw audit trails, skip reasons, or the shadow book — it
// improvised plausible answers instead of reporting recorded decisions.
//
// Now Claude gets tools that call the SAME production code the autopilot runs:
// live scoring with full audit trail, the last run's blockers, position
// theses, shadow-book counterfactuals, and income-inclusive performance.
// Rule one in the system prompt: look decisions up, never guess at them.

import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db/client'
import { getCompleteFundamentals } from '@/lib/fmp/client'
import { applyGrahamCriteria } from '@/lib/graham/screener'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import { scoreBuyDecision } from '@/lib/philosophy/scorer'
import { qualifiesForQualityMode } from '@/lib/philosophy/quality-mode'
import { getMarketContext } from '@/lib/macro/market-context'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MAX_TOOL_ROUNDS = 6

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'analyze_ticker',
    description:
      'Run the production philosophy engine on a ticker RIGHT NOW: live fundamentals, Graham criteria, intrinsic value (incl. bear-case stress test), the full 0-100 philosophy score with vetoes and audit trail, and quality-mode eligibility. Use for any question about a specific stock.',
    input_schema: {
      type: 'object' as const,
      properties: { ticker: { type: 'string', description: 'Stock ticker symbol, e.g. NUE' } },
      required: ['ticker'],
    },
  },
  {
    name: 'get_last_run',
    description:
      'The most recent autopilot run: buys, skips, vetoes, the TOP BLOCKERS (aggregated skip/veto reasons — the recorded answer to "why is the bot not buying"), macro context, and quality-mode exposure.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_position',
    description:
      'A specific portfolio position (open or most recently closed): entry mode (value vs quality), the audit trail recorded AT PURCHASE (the original thesis), dividends earned, and close reason if sold. Use before discussing why something was bought or sold.',
    input_schema: {
      type: 'object' as const,
      properties: { ticker: { type: 'string', description: 'Ticker of the position' } },
      required: ['ticker'],
    },
  },
  {
    name: 'get_shadow_stats',
    description:
      'Counterfactual data: what the stocks we SKIPPED or VETOED did afterwards (90-day forward returns). Answers whether the thresholds are adding or destroying value, and lists the biggest missed winners and best avoided losers.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_performance',
    description:
      'Portfolio performance with honest accounting: open/closed P&L, dividends accrued, T-bill yield on idle cash, recent snapshots with SPY and VTV benchmark prices.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_watchlist',
    description:
      'Top watchlist candidates by score, INCLUDING the last recorded skip reason for each — shows exactly what each stock is failing on and which are closest to qualifying.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_journal',
    description:
      'The decision journal: AI post-mortems of closed trades (verdict on whether the thesis played out, was wrong, or the exit was the mistake — with lessons) and the latest weekly investor letter.',
    input_schema: { type: 'object' as const, properties: {} },
  },
]

// ─── Tool implementations ─────────────────────────────────────────────────────

async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'analyze_ticker': {
      const ticker = String(input.ticker ?? '').toUpperCase().trim()
      if (!ticker) return { error: 'ticker required' }
      const f = await getCompleteFundamentals(ticker)
      if (f.price <= 0) return { error: `No price data for ${ticker}` }
      const macro = await getMarketContext().catch(() => null)
      if (macro?.treasury10yr) {
        f.treasuryYield10yr = macro.treasury10yr
        if (f.ownerEarningsYield !== undefined) f.ownerEarningsSpread = f.ownerEarningsYield - macro.treasury10yr
      }
      const criteria = applyGrahamCriteria(f)
      const iv = calculateIntrinsicValue(f, f.sharesOutstanding)
      const phil = scoreBuyDecision(f, criteria, iv)
      const qm = qualifiesForQualityMode(f, phil, iv)
      return {
        ticker,
        name: f.name,
        sector: f.sector,
        price: f.price,
        score: phil.total,
        signal: phil.signal,
        conviction: phil.conviction,
        vetoes: phil.vetoedBy.map(p => p.title),
        intrinsicValue: round2(iv.intrinsicValue),
        grahamNumber: round2(iv.grahamNumber),
        dcfValue: round2(iv.dcfValue),
        marginOfSafetyPct: round2(iv.marginOfSafety),
        bearCaseMosPct: round2(iv.bearCaseMos),
        expectedCagr10yrPct: iv.expectedCagr10yr !== undefined ? round2(iv.expectedCagr10yr * 100) : undefined,
        businessTier: f.businessTier,
        piotroskiFScore: f.piotroskiFScore !== undefined ? `${f.piotroskiFScore}/${f.piotroskiMax ?? 9}` : 'n/a',
        altmanZ: round2(f.altmanZ),
        pe: round2(f.pe),
        pb: round2(f.pb),
        roic: f.roic !== undefined ? `${(f.roic * 100).toFixed(1)}%` : 'n/a',
        momentum3mo: f.momentum3mo !== undefined ? `${(f.momentum3mo * 100).toFixed(1)}%` : 'n/a',
        inFreefall: f.inFreefall ?? false,
        qualityModeEligible: qm.eligible,
        qualityModeFailures: qm.eligible ? undefined : qm.failures,
        auditTrail: phil.auditTrail.slice(-14),
        topRisks: phil.risks.slice(0, 4),
      }
    }

    case 'get_last_run': {
      const config = await prisma.autopilotConfig.findUnique({ where: { id: 'singleton' } })
      if (!config?.lastRunResult) return { error: 'No autopilot run recorded yet' }
      const r = config.lastRunResult as Record<string, unknown>
      const rawResults = (r.results ?? r.tradeResults) as unknown
      const results = Array.isArray(rawResults) ? rawResults : []
      return {
        lastRunAt: config.lastRunAt,
        mode: r.mode,
        buys: r.buys,
        qualityBuys: r.qualityBuys,
        sells: r.sells,
        skipped: r.skipped,
        vetoed: r.vetoed,
        topBlockers: r.topBlockers ?? 'not recorded (pre-upgrade run — will appear after the next run)',
        macro: r.macro,
        marketCrashCarveOut: r.marketCrashCarveOut,
        qualityExposure: r.qualityExposure,
        capitalDeployed: r.capitalDeployed,
        sampleResults: results.slice(0, 15),
        dailyRundown: config.dailyRundown,
      }
    }

    case 'get_position': {
      const ticker = String(input.ticker ?? '').toUpperCase().trim()
      if (!ticker) return { error: 'ticker required' }
      const pos = await prisma.paperPortfolioItem.findFirst({
        where: { stock: { ticker } },
        include: { stock: true },
        orderBy: { firstPurchased: 'desc' },
      })
      if (!pos) return { error: `No position (open or closed) found for ${ticker}` }
      const currentValue = pos.shares * (pos.currentPrice ?? pos.avgCostBasis)
      const cost = pos.shares * pos.avgCostBasis
      return {
        ticker,
        status: pos.isOpen ? 'open' : 'closed',
        entryMode: (pos as { entryMode?: string }).entryMode ?? 'value',
        shares: pos.shares,
        avgCostBasis: pos.avgCostBasis,
        currentPrice: pos.currentPrice,
        returnPct: round2(((currentValue - cost) / cost) * 100),
        dividendsEarned: round2(pos.dividendsEarned),
        scoreAtPurchase: pos.philosophyScore,
        convictionAtPurchase: pos.conviction,
        mosAtPurchase: round2(pos.mosAtPurchase ?? undefined),
        firstPurchased: pos.firstPurchased,
        closedAt: pos.closedAt,
        closePrice: pos.closePrice,
        closeReason: pos.closeReason,
        thesisAtPurchase: pos.auditTrail.slice(0, 10),
      }
    }

    case 'get_shadow_stats': {
      const [resolved, pendingCount, unresolvable] = await Promise.all([
        prisma.shadowDecision.findMany({ where: { return90d: { not: null } } }),
        prisma.shadowDecision.count({ where: { return90d: null, price90d: null } }),
        prisma.shadowDecision.count({ where: { return90d: null, price90d: { not: null } } }),
      ])
      if (resolved.length === 0) {
        return {
          note: 'Shadow book has no resolved decisions yet — forward returns fill in ~90 days after each skip. Check back once the book matures.',
          pendingDecisions: pendingCount,
          unresolvableDelistedEtc: unresolvable,
        }
      }
      const byAction = (action: string) => {
        const rows = resolved.filter(s => s.action === action)
        if (rows.length === 0) return null
        const avg = rows.reduce((s, r) => s + (r.return90d ?? 0), 0) / rows.length
        return { count: rows.length, avgReturn90dPct: round2(avg * 100) }
      }
      const sorted = [...resolved].sort((a, b) => (b.return90d ?? 0) - (a.return90d ?? 0))
      const fmt = (s: (typeof resolved)[number]) => ({
        ticker: s.ticker, action: s.action, return90dPct: round2((s.return90d ?? 0) * 100),
        reason: s.reason.slice(0, 90), decidedAt: s.decidedAt,
      })
      return {
        resolvedDecisions: resolved.length,
        pendingDecisions: pendingCount,
        skips: byAction('SKIP'),
        vetoes: byAction('VETOED'),
        biggestMissedWinners: sorted.slice(0, 5).map(fmt),
        bestAvoidedLosers: sorted.slice(-5).reverse().map(fmt),
        interpretation: 'If avg skip returns are strongly positive, thresholds may be too strict; if vetoed stocks cratered, the vetoes are earning their keep.',
      }
    }

    case 'get_performance': {
      const [positions, config, snapshots] = await Promise.all([
        prisma.paperPortfolioItem.findMany({ include: { stock: true } }),
        prisma.autopilotConfig.findUnique({ where: { id: 'singleton' } }),
        prisma.portfolioSnapshot.findMany({ orderBy: { date: 'desc' }, take: 10 }),
      ])
      const open = positions.filter(p => p.isOpen)
      const closed = positions.filter(p => !p.isOpen)
      const totalCost = open.reduce((s, p) => s + p.shares * p.avgCostBasis, 0)
      const totalValue = open.reduce((s, p) => s + p.shares * (p.currentPrice ?? p.avgCostBasis), 0)
      const realised = closed.reduce((s, p) => s + (p.closePrice != null ? p.shares * (p.closePrice - p.avgCostBasis) : 0), 0)
      const dividends = positions.reduce((s, p) => s + (p.dividendsEarned ?? 0), 0)
      const cashYield = (config as { cashYieldAccrued?: number } | null)?.cashYieldAccrued ?? 0
      return {
        totalCapital: config?.totalCapital,
        openPositions: open.map(p => ({
          ticker: p.stock.ticker,
          entryMode: (p as { entryMode?: string }).entryMode ?? 'value',
          returnPct: round2(((p.shares * (p.currentPrice ?? p.avgCostBasis) - p.shares * p.avgCostBasis) / (p.shares * p.avgCostBasis)) * 100),
          value: round2(p.shares * (p.currentPrice ?? p.avgCostBasis)),
        })),
        openValue: round2(totalValue),
        openCost: round2(totalCost),
        unrealisedPct: totalCost > 0 ? round2(((totalValue - totalCost) / totalCost) * 100) : 0,
        realisedGainLoss: round2(realised),
        dividendsAccrued: round2(dividends),
        idleCashYieldAccrued: round2(cashYield),
        closedCount: closed.length,
        recentSnapshots: snapshots.map(s => ({
          date: s.date, totalValue: round2(s.totalValue), gainLossPct: round2(s.gainLossPct),
          spyPrice: s.spyPrice, vtvPrice: (s as { vtvPrice?: number | null }).vtvPrice ?? null,
        })),
      }
    }

    case 'get_watchlist': {
      const items = await prisma.watchlistItem.findMany({
        where: { isActive: true, lastScore: { not: null } },
        include: { stock: { include: { intrinsicValues: { orderBy: { calculatedAt: 'desc' }, take: 1 } } } },
        orderBy: { lastScore: 'desc' },
        take: 15,
      })
      return items.map(w => ({
        ticker: w.stock.ticker,
        name: w.stock.name,
        sector: w.stock.sector,
        score: w.lastScore,
        mosPct: round2(w.lastMos ?? undefined),
        lastAction: w.lastAction,
        skipReason: w.lastSkipReason,
        lastAnalyzedAt: w.lastAnalyzedAt,
        price: w.stock.intrinsicValues?.[0]?.currentPrice,
      }))
    }

    case 'get_journal': {
      const [postMortems, letter] = await Promise.all([
        prisma.tradePostMortem.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
        prisma.weeklyLetter.findFirst({ orderBy: { generatedAt: 'desc' } }),
      ])
      return {
        postMortems: postMortems.map(m => ({
          ticker: m.ticker,
          entryMode: m.entryMode,
          holdingDays: m.holdingDays,
          returnPct: m.returnPct,
          closeReason: m.closeReason,
          verdict: m.verdict,
          lessons: m.lessons,
          closedAt: m.closedAt,
        })),
        verdictCounts: postMortems.reduce<Record<string, number>>((acc, m) => {
          acc[m.verdict] = (acc[m.verdict] ?? 0) + 1
          return acc
        }, {}),
        latestWeeklyLetter: letter ? { generatedAt: letter.generatedAt, content: letter.content } : null,
      }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}

function round2(v: number | undefined | null): number | undefined {
  return v == null || !isFinite(v) ? undefined : Math.round(v * 100) / 100
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const { messages } = await request.json()
  if (!Array.isArray(messages)) return Response.json({ error: 'messages required' }, { status: 400 })

  const config = await prisma.autopilotConfig.findUnique({ where: { id: 'singleton' } }).catch(() => null)

  const systemPrompt = `You are the resident analyst for Graham Capital, a value-investing autopilot. You think clearly, write concisely, and give direct answers.

RULE ONE — never guess at a decision this system made. Every buy, skip, and veto is recorded. Use the tools to look up the actual recorded reason, then report it. If a question is about a specific stock, run analyze_ticker and answer from the audit trail. "Why no buys?" → get_last_run and read topBlockers.

STYLE RULES — follow these strictly:
- Answer the question asked. Don't pad with background theory unless it's directly relevant.
- Never list out investing principles or name-drop philosophers to structure a response. Synthesise and conclude.
- No bullet-point dumps. Bullets only when comparing 3+ distinct items — otherwise prose.
- No caveats or "it depends" hedges unless the ambiguity is genuinely important.
- Keep responses short. If the answer is one paragraph, write one paragraph.
- Numbers and specifics beat adjectives. "$42 IV vs $38 price = 10% MOS" beats "fairly valued".
- After using tools, cite the specifics you found (scores, reasons, dates) — that's the whole point.

YOUR KNOWLEDGE: Graham/Buffett value methodology — margin of safety (incl. the bear-case zero-growth stress test), earnings stability, owner earnings, moats, Piotroski F-Score, Altman Z, quality mode ("wonderful company at a fair price", half-size entries). Apply silently.

PLATFORM SNAPSHOT (details available via tools):
Mode: ${config?.mode ?? 'paper'} | Capital: $${config?.totalCapital ?? 10000} | Autopilot ${config?.isEnabled === false ? 'DISABLED (kill switch)' : 'enabled'}
Buy gates: score ≥ ${config?.minPhilosophyScore ?? 45}, MOS ≥ ${config?.minMarginOfSafety ?? 15}%, bear-case MOS ≥ 0
Quality mode: ${(config as { qualityModeEnabled?: boolean } | null)?.qualityModeEnabled === false ? 'off' : `on (max ${(config as { maxQualityPct?: number } | null)?.maxQualityPct ?? 35}% of capital, half-size entries)`}
Last run: ${config?.lastRunAt ? new Date(config.lastRunAt).toISOString().slice(0, 16).replace('T', ' ') : 'never'}`

  const conversation: Anthropic.MessageParam[] = messages.map((m: { role: string; content: string }) => ({
    role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: m.content,
  }))

  const toolsUsed: string[] = []

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 2500,
        system: systemPrompt,
        messages: conversation,
        tools: TOOLS,
      })

      if (response.stop_reason !== 'tool_use') {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('')
        return Response.json({ role: 'assistant', content: text, toolsUsed })
      }

      conversation.push({ role: 'assistant', content: response.content })
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        const inputTicker = String((block.input as Record<string, unknown>)?.ticker ?? '')
        const label = inputTicker
          ? `${block.name.replace(/_/g, ' ')} · ${inputTicker.toUpperCase()}`
          : block.name.replace(/_/g, ' ')
        toolsUsed.push(label)
        const result = await runTool(block.name, block.input as Record<string, unknown>)
          .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
      }
      conversation.push({ role: 'user', content: toolResults })
    }

    return Response.json({
      role: 'assistant',
      content: 'I hit the tool-call limit for one answer — ask a narrower question and I will dig further.',
      toolsUsed,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}
