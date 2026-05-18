// Every decision in this file is justified by the philosophy engine.
// No capital is committed without a full Graham/Buffett audit trail.

import { prisma } from '@/lib/db/client'
import { getAccount, placeOrder } from '@/lib/schwab/client'
import { calculateIntrinsicValue } from '@/lib/graham/intrinsic-value'
import { applyGrahamCriteria } from '@/lib/graham/screener'
import { getCompleteFundamentals } from '@/lib/fmp/client'
import { scoreBuyDecision, scoreSellDecision } from '@/lib/philosophy/scorer'
import type { PortfolioSummary, PortfolioPosition } from '@/types'

const MAX_POSITION_PCT = 0.10  // Graham/Dodd: never >10% in one name
const MIN_PHILOSOPHY_SCORE = 55 // must score 55+/100 on philosophy engine to buy
const BUY_SIGNAL_MOS = 30      // 30% margin of safety required — Graham Ch.20

// ─── Portfolio Summary ────────────────────────────────────────────────────────

export async function getPortfolioSummary(accountId: string): Promise<PortfolioSummary> {
  const holdings = await prisma.portfolioItem.findMany({
    include: { stock: { include: { intrinsicValues: { orderBy: { calculatedAt: 'desc' }, take: 1 } } } },
  })

  let totalValue = 0
  let totalCostBasis = 0
  const positions: PortfolioPosition[] = []

  for (const h of holdings) {
    let currentPrice = h.avgCostBasis
    try {
      const fund = await getCompleteFundamentals(h.stock.ticker)
      currentPrice = fund.price
    } catch {
      // Fall back to cost basis if live price unavailable
    }

    const currentValue = currentPrice * h.shares
    const costBasis = h.avgCostBasis * h.shares
    const iv = h.stock.intrinsicValues[0]

    totalValue += currentValue
    totalCostBasis += costBasis

    positions.push({
      id: h.id,
      ticker: h.stock.ticker,
      name: h.stock.name,
      shares: h.shares,
      avgCostBasis: h.avgCostBasis,
      currentPrice,
      currentValue,
      costBasis,
      gainLoss: currentValue - costBasis,
      gainLossPct: ((currentValue - costBasis) / costBasis) * 100,
      intrinsicValue: iv?.intrinsicValue,
      marginOfSafety: iv?.marginOfSafety,
      firstPurchased: h.firstPurchased,
    })
  }

  return {
    totalValue,
    totalCostBasis,
    totalGainLoss: totalValue - totalCostBasis,
    totalGainLossPct: totalCostBasis > 0 ? ((totalValue - totalCostBasis) / totalCostBasis) * 100 : 0,
    positions,
    healthScore: calculatePortfolioHealthScore(positions),
  }
}

function calculatePortfolioHealthScore(positions: PortfolioPosition[]): number {
  if (positions.length === 0) return 0
  const withMOS = positions.filter((p) => p.marginOfSafety != null)
  if (withMOS.length === 0) return 50
  const avg = withMOS.reduce((sum, p) => sum + (p.marginOfSafety ?? 0), 0) / withMOS.length
  return Math.max(0, Math.min(100, Math.round(avg + 50)))
}

// ─── Automated Buy — Philosophy-Driven ───────────────────────────────────────

export interface AutoBuyResult {
  success: boolean
  orderId?: string
  reason?: string
  philosophyScore?: number
  conviction?: string
  auditTrail?: string[]
}

export async function executeAutomatedBuy(
  ticker: string,
  accountId: string
): Promise<AutoBuyResult> {
  const fundamentals = await getCompleteFundamentals(ticker)
  const criteria = applyGrahamCriteria(fundamentals)
  const iv = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding)

  // Run every principle through the philosophy engine
  const philosophy = scoreBuyDecision(fundamentals, criteria, iv)

  // Hard vetoes — any one blocks the trade regardless of score
  if (philosophy.vetoedBy.length > 0) {
    const vetoReason = philosophy.vetoedBy.map(p => p.title).join('; ')
    await createAuditAlert(ticker, 'BLOCKED', `Philosophy veto: ${vetoReason}`, philosophy.auditTrail)
    return {
      success: false,
      reason: `Philosophy veto: ${vetoReason}`,
      philosophyScore: 0,
      conviction: 'avoid',
      auditTrail: philosophy.auditTrail,
    }
  }

  // Minimum philosophy score gate
  if (philosophy.total < MIN_PHILOSOPHY_SCORE) {
    return {
      success: false,
      reason: `Philosophy score ${philosophy.total}/100 below minimum ${MIN_PHILOSOPHY_SCORE}. Not enough conviction to commit capital.`,
      philosophyScore: philosophy.total,
      conviction: philosophy.conviction,
      auditTrail: philosophy.auditTrail,
    }
  }

  // Margin of safety gate — the central concept
  if (iv.marginOfSafety < BUY_SIGNAL_MOS) {
    return {
      success: false,
      reason: `Margin of safety ${iv.marginOfSafety.toFixed(1)}% below required ${BUY_SIGNAL_MOS}%. Mr. Market has not yet offered an adequate discount. (Graham Ch.20)`,
      philosophyScore: philosophy.total,
      conviction: philosophy.conviction,
      auditTrail: philosophy.auditTrail,
    }
  }

  // Scale position size by conviction — higher score = larger initial position
  const account = await getAccount(accountId)
  const convictionMultiplier = philosophy.conviction === 'strong_buy' ? 1.0
    : philosophy.conviction === 'buy' ? 0.7
    : 0.5
  const maxPositionValue = account.balance.totalValue * MAX_POSITION_PCT * convictionMultiplier

  const existing = await prisma.portfolioItem.findFirst({
    where: { stock: { ticker: ticker.toUpperCase() } },
  })
  const existingValue = existing ? existing.shares * fundamentals.price : 0
  const remainingAllocation = Math.max(0, maxPositionValue - existingValue)

  if (remainingAllocation < fundamentals.price) {
    return {
      success: false,
      reason: 'Position at maximum allocation. Graham/Dodd: never concentrate >10% per name. (Security Analysis Part V)',
      philosophyScore: philosophy.total,
      conviction: philosophy.conviction,
      auditTrail: philosophy.auditTrail,
    }
  }

  const sharesToBuy = Math.floor(remainingAllocation / fundamentals.price)
  if (sharesToBuy < 1) {
    return { success: false, reason: 'Insufficient capital', auditTrail: philosophy.auditTrail }
  }

  const { orderId } = await placeOrder({
    ticker,
    shares: sharesToBuy,
    orderType: 'MARKET',
    accountId,
  })

  const stock = await prisma.stock.upsert({
    where: { ticker: ticker.toUpperCase() },
    create: {
      ticker: ticker.toUpperCase(),
      name: fundamentals.name,
      sector: fundamentals.sector,
      industry: fundamentals.industry,
      exchange: fundamentals.exchange,
    },
    update: { name: fundamentals.name },
  })

  if (existing) {
    const newTotal = existing.shares + sharesToBuy
    const newAvg = (existing.shares * existing.avgCostBasis + sharesToBuy * fundamentals.price) / newTotal
    await prisma.portfolioItem.update({
      where: { id: existing.id },
      data: { shares: newTotal, avgCostBasis: newAvg, schwabOrderIds: { push: orderId } },
    })
  } else {
    await prisma.portfolioItem.create({
      data: {
        stockId: stock.id,
        shares: sharesToBuy,
        avgCostBasis: fundamentals.price,
        firstPurchased: new Date(),
        schwabAccountId: accountId,
        schwabOrderIds: [orderId],
      },
    })
  }

  const auditSummary = philosophy.auditTrail.slice(-3).join(' | ')
  await prisma.alert.create({
    data: {
      ticker: ticker.toUpperCase(),
      type: 'margin_of_safety',
      message: `AUTO-BUY: ${sharesToBuy} shares of ${ticker.toUpperCase()} @ $${fundamentals.price.toFixed(2)} | Philosophy: ${philosophy.total}/100 (${philosophy.conviction}) | MOS: ${iv.marginOfSafety.toFixed(1)}%`,
      severity: 'buy',
    },
  })

  return {
    success: true,
    orderId,
    philosophyScore: philosophy.total,
    conviction: philosophy.conviction,
    auditTrail: philosophy.auditTrail,
  }
}

// ─── Quarterly Rebalance — Philosophy-Driven ─────────────────────────────────

export async function runQuarterlyRebalance(accountId: string): Promise<{
  actions: Array<{ ticker: string; action: string; reason: string; auditTrail: string[] }>
}> {
  const holdings = await prisma.portfolioItem.findMany({ include: { stock: true } })
  const actions: Array<{ ticker: string; action: string; reason: string; auditTrail: string[] }> = []

  for (const holding of holdings) {
    try {
      const fundamentals = await getCompleteFundamentals(holding.stock.ticker)
      const criteria = applyGrahamCriteria(fundamentals)
      const iv = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding)

      // Philosophy sell assessment — never based on price
      const sellAssessment = scoreSellDecision(fundamentals, criteria, iv, holding.avgCostBasis)

      actions.push({
        ticker: holding.stock.ticker,
        action: sellAssessment.signal,
        reason: sellAssessment.reasons.join('; ') || 'All fundamental indicators sound — hold.',
        auditTrail: sellAssessment.auditTrail,
      })

      if (sellAssessment.shouldSell) {
        await prisma.alert.create({
          data: {
            ticker: holding.stock.ticker,
            type: 'fundamental_change',
            message: `REBALANCE REVIEW: ${holding.stock.ticker} flagged for potential sale — ${sellAssessment.reasons[0]}`,
            severity: 'warning',
          },
        })
      }
    } catch {
      actions.push({
        ticker: holding.stock.ticker,
        action: 'DATA_UNAVAILABLE',
        reason: 'Could not fetch fundamentals — hold pending review',
        auditTrail: ['HOLD: Data unavailable. Default to Graham principle: when in doubt, do not sell.'],
      })
    }
  }

  await prisma.quarterlyRebalance.create({ data: { actions } })
  return { actions }
}

// ─── Watchlist Auto-Buy ───────────────────────────────────────────────────────

export async function checkWatchlistForBuySignals(accountId: string): Promise<{
  triggered: Array<{ ticker: string; score: number; conviction: string }>
}> {
  const watchlist = await prisma.watchlistItem.findMany({
    where: { isActive: true },
    include: { stock: true },
  })

  const triggered: Array<{ ticker: string; score: number; conviction: string }> = []

  for (const item of watchlist) {
    try {
      const fundamentals = await getCompleteFundamentals(item.stock.ticker)
      const criteria = applyGrahamCriteria(fundamentals)
      const iv = calculateIntrinsicValue(fundamentals, fundamentals.sharesOutstanding)
      const philosophy = scoreBuyDecision(fundamentals, criteria, iv)

      if (philosophy.signal === 'BUY' && iv.isBuySignal) {
        const result = await executeAutomatedBuy(item.stock.ticker, accountId)
        if (result.success) {
          triggered.push({
            ticker: item.stock.ticker,
            score: result.philosophyScore ?? 0,
            conviction: result.conviction ?? 'buy',
          })
        }
      }
    } catch {
      // Skip — hold cash until data is reliable
    }
  }

  return { triggered }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createAuditAlert(ticker: string, action: string, message: string, trail: string[]) {
  try {
    await prisma.alert.create({
      data: {
        ticker: ticker.toUpperCase(),
        type: 'fundamental_change',
        message: `[${action}] ${ticker.toUpperCase()}: ${message}`,
        severity: 'info',
      },
    })
  } catch {
    // Best-effort audit logging
  }
}
