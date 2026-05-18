// The philosophy scoring engine.
// Every buy, hold, and sell decision passes through this.
// No trade executes without a full philosophy audit trail.

import { ALL_PRINCIPLES, SELL_PRINCIPLES, type Principle, type Category } from './principles'
import type { StockFundamentals } from '@/types'
import type { GrahamCriteria } from '@/types'
import type { IntrinsicValueResult } from '@/types'
import type { NewsAnalysis } from '@/lib/fmp/client'

export interface PhilosophyScore {
  total: number             // 0–100
  conviction: ConvictionLevel
  signal: TradeSignal
  categoryScores: Record<Category, number>
  triggeredPrinciples: TriggeredPrinciple[]
  vetoedBy: Principle[]    // any principle that hard-vetoes the trade
  auditTrail: string[]     // human-readable explanation of every decision
}

export interface TriggeredPrinciple {
  principle: Principle
  score: number            // 0–1 pass rate for this principle
  note: string
}

export type ConvictionLevel = 'strong_buy' | 'buy' | 'watchlist' | 'avoid' | 'sell' | 'hold'
export type TradeSignal = 'BUY' | 'ADD' | 'HOLD' | 'REDUCE' | 'SELL' | 'PASS'

// ─── Buy Scorer ───────────────────────────────────────────────────────────────

export function scoreBuyDecision(
  fundamentals: StockFundamentals,
  criteria: GrahamCriteria,
  iv: IntrinsicValueResult,
  news?: NewsAnalysis
): PhilosophyScore {
  const triggered: TriggeredPrinciple[] = []
  const vetoed: Principle[] = []
  const audit: string[] = []

  // ── Hard Vetoes (any one fails = no buy) ──────────────────────────────────

  // Earnings power veto: must have positive owner earnings
  const ownerEarningsVeto = ALL_PRINCIPLES.find(p => p.id === 'bl_1977_owner_earnings')!
  if (fundamentals.ownerEarnings !== undefined && fundamentals.ownerEarnings <= 0) {
    vetoed.push(ownerEarningsVeto)
    audit.push(`VETO: Owner earnings are negative (${ (fundamentals.ownerEarnings ?? 0).toFixed(0) }). Business is consuming capital, not generating it. (Buffett 1977)`)
  }

  // No NCAV for current ratio veto: below 1.0 is existential risk
  if (fundamentals.currentRatio !== undefined && fundamentals.currentRatio < 1.0) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'ii_c14_financial_strength')!
    vetoed.push(p)
    audit.push(`VETO: Current ratio ${fundamentals.currentRatio.toFixed(2)} is below 1.0. Business cannot meet short-term obligations. (Intelligent Investor Ch.14)`)
  }

  // Investment-not-speculation veto: must have 10yr earnings history
  if (!fundamentals.epsHistory || fundamentals.epsHistory.length < 5) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'ii_c1_investment_definition')!
    vetoed.push(p)
    audit.push(`VETO: Insufficient earnings history for thorough analysis. Speculation, not investment. (Intelligent Investor Ch.1)`)
  }

  // News hard veto: SEC/fraud/restatement headlines kill the thesis regardless
  if (news && news.hardVetoFlags.length > 0) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'sk_downside_before_upside')!
    if (p) vetoed.push(p)
    audit.push(`VETO: Hard-veto news event detected — "${news.hardVetoFlags[0]}". Klarman: protect downside before seeking upside. Do not buy into an active integrity crisis.`)
  }

  // ── Valuation Principles ───────────────────────────────────────────────────

  // Margin of Safety — central concept
  const mosPrinciple = ALL_PRINCIPLES.find(p => p.id === 'ii_c20_margin_of_safety')!
  if (iv.intrinsicValue > 0) {
    const mosScore = Math.min(1, Math.max(0, iv.marginOfSafety / 50)) // 50% MOS = full score
    triggered.push({ principle: mosPrinciple, score: mosScore, note: `MOS: ${iv.marginOfSafety.toFixed(1)}% (need ≥30% for buy)` })
    if (iv.marginOfSafety >= 30) audit.push(`PASS: ${iv.marginOfSafety.toFixed(1)}% margin of safety exceeds 30% threshold. (Intelligent Investor Ch.20)`)
    else if (iv.marginOfSafety >= 0) audit.push(`PARTIAL: ${iv.marginOfSafety.toFixed(1)}% margin of safety — stock is fairly valued but below buy threshold. Add to watchlist.`)
    else audit.push(`FAIL: Stock is ${Math.abs(iv.marginOfSafety).toFixed(1)}% above intrinsic value. Mr. Market is being optimistic. Wait. (Intelligent Investor Ch.8)`)
  }

  // Graham Number check
  if (iv.grahamNumber) {
    const gPrinciple = ALL_PRINCIPLES.find(p => p.id === 'ii_c14_moderate_pb')!
    const ratio = fundamentals.price / iv.grahamNumber
    const gScore = Math.max(0, 1 - ratio)
    triggered.push({ principle: gPrinciple, score: gScore, note: `Price/Graham Number: ${ratio.toFixed(2)}× (≤1.0 required)` })
    if (ratio <= 1.0) audit.push(`PASS: Price ($${fundamentals.price.toFixed(2)}) is below Graham Number ($${iv.grahamNumber.toFixed(2)}). Combined P/E×P/B ≤ 22.5. (Intelligent Investor Ch.14)`)
    else audit.push(`FAIL: Price is ${((ratio - 1) * 100).toFixed(1)}% above Graham Number. P/E × P/B exceeds 22.5.`)
  }

  // P/E check
  if (fundamentals.pe !== undefined) {
    const pePrinciple = ALL_PRINCIPLES.find(p => p.id === 'ii_c14_moderate_pe')!
    const peScore = fundamentals.pe <= 15 ? 1 : fundamentals.pe <= 20 ? 0.5 : 0
    triggered.push({ principle: pePrinciple, score: peScore, note: `P/E: ${fundamentals.pe.toFixed(1)} (need ≤15 for full score)` })
    if (fundamentals.pe <= 15) audit.push(`PASS: P/E of ${fundamentals.pe.toFixed(1)} meets Graham's ≤15 requirement. (Intelligent Investor Ch.14)`)
    else if (fundamentals.pe <= 25) audit.push(`BORDERLINE: P/E of ${fundamentals.pe.toFixed(1)} exceeds Graham threshold but may qualify as "wonderful business at fair price". (Buffett 2023)`)
    else audit.push(`FAIL: P/E of ${fundamentals.pe.toFixed(1)} is speculative territory. "At P/E >20 the investor has become a speculator." (Intelligent Investor Ch.14)`)
  }

  // ── Balance Sheet Principles ───────────────────────────────────────────────

  if (fundamentals.currentRatio !== undefined) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'ii_c14_financial_strength')!
    const score = fundamentals.currentRatio >= 2 ? 1 : fundamentals.currentRatio >= 1.5 ? 0.6 : 0.2
    triggered.push({ principle: p, score, note: `Current ratio: ${fundamentals.currentRatio.toFixed(2)} (need ≥2.0)` })
    if (!criteria.passedCurrentRatio) audit.push(`FAIL: Current ratio ${fundamentals.currentRatio.toFixed(2)} below Graham's minimum of 2.0. Financial strength insufficient. (Intelligent Investor Ch.14)`)
    else audit.push(`PASS: Current ratio ${fundamentals.currentRatio.toFixed(2)} — adequate financial strength.`)
  }

  // Leverage check (Buffett 2007)
  if (fundamentals.debtToEquity !== undefined) {
    const levPrinciple = ALL_PRINCIPLES.find(p => p.id === 'bl_2007_financial_leverage_danger')!
    const levScore = fundamentals.debtToEquity <= 0.5 ? 1 : fundamentals.debtToEquity <= 1 ? 0.7 : fundamentals.debtToEquity <= 2 ? 0.3 : 0
    triggered.push({ principle: levPrinciple, score: levScore, note: `Debt/Equity: ${fundamentals.debtToEquity.toFixed(2)}× (prefer ≤0.5)` })
    if (fundamentals.debtToEquity > 2) {
      audit.push(`FAIL: Debt/Equity of ${fundamentals.debtToEquity.toFixed(2)}× is dangerous. "Leverage is the only way a smart person goes broke." (Buffett 2007)`)
      vetoed.push(levPrinciple)
    } else if (fundamentals.debtToEquity <= 0.5) {
      audit.push(`PASS: Conservative balance sheet — D/E of ${fundamentals.debtToEquity.toFixed(2)}×. (Buffett 2007)`)
    }
  }

  // ── Earnings Power Principles ──────────────────────────────────────────────

  if (criteria.passedNoDeficit !== undefined) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'ii_c14_earnings_stability')!
    triggered.push({ principle: p, score: criteria.passedNoDeficit ? 1 : 0, note: `No earnings deficit in 10 years: ${criteria.passedNoDeficit ? 'YES' : 'NO'}` })
    if (!criteria.passedNoDeficit) audit.push(`FAIL: Earnings deficit detected in past 10 years. Business is not resilient across economic cycles. (Intelligent Investor Ch.14)`)
    else audit.push(`PASS: No earnings deficit in 10 years — demonstrated cycle resilience.`)
  }

  if (criteria.epsGrowthValue !== undefined) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'ii_c14_earnings_growth')!
    const score = Math.min(1, Math.max(0, (criteria.epsGrowthValue) / 8)) // 8% CAGR = full score
    triggered.push({ principle: p, score, note: `EPS CAGR: ${criteria.epsGrowthValue.toFixed(1)}% (need ≥3%)` })
    if (criteria.passedEpsGrowth) audit.push(`PASS: EPS CAGR of ${criteria.epsGrowthValue.toFixed(1)}% exceeds Graham's 3% minimum. (Intelligent Investor Ch.14)`)
    else audit.push(`FAIL: EPS CAGR of ${criteria.epsGrowthValue.toFixed(1)}% — earnings shrinking in real terms.`)
  }

  // FCF vs Net Income quality (Intelligent Investor Ch.12)
  if (fundamentals.freeCashFlow && fundamentals.netIncome && fundamentals.netIncome > 0) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'ii_c12_eps_skepticism')!
    const fcfQuality = fundamentals.freeCashFlow / fundamentals.netIncome
    const score = fcfQuality >= 0.9 ? 1 : fcfQuality >= 0.7 ? 0.7 : fcfQuality >= 0.5 ? 0.4 : 0.1
    triggered.push({ principle: p, score, note: `FCF/Net Income: ${(fcfQuality * 100).toFixed(0)}% (need ≥70% for quality earnings)` })
    if (fcfQuality < 0.5) audit.push(`WARN: FCF conversion is ${(fcfQuality * 100).toFixed(0)}% of net income. Earnings quality is poor — reported profits may not be real. (Intelligent Investor Ch.12)`)
    else if (fcfQuality >= 0.9) audit.push(`PASS: Strong earnings quality — FCF converts at ${(fcfQuality * 100).toFixed(0)}% of net income.`)
  }

  // ── Moat and Business Quality ──────────────────────────────────────────────

  if (fundamentals.roe !== undefined) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'bl_1990_moat_identification')!
    const roeScore = fundamentals.roe >= 0.20 ? 1 : fundamentals.roe >= 0.15 ? 0.7 : fundamentals.roe >= 0.10 ? 0.4 : 0.1
    triggered.push({ principle: p, score: roeScore, note: `ROE: ${(fundamentals.roe * 100).toFixed(1)}% (20%+ signals economic moat)` })
    if (fundamentals.roe >= 0.20) audit.push(`PASS: ROE of ${(fundamentals.roe * 100).toFixed(1)}% indicates a genuine economic moat attracting above-average returns. (Buffett 1990)`)
    else if (fundamentals.roe < 0.10) audit.push(`FAIL: ROE of ${(fundamentals.roe * 100).toFixed(1)}% — business earns below its cost of equity. No moat evident.`)
  }

  if (fundamentals.roic !== undefined) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'bl_2017_moat_widening')!
    const roicScore = fundamentals.roic >= 0.20 ? 1 : fundamentals.roic >= 0.15 ? 0.7 : fundamentals.roic >= 0.10 ? 0.4 : 0.1
    triggered.push({ principle: p, score: roicScore, note: `ROIC: ${(fundamentals.roic * 100).toFixed(1)}% (15%+ = moat evidence)` })
    if (fundamentals.roic >= 0.15) audit.push(`PASS: ROIC ${(fundamentals.roic * 100).toFixed(1)}% — above cost of capital, business creates economic value. (Buffett 2017)`)
  }

  // Dividend record
  if (criteria.dividendYears !== undefined) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'ii_c14_dividend_record')!
    const divScore = criteria.dividendYears >= 20 ? 1 : criteria.dividendYears >= 10 ? 0.6 : criteria.dividendYears >= 5 ? 0.3 : 0
    triggered.push({ principle: p, score: divScore, note: `Dividend history: ${criteria.dividendYears} years (need ≥20)` })
    if (!criteria.passedDividends) audit.push(`FAIL: Only ${criteria.dividendYears} years of dividends — does not meet 20-year requirement. Business has not proven consistent cash generation. (Intelligent Investor Ch.14)`)
    else audit.push(`PASS: ${criteria.dividendYears} years of uninterrupted dividends. (Intelligent Investor Ch.14)`)
  }

  // P/B check
  if (fundamentals.pb !== undefined) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'ii_c14_moderate_pb')!
    const pbScore = fundamentals.pb <= 1.5 ? 1 : fundamentals.pb <= 2.5 ? 0.5 : 0
    triggered.push({ principle: p, score: pbScore, note: `P/B: ${fundamentals.pb.toFixed(2)} (need ≤1.5 for Graham criteria)` })
  }

  // ── Greenblatt Magic Formula ───────────────────────────────────────────────

  if (fundamentals.earningsYield !== undefined) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'gl_earnings_yield')!
    if (p) {
      const eyScore = fundamentals.earningsYield >= 0.15 ? 1 : fundamentals.earningsYield >= 0.10 ? 0.7 : fundamentals.earningsYield >= 0.06 ? 0.4 : 0.1
      triggered.push({ principle: p, score: eyScore, note: `Earnings yield (EBIT/EV): ${(fundamentals.earningsYield * 100).toFixed(1)}% (Greenblatt: ≥10% target)` })
      if (fundamentals.earningsYield >= 0.10) audit.push(`PASS: Earnings yield of ${(fundamentals.earningsYield * 100).toFixed(1)}% — business earns >10 cents per $1 of enterprise value. Greenblatt Magic Formula quality. (The Little Book That Beats the Market)`)
      else audit.push(`PARTIAL: Earnings yield ${(fundamentals.earningsYield * 100).toFixed(1)}% — below Greenblatt's 10% threshold. Fair but not a magic formula candidate.`)
    }
  }

  if (fundamentals.roic !== undefined && fundamentals.earningsYield !== undefined) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'gl_magic_formula_combined')!
    if (p) {
      const combined = (fundamentals.roic >= 0.15 ? 1 : 0) + (fundamentals.earningsYield >= 0.10 ? 1 : 0)
      const score = combined / 2
      triggered.push({ principle: p, score, note: `Magic Formula: ROIC ${(fundamentals.roic * 100).toFixed(0)}% + Earnings Yield ${(fundamentals.earningsYield * 100).toFixed(0)}% — ${combined}/2 checks pass` })
      if (combined === 2) audit.push(`PASS: Full Magic Formula — high ROIC (${(fundamentals.roic * 100).toFixed(0)}%) AND high earnings yield (${(fundamentals.earningsYield * 100).toFixed(0)}%). Rank this stock in the top earnings-yield + top quality lists. (Greenblatt)`)
    }
  }

  // ── Lynch: PEG Ratio ──────────────────────────────────────────────────────

  if (fundamentals.peg !== undefined && fundamentals.peg > 0) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'pl_peg_ratio')!
    if (p) {
      const pegScore = fundamentals.peg <= 0.5 ? 1 : fundamentals.peg <= 1.0 ? 0.75 : fundamentals.peg <= 1.5 ? 0.4 : 0.1
      triggered.push({ principle: p, score: pegScore, note: `PEG ratio: ${fundamentals.peg.toFixed(2)} (Lynch: ≤1.0 = growth at reasonable price)` })
      if (fundamentals.peg <= 1.0) audit.push(`PASS: PEG of ${fundamentals.peg.toFixed(2)} — paying ≤1× the growth rate. "A stock with a PEG below 1 is cheap." (Peter Lynch, One Up on Wall Street)`)
      else if (fundamentals.peg <= 1.5) audit.push(`BORDERLINE: PEG ${fundamentals.peg.toFixed(2)} — growth priced in but not unreasonable. Monitor for earnings acceleration. (Lynch)`)
      else audit.push(`FAIL: PEG ${fundamentals.peg.toFixed(2)} — paying more than 1.5× the growth rate. Price outrunning earnings growth. (Lynch)`)
    }
  }

  // Lynch cash-per-share floor
  if (fundamentals.netCash !== undefined && fundamentals.sharesOutstanding && fundamentals.sharesOutstanding > 0) {
    const cashPerShare = fundamentals.netCash / fundamentals.sharesOutstanding
    if (cashPerShare > 0) {
      const p = ALL_PRINCIPLES.find(p => p.id === 'pl_cash_per_share_floor')!
      if (p) {
        const cashCoverRatio = cashPerShare / fundamentals.price
        const score = Math.min(1, cashCoverRatio * 3)
        triggered.push({ principle: p, score, note: `Net cash/share: $${cashPerShare.toFixed(2)} = ${(cashCoverRatio * 100).toFixed(0)}% of stock price` })
        if (cashCoverRatio >= 0.25) audit.push(`PASS: Net cash of $${cashPerShare.toFixed(2)}/share covers ${(cashCoverRatio * 100).toFixed(0)}% of price. Significant downside cushion. (Lynch)`)
      }
    }
  }

  // ── Dreman Contrarian Metrics ─────────────────────────────────────────────

  if (fundamentals.pe !== undefined && fundamentals.pe > 0) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'dd_low_pe_outperforms')!
    if (p) {
      const drePeScore = fundamentals.pe <= 8 ? 1 : fundamentals.pe <= 12 ? 0.8 : fundamentals.pe <= 16 ? 0.5 : 0.1
      triggered.push({ principle: p, score: drePeScore, note: `Dreman low-P/E check: ${fundamentals.pe.toFixed(1)}× (bottom quintile historically outperforms)` })
      if (fundamentals.pe <= 10) audit.push(`PASS: P/E ${fundamentals.pe.toFixed(1)} in deep-value territory — Dreman's 40yr research shows bottom-quintile P/E consistently outperforms the market. (Contrarian Investment Strategies)`)
    }
  }

  if (fundamentals.priceToFreeCashFlow !== undefined && fundamentals.priceToFreeCashFlow > 0) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'dd_price_to_cash_flow_superior')!
    if (p) {
      const pfcfScore = fundamentals.priceToFreeCashFlow <= 10 ? 1 : fundamentals.priceToFreeCashFlow <= 15 ? 0.75 : fundamentals.priceToFreeCashFlow <= 20 ? 0.4 : 0.1
      triggered.push({ principle: p, score: pfcfScore, note: `P/FCF: ${fundamentals.priceToFreeCashFlow.toFixed(1)}× (Dreman: ≤15× is value territory)` })
      if (fundamentals.priceToFreeCashFlow <= 15) audit.push(`PASS: P/FCF of ${fundamentals.priceToFreeCashFlow.toFixed(1)}× — cash flow multiple superior predictor of returns vs P/E. (Dreman)`)
      else audit.push(`FAIL: P/FCF ${fundamentals.priceToFreeCashFlow.toFixed(1)}× — market pricing generous free cash flow multiple. Not a contrarian entry. (Dreman)`)
    }
  }

  // ── Fisher: Operating Margin Trend ───────────────────────────────────────

  if (fundamentals.operatingMarginTrend !== undefined) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'pf_profit_margin_trend')!
    if (p) {
      const score = fundamentals.operatingMarginTrend === 'improving' ? 1 : fundamentals.operatingMarginTrend === 'stable' ? 0.6 : 0.1
      triggered.push({ principle: p, score, note: `Operating margin trend (3yr vs prior 4yr): ${fundamentals.operatingMarginTrend.toUpperCase()}` })
      if (fundamentals.operatingMarginTrend === 'improving') audit.push(`PASS: Operating margins trending IMPROVING — management is expanding the moat. Fisher Point 5: the most important non-financial signal. (Common Stocks and Uncommon Profits)`)
      else if (fundamentals.operatingMarginTrend === 'declining') audit.push(`WARN: Operating margins DECLINING — competitive pressure or cost inflation eroding the business. Fisher Point 5 violation. Monitor for structural deterioration. (Fisher)`)
    }
  }

  // ── Klarman: Net Cash Liquidation Floor ──────────────────────────────────

  if (fundamentals.netCash !== undefined && fundamentals.marketCap && fundamentals.marketCap > 0) {
    const netCashRatio = fundamentals.netCash / fundamentals.marketCap
    if (netCashRatio > 0) {
      const p = ALL_PRINCIPLES.find(p => p.id === 'sk_liquidation_value_floor')!
      if (p) {
        const liqScore = netCashRatio >= 0.5 ? 1 : netCashRatio >= 0.25 ? 0.75 : netCashRatio >= 0.10 ? 0.4 : 0.1
        triggered.push({ principle: p, score: liqScore, note: `Net cash / market cap: ${(netCashRatio * 100).toFixed(0)}% (Klarman: ≥25% = meaningful liquidation floor)` })
        if (netCashRatio >= 0.25) audit.push(`PASS: Net cash is ${(netCashRatio * 100).toFixed(0)}% of market cap — you are buying the operating business at a steep discount to headline price. Klarman liquidation floor is substantial. (Margin of Safety)`)
        else if (netCashRatio >= 0.10) audit.push(`PARTIAL: Net cash covers ${(netCashRatio * 100).toFixed(0)}% of market cap — some downside protection but not a Klarman-grade net-cash situation. (Klarman)`)
      }
    } else {
      const p = ALL_PRINCIPLES.find(p => p.id === 'sk_no_leverage')!
      if (p && fundamentals.netCash < 0) {
        const netDebtRatio = Math.abs(fundamentals.netCash) / fundamentals.marketCap
        if (netDebtRatio > 0.5) {
          triggered.push({ principle: p, score: 0.2, note: `Net debt is ${(netDebtRatio * 100).toFixed(0)}% of market cap — significant leverage risk (Klarman: no leverage)` })
          audit.push(`WARN: Net debt is ${(netDebtRatio * 100).toFixed(0)}% of market cap. Klarman: leverage introduces permanent-loss risk that cannot be predicted or managed. (Margin of Safety)`)
        }
      }
    }
  }

  // ── Munger: Lollapalooza Effect ───────────────────────────────────────────

  {
    const moatSignals = [
      fundamentals.roe !== undefined && fundamentals.roe >= 0.20,
      fundamentals.roic !== undefined && fundamentals.roic >= 0.15,
      fundamentals.operatingMarginTrend === 'improving',
      (criteria.dividendYears ?? 0) >= 20,
      fundamentals.debtToEquity !== undefined && fundamentals.debtToEquity <= 0.5,
      fundamentals.grossMargin !== undefined && fundamentals.grossMargin >= 0.40,
      fundamentals.currentRatio !== undefined && fundamentals.currentRatio >= 2.0,
    ].filter(Boolean).length

    const p = ALL_PRINCIPLES.find(p => p.id === 'cm_lollapalooza')!
    if (p && moatSignals >= 3) {
      const score = Math.min(1, moatSignals / 5)
      triggered.push({ principle: p, score, note: `Lollapalooza moat signals: ${moatSignals}/7 reinforcing factors converging` })
      if (moatSignals >= 5) audit.push(`PASS: ${moatSignals}/7 moat signals converging — Munger lollapalooza effect. Multiple reinforcing factors create a business durability that is multiplicative, not additive. This is Buffett's ideal holding. (Poor Charlie's Almanack)`)
      else if (moatSignals >= 3) audit.push(`PARTIAL: ${moatSignals}/7 moat signals present. Solid business but short of lollapalooza conviction — look for additional evidence of competitive durability before sizing up. (Munger)`)
    }
  }

  // Munger circle of competence — flag if no sector info (can't assess)
  if (!fundamentals.sector) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'cm_circle_of_competence')!
    if (p) {
      triggered.push({ principle: p, score: 0.5, note: 'Sector unknown — cannot confirm within circle of competence' })
      audit.push(`INFO: Sector not identified. Munger: only buy what you thoroughly understand. Verify this business is within your circle of competence before sizing up. (Poor Charlie's Almanack)`)
    }
  }

  // ── Walter Schloss: P/B Deep Value Entry ─────────────────────────────────

  if (fundamentals.pb !== undefined) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'ws_low_pb_entry')!
    if (p) {
      const wsScore = fundamentals.pb <= 0.75 ? 1 : fundamentals.pb <= 1.0 ? 0.85 : fundamentals.pb <= 1.5 ? 0.5 : 0.1
      triggered.push({ principle: p, score: wsScore, note: `Schloss P/B check: ${fundamentals.pb.toFixed(2)} (≤1.0 = primary Schloss entry criterion)` })
      if (fundamentals.pb <= 1.0) audit.push(`PASS: P/B ${fundamentals.pb.toFixed(2)} — buying below book value. Schloss: the primary deep-value criterion — you're paying less than liquidation value of recorded assets. (Walter Schloss Archives)`)
    }
  }

  // ── Templeton: Maximum Pessimism Check ───────────────────────────────────

  if (fundamentals.pe !== undefined && fundamentals.pb !== undefined) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'jt_maximum_pessimism')!
    if (p) {
      const bothLow = fundamentals.pe <= 10 && fundamentals.pb <= 1.0
      const veryCheap = fundamentals.pe <= 8 && fundamentals.pb <= 0.7
      const score = veryCheap ? 1 : bothLow ? 0.8 : 0
      if (score > 0) {
        triggered.push({ principle: p, score, note: `Templeton pessimism check: P/E ${fundamentals.pe.toFixed(1)} + P/B ${fundamentals.pb.toFixed(2)} — both depressed simultaneously` })
        audit.push(`PASS: Both P/E (${fundamentals.pe.toFixed(1)}) and P/B (${fundamentals.pb.toFixed(2)}) are simultaneously depressed. Templeton: "The time of maximum pessimism is the best time to buy." This is the sweet spot. (Templeton's Way with Money)`)
      }
    }
  }

  // ── Pabrai: Asymmetric Payoff Check ──────────────────────────────────────

  if (iv.intrinsicValue > 0 && fundamentals.netCash !== undefined && fundamentals.marketCap && fundamentals.marketCap > 0) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'mp_heads_win_tails_dont_lose')!
    if (p) {
      const upside = iv.intrinsicValue - fundamentals.price
      const netCashPerShare = fundamentals.netCash / (fundamentals.sharesOutstanding ?? 1)
      const downside = Math.max(0, fundamentals.price - Math.max(0, netCashPerShare))
      const ratio = downside > 0 ? upside / downside : upside > 0 ? Infinity : 0
      const score = ratio >= 3 ? 1 : ratio >= 2 ? 0.7 : ratio >= 1 ? 0.4 : 0.1
      triggered.push({ principle: p, score, note: `Upside/downside ratio: ${ratio === Infinity ? '∞' : ratio.toFixed(1)}× (Pabrai: need ≥3× asymmetry)` })
      if (ratio >= 3) audit.push(`PASS: ${ratio === Infinity ? 'Extreme' : ratio.toFixed(1) + '×'} upside/downside asymmetry — heads I win, tails I don't lose much. Pabrai's core requirement for a bet. (Mosaic: Perspectives on Investing)`)
      else if (ratio >= 2) audit.push(`PARTIAL: ${ratio.toFixed(1)}× upside/downside — reasonable asymmetry but below Pabrai's 3× threshold for high conviction. (Pabrai)`)
      else audit.push(`FAIL: Upside/downside ratio ${ratio.toFixed(1)}× — not asymmetric enough. The bet is symmetric or worse. Pabrai: pass unless you find an angle others have missed. (Pabrai)`)
    }
  }

  // ── Howard Marks: Risk Control & Sentiment ────────────────────────────────

  if (news && news.sentiment !== undefined) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'hm_aggressive_when_fearful')!
    if (p) {
      const score = news.sentiment === 'negative' ? 1 : news.sentiment === 'neutral' ? 0.6 : 0.2
      triggered.push({ principle: p, score, note: `News sentiment: ${news.sentiment.toUpperCase()} (Marks: negative sentiment = better entry)` })
      if (news.sentiment === 'negative' && iv.marginOfSafety >= 30) audit.push(`PASS: Negative news sentiment + meaningful margin of safety = Marks' ideal entry. "Aggressiveness at the bottom is what turns good investors into great ones." (Oaktree Memos)`)
      else if (news.sentiment === 'positive' && iv.marginOfSafety < 10) audit.push(`WARN: Positive news + thin margin of safety — the good news may already be priced in. Marks: consensus is already priced; second-level thinking required. (Oaktree Memos)`)
      if (news.disruptionFlags.length > 0) audit.push(`WARN: ${news.disruptionFlags.length} disruption signal(s) in recent news — "${news.disruptionFlags[0]}". Monitor for structural moat deterioration. (Howard Marks: risk control primary)`)
    }
  }

  // ── Composite Score ────────────────────────────────────────────────────────

  if (vetoed.length > 0) {
    return {
      total: 0,
      conviction: 'avoid',
      signal: 'PASS',
      categoryScores: buildCategoryScores(triggered),
      triggeredPrinciples: triggered,
      vetoedBy: vetoed,
      auditTrail: audit,
    }
  }

  const weightedTotal = triggered.reduce((sum, t) => sum + t.score * t.principle.weight, 0)
  const maxTotal = triggered.reduce((sum, t) => sum + t.principle.weight, 0)
  const score = maxTotal > 0 ? (weightedTotal / maxTotal) * 100 : 0

  const conviction = scoreToConviction(score, iv.marginOfSafety, criteria.overallPass)
  const signal = convictionToSignal(conviction)

  audit.push(`\nCOMPOSITE SCORE: ${score.toFixed(0)}/100 | Signal: ${signal} | Conviction: ${conviction.toUpperCase().replace('_', ' ')}`)

  return {
    total: Math.round(score),
    conviction,
    signal,
    categoryScores: buildCategoryScores(triggered),
    triggeredPrinciples: triggered,
    vetoedBy: [],
    auditTrail: audit,
  }
}

// ─── Sell Scorer ──────────────────────────────────────────────────────────────

export interface SellAssessment {
  shouldSell: boolean
  signal: TradeSignal
  reasons: string[]
  auditTrail: string[]
}

export function scoreSellDecision(
  fundamentals: StockFundamentals,
  criteria: GrahamCriteria,
  iv: IntrinsicValueResult,
  avgCostBasis: number
): SellAssessment {
  const reasons: string[] = []
  const audit: string[] = []

  audit.push('SELL ANALYSIS — applying Graham/Buffett sell discipline:')
  audit.push('"Never sell a stock because the price has declined. Sell only when the business has declined." — Graham/Buffett synthesis')

  // Price decline is NEVER a reason
  const priceChange = ((fundamentals.price - avgCostBasis) / avgCostBasis) * 100
  if (priceChange < -20) {
    audit.push(`HOLD: Price is down ${Math.abs(priceChange).toFixed(1)}% from cost basis — this is Mr. Market's pessimism, NOT a sell signal. (Intelligent Investor Ch.8)`)
  }

  // Check each sell principle
  let shouldSell = false

  // 1. Earnings deficit
  if (!criteria.passedNoDeficit) {
    reasons.push('Earnings deficit detected in recent history')
    audit.push(`WARN: Earnings deficit appearing — monitor for second consecutive year. Sell if trend continues. (Intelligent Investor Ch.14)`)
  }

  // 2. Balance sheet deterioration
  if (fundamentals.currentRatio !== undefined && fundamentals.currentRatio < 1.5) {
    reasons.push(`Current ratio deteriorated to ${fundamentals.currentRatio.toFixed(2)}`)
    audit.push(`WARN: Current ratio ${fundamentals.currentRatio.toFixed(2)} — approaching distress territory. Review debt covenants and refinancing risk. (Intelligent Investor Ch.14)`)
    if (fundamentals.currentRatio < 1.0) {
      shouldSell = true
      audit.push(`SELL: Current ratio below 1.0 — business cannot meet short-term obligations. Capital at risk of permanent loss. (Security Analysis Part III)`)
    }
  }

  // 3. Dangerous leverage
  if (fundamentals.debtToEquity !== undefined && fundamentals.debtToEquity > 3) {
    reasons.push(`Debt/Equity of ${fundamentals.debtToEquity.toFixed(2)}× is existential risk`)
    shouldSell = true
    audit.push(`SELL: D/E ${fundamentals.debtToEquity.toFixed(2)}× — "leverage is the only way a smart person goes broke." (Buffett 2007)`)
  }

  // 4. ROE collapse — moat destruction
  if (fundamentals.roe !== undefined && fundamentals.roe < 0.05) {
    reasons.push(`ROE collapsed to ${(fundamentals.roe * 100).toFixed(1)}% — moat may be gone`)
    audit.push(`WARN: ROE ${(fundamentals.roe * 100).toFixed(1)}% — business is barely earning its cost of equity. Monitor for structural moat loss. (Buffett 1990)`)
  }

  // 5. Stock materially above intrinsic value
  if (iv.marginOfSafety < -30) {
    reasons.push(`Stock trading ${Math.abs(iv.marginOfSafety).toFixed(1)}% above intrinsic value`)
    audit.push(`CONSIDER: Stock is ${Math.abs(iv.marginOfSafety).toFixed(1)}% above intrinsic value. For a wonderful business, this may still warrant holding if ROIC and moat are intact. For a Graham cigar-butt, sell and redeploy. (Buffett 1997)`)
  }

  if (!shouldSell && reasons.length === 0) {
    audit.push(`HOLD: All fundamental indicators remain sound. Mr. Market's price is irrelevant — the business continues compounding. (Buffett 2014)`)
  }

  return {
    shouldSell,
    signal: shouldSell ? 'SELL' : reasons.length > 1 ? 'REDUCE' : 'HOLD',
    reasons,
    auditTrail: audit,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildCategoryScores(triggered: TriggeredPrinciple[]): Record<Category, number> {
  const scores: Partial<Record<Category, { total: number; max: number }>> = {}
  for (const t of triggered) {
    const cat = t.principle.category
    if (!scores[cat]) scores[cat] = { total: 0, max: 0 }
    scores[cat]!.total += t.score * t.principle.weight
    scores[cat]!.max += t.principle.weight
  }
  const result: Partial<Record<Category, number>> = {}
  for (const [cat, { total, max }] of Object.entries(scores)) {
    result[cat as Category] = max > 0 ? Math.round((total / max) * 100) : 0
  }
  return result as Record<Category, number>
}

function scoreToConviction(score: number, mos: number, grahamPass: boolean): ConvictionLevel {
  if (score >= 75 && mos >= 30 && grahamPass) return 'strong_buy'
  if (score >= 60 && mos >= 30) return 'buy'
  if (score >= 50 && mos >= 10) return 'watchlist'
  if (score >= 50 && mos < 0) return 'hold'
  return 'avoid'
}

function convictionToSignal(conviction: ConvictionLevel): TradeSignal {
  switch (conviction) {
    case 'strong_buy': return 'BUY'
    case 'buy': return 'BUY'
    case 'watchlist': return 'PASS'
    case 'hold': return 'HOLD'
    case 'avoid': return 'PASS'
    case 'sell': return 'SELL'
  }
}
