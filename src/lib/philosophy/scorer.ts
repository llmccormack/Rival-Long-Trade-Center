// The philosophy scoring engine.
// Every buy, hold, and sell decision passes through this.
// No trade executes without a full philosophy audit trail.

import { ALL_PRINCIPLES, SELL_PRINCIPLES, type Principle, type Category } from './principles'
import type { StockFundamentals, InsiderTransaction, BusinessTier } from '@/types'
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
  risks: string[]           // top bear-case risks for the investment
}

export interface TriggeredPrinciple {
  principle: Principle
  score: number            // 0–1 pass rate for this principle
  note: string
}

export type ConvictionLevel = 'exceptional' | 'strong_buy' | 'buy' | 'watchlist' | 'avoid' | 'sell' | 'hold'
export type TradeSignal = 'BUY' | 'ADD' | 'HOLD' | 'REDUCE' | 'SELL' | 'PASS'

// ─── Buy Scorer ───────────────────────────────────────────────────────────────

export function scoreBuyDecision(
  fundamentals: StockFundamentals,
  criteria: GrahamCriteria,
  iv: IntrinsicValueResult,
  news?: NewsAnalysis,
  insider?: InsiderTransaction[]
): PhilosophyScore {
  const triggered: TriggeredPrinciple[] = []
  const vetoed: Principle[] = []
  const audit: string[] = []

  // Sector flags used throughout scoring — defined once to avoid repetition
  // Banks/insurance: current ratio < 1 is structural (fractional reserve), not a solvency signal
  const isFinancialSector =
    fundamentals.sector?.toLowerCase().includes('financial') ||
    fundamentals.sector?.toLowerCase().includes('bank') ||
    fundamentals.industry?.toLowerCase().includes('bank') ||
    fundamentals.industry?.toLowerCase().includes('insurance')
  // Capital-light sectors: book value reflects little of earning power (intangibles dominate)
  const isCapitalLightSector = ['technology', 'communication', 'software', 'healthcare', 'media'].some(s =>
    (fundamentals.sector ?? '').toLowerCase().includes(s)
  )

  // ── Hard Vetoes (any one fails = no buy) ──────────────────────────────────

  // Earnings power veto: must have positive owner earnings
  const ownerEarningsVeto = ALL_PRINCIPLES.find(p => p.id === 'bl_1977_owner_earnings')!
  if (fundamentals.ownerEarnings !== undefined && fundamentals.ownerEarnings <= 0) {
    vetoed.push(ownerEarningsVeto)
    audit.push(`VETO: Owner earnings are negative (${ (fundamentals.ownerEarnings ?? 0).toFixed(0) }). Business is consuming capital, not generating it. (Buffett 1977)`)
  }

  // Current ratio veto — skipped for banks/financials (CR < 1 is structural, not a liquidity failure)
  if (fundamentals.currentRatio !== undefined && fundamentals.currentRatio < 1.0 && !isFinancialSector) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'ii_c14_financial_strength')!
    vetoed.push(p)
    audit.push(`VETO: Current ratio ${fundamentals.currentRatio.toFixed(2)} is below 1.0. Business cannot meet short-term obligations. (Intelligent Investor Ch.14)`)
  }

  // Investment-not-speculation veto: need at least 3 years of earnings history.
  // FMP free tier often returns only 3-4 years even for well-established companies,
  // so a higher threshold would veto legitimate stocks due to data gaps, not thin history.
  if (!fundamentals.epsHistory || fundamentals.epsHistory.length < 3) {
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

  if (fundamentals.currentRatio !== undefined && !isFinancialSector) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'ii_c14_financial_strength')!
    const score = fundamentals.currentRatio >= 2 ? 1 : fundamentals.currentRatio >= 1.5 ? 0.6 : 0.2
    triggered.push({ principle: p, score, note: `Current ratio: ${fundamentals.currentRatio.toFixed(2)} (need ≥2.0)` })
    if (!criteria.passedCurrentRatio) audit.push(`FAIL: Current ratio ${fundamentals.currentRatio.toFixed(2)} below Graham's minimum of 2.0. Financial strength insufficient. (Intelligent Investor Ch.14)`)
    else audit.push(`PASS: Current ratio ${fundamentals.currentRatio.toFixed(2)} — adequate financial strength.`)
  } else if (isFinancialSector && fundamentals.debtToEquity !== undefined) {
    audit.push(`INFO: Financial sector — current ratio not applicable. Evaluating leverage and capital adequacy instead.`)
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

  // ── Accruals Ratio (Sloan 1996) ───────────────────────────────────────────
  // Sloan's landmark study: firms with high accruals (earnings not backed by cash)
  // consistently underperform by ~10%/yr. Firms with low accruals outperform.
  // Formula: (Net Income - Operating Cash Flow) / Total Assets
  // <2%: excellent — earnings are almost entirely cash. >8%: red flag.

  if (
    fundamentals.netIncome !== undefined &&
    fundamentals.operatingCashFlow !== undefined &&
    fundamentals.totalAssets && fundamentals.totalAssets > 0
  ) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'ii_accruals_sloan')!
    if (p) {
      const accruals = fundamentals.netIncome - fundamentals.operatingCashFlow
      const accrualsRatio = accruals / fundamentals.totalAssets
      const accScore = accrualsRatio <= 0.02 ? 1 : accrualsRatio <= 0.05 ? 0.75 :
        accrualsRatio <= 0.08 ? 0.45 : 0.10
      triggered.push({ principle: p, score: accScore,
        note: `Accruals ratio (Sloan): ${(accrualsRatio * 100).toFixed(1)}% of assets (need <2% for highest quality)` })
      if (accrualsRatio <= 0.02) {
        audit.push(`PASS: Accruals ratio ${(accrualsRatio * 100).toFixed(1)}% — earnings are almost entirely cash-backed. ` +
          `Sloan (1996): low-accruals firms generate ~10%/yr abnormal returns. This is highest-quality income. (Accounting Review 1996)`)
      } else if (accrualsRatio >= 0.08) {
        audit.push(`WARN: Accruals ratio ${(accrualsRatio * 100).toFixed(1)}% — earnings significantly exceed operating cash flow. ` +
          `Sloan (1996): high-accruals firms consistently disappoint. Reported profits may be accounting artefacts, not economic reality. ` +
          `Scrutinise receivables, inventory build, and deferred revenue. (Accounting Review 1996)`)
      }
    }
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

  // Dividend record — high ROIC is an equally valid alternative.
  // Buffett: Berkshire has paid $0 in dividends since 1967. Amazon, Alphabet, Meta paid none for years.
  // A business reinvesting at 20%+ ROIC creates far more value than paying dividends at 6% yield.
  {
    const roicForDiv = fundamentals.roic
    const hasMoatReinvestment = roicForDiv !== undefined && roicForDiv >= 0.15
    if (criteria.dividendYears !== undefined || hasMoatReinvestment) {
      const p = ALL_PRINCIPLES.find(p => p.id === 'ii_c14_dividend_record')!
      const divScore = criteria.dividendYears !== undefined
        ? (criteria.dividendYears >= 20 ? 1 : criteria.dividendYears >= 10 ? 0.6 : criteria.dividendYears >= 5 ? 0.3 : 0)
        : 0
      const roicAlt = hasMoatReinvestment ? ((roicForDiv ?? 0) >= 0.20 ? 1.0 : 0.80) : 0
      const finalScore = Math.max(divScore, roicAlt)
      triggered.push({
        principle: p, score: finalScore,
        note: divScore >= roicAlt
          ? `Dividend history: ${criteria.dividendYears ?? 0} years (need ≥20)`
          : `ROIC ${((roicForDiv ?? 0) * 100).toFixed(1)}% — reinvesting above cost of capital beats dividend payout`
      })
      if (finalScore >= 0.8) {
        if (divScore >= roicAlt) {
          audit.push(`PASS: ${criteria.dividendYears} years of uninterrupted dividends. (Intelligent Investor Ch.14)`)
        } else {
          audit.push(`PASS: ROIC ${((roicForDiv ?? 0) * 100).toFixed(1)}% — high-ROIC reinvestment is superior capital allocation to dividend payments. Berkshire has paid $0 in dividends since 1967. (Buffett)`)
        }
      } else if (finalScore >= 0.3) {
        audit.push(`PARTIAL: ${criteria.dividendYears ?? 0} year dividend record; ROIC ${hasMoatReinvestment ? ((roicForDiv ?? 0) * 100).toFixed(1) + '%' : 'N/A'} — limited capital allocation evidence.`)
      } else {
        audit.push(`FAIL: Only ${criteria.dividendYears ?? 0} years of dividends and ROIC ${hasMoatReinvestment ? ((roicForDiv ?? 0) * 100).toFixed(1) + '%' : 'unavailable'} — weak capital allocation track record. (Intelligent Investor Ch.14)`)
      }
    }
  }

  // P/B check — skipped for capital-light sectors (book value is dominated by intangibles not on the balance sheet)
  // Apple P/B ~40, Google P/B ~6 — these are not "expensive" by book value; their moat IS the book value
  if (fundamentals.pb !== undefined && !isCapitalLightSector) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'ii_c14_moderate_pb')!
    const pbScore = fundamentals.pb <= 1.5 ? 1 : fundamentals.pb <= 2.5 ? 0.5 : 0
    triggered.push({ principle: p, score: pbScore, note: `P/B: ${fundamentals.pb.toFixed(2)} (need ≤1.5 for Graham criteria)` })
  } else if (fundamentals.pb !== undefined && isCapitalLightSector) {
    audit.push(`INFO: Capital-light sector — P/B ratio skipped. Book value understates earning power of intangible assets. Use DCF and ROIC instead. (Buffett)`)
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

  // PEG requires a reliable growth estimate — with <6 years of history the regression
  // is too noisy to trust, and a garbage growth rate produces a misleading PEG score.
  if (fundamentals.peg !== undefined && fundamentals.peg > 0 && (fundamentals.epsHistory?.length ?? 0) >= 6) {
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

  // ── Walter Schloss: P/B Deep Value Entry — skipped for capital-light sectors ──

  if (fundamentals.pb !== undefined && !isCapitalLightSector) {
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

  // ── Graham Net-Net (NCAV) ─────────────────────────────────────────────────
  // Graham's most reliable deep-value method — statistically dominant returns.
  // When price < 67% of NCAV/share, the market prices the operating business
  // at negative value. This has been the single best-performing mechanical screen
  // in the historical academic literature (Oppenheimer 1986, Greenblatt 2006).

  if (fundamentals.ncavPerShare !== undefined && fundamentals.ncavPerShare > 0) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'ii_c14_financial_strength')!
    if (p) {
      const ncavRatio = fundamentals.price / fundamentals.ncavPerShare
      const ncavScore = ncavRatio <= 0.67 ? 1 : ncavRatio <= 1.0 ? 0.7 : ncavRatio <= 1.5 ? 0.4 : 0.1
      triggered.push({ principle: p, score: ncavScore, note: `NCAV/share: $${fundamentals.ncavPerShare.toFixed(2)} | Price/NCAV: ${ncavRatio.toFixed(2)}× (Graham net-net: ≤0.67)` })
      if (fundamentals.isNetNet) {
        audit.push(`PASS: PRICE IS BELOW 67% OF NCAV — a genuine Graham net-net. Price/NCAV = ${ncavRatio.toFixed(2)}×. ` +
          `Academic studies show these generate ~20% annual returns mechanically. ` +
          `You are buying current assets (cash, receivables, inventory) at a discount to their liquidation value. ` +
          `(Benjamin Graham, Security Analysis Ch.26)`)
      } else if (ncavRatio <= 1.0) {
        audit.push(`PASS: Price below NCAV/share ($${fundamentals.ncavPerShare.toFixed(2)}) — strong asset protection. ` +
          `Not a full net-net (need <67%) but meaningful liquidation support. (Graham)`)
      }
    }
  }

  // ── Shiller Stock-Level CAPE ──────────────────────────────────────────────
  // Individual stock CAPE using 10-year real average EPS.
  // Valuation relative to the full earnings cycle is more reliable than trailing P/E.

  if (fundamentals.capeRatio !== undefined) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'ii_c14_moderate_pe')!
    if (p) {
      const capeScore = fundamentals.capeRatio <= 10 ? 1 : fundamentals.capeRatio <= 15 ? 0.85 :
        fundamentals.capeRatio <= 20 ? 0.65 : fundamentals.capeRatio <= 25 ? 0.4 : 0.1
      triggered.push({ principle: p, score: capeScore, note: `Shiller CAPE (stock-level): ${fundamentals.capeRatio.toFixed(1)}× (10-yr real avg EPS; fair value ≈ 15-20×)` })
      if (fundamentals.capeRatio <= 15) {
        audit.push(`PASS: Stock-level CAPE of ${fundamentals.capeRatio.toFixed(1)}× is below long-run fair value. ` +
          `You are buying at a discount to the full earnings cycle, not just a peak year. (Shiller)`)
      } else if (fundamentals.capeRatio > 30) {
        audit.push(`WARN: Stock-level CAPE of ${fundamentals.capeRatio.toFixed(1)}× — ` +
          `paying a significant premium to the 10-year real earnings average. ` +
          `Shiller: high CAPE predicts low 10-year returns with statistical reliability. (Robert Shiller, Irrational Exuberance)`)
      }
    }
  }

  // ── Buffett 10-Year Expected CAGR ─────────────────────────────────────────
  // The most honest valuation framing: at today's price, what annual return
  // am I locking in? Buffett's hurdle rate is ~10%. Below 7% = not worth the risk.

  if (iv.expectedCagr10yr !== undefined) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'ii_c20_margin_of_safety')!
    if (p) {
      const cagr = iv.expectedCagr10yr
      const cagrScore = cagr >= 0.15 ? 1 : cagr >= 0.12 ? 0.85 : cagr >= 0.10 ? 0.70 :
        cagr >= 0.07 ? 0.45 : cagr >= 0.04 ? 0.20 : 0
      triggered.push({ principle: p, score: cagrScore, note: `10-yr expected CAGR: ${(cagr * 100).toFixed(1)}% (Buffett hurdle: ≥10%)` })
      if (cagr >= 0.15) {
        audit.push(`PASS: 10-year expected CAGR of ${(cagr * 100).toFixed(1)}% — exceptional. ` +
          `At Buffett's hurdle of 10%, this is a high-conviction opportunity. ` +
          `Assumes EPS grows at ${((iv.growthRateUsed ?? 0.05) * 100).toFixed(1)}%/yr with exit P/E mean-reversion. (Buffett)`)
      } else if (cagr >= 0.10) {
        audit.push(`PASS: 10-year expected CAGR of ${(cagr * 100).toFixed(1)}% — meets Buffett's 10% hurdle rate. (Buffett)`)
      } else if (cagr < 0.07) {
        audit.push(`FAIL: 10-year expected CAGR of ${(cagr * 100).toFixed(1)}% — below the risk-free rate adjusted for equity risk premium. ` +
          `At this price, equities don't compensate for the uncertainty of ownership. (Buffett)`)
      }
    }
  }

  // ── Share Count Trend (Capital Allocation Quality) ────────────────────────
  // Whether management creates or destroys per-share value through capital allocation.
  // Buybacks at below-IV: per-share value compounds faster than earnings alone.
  // Dilution: every share issued at low prices is a permanent transfer from holders to issuers.

  if (fundamentals.shareCountCagr5yr !== undefined) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'bl_1990_moat_identification')!
    if (p) {
      const cagr = fundamentals.shareCountCagr5yr
      const shareScore = cagr <= -0.03 ? 1 : cagr <= -0.01 ? 0.85 : cagr <= 0.01 ? 0.65 :
        cagr <= 0.03 ? 0.30 : 0.05
      triggered.push({ principle: p, score: shareScore, note: `Share count CAGR (5yr): ${(cagr * 100).toFixed(1)}%/yr (negative = buybacks)` })
      if (cagr <= -0.02) {
        audit.push(`PASS: Shares outstanding shrinking ${Math.abs(cagr * 100).toFixed(1)}%/yr — ` +
          `management buying back stock at disciplined prices. Every share retired increases remaining holders' per-share earnings. ` +
          `Buffett: "The best investment a company can make is often its own stock, if bought intelligently." (Buffett)`)
      } else if (cagr >= 0.03) {
        audit.push(`FAIL: Share count growing ${(cagr * 100).toFixed(1)}%/yr — persistent dilution. ` +
          `Management is transferring value from existing holders to new issuances (employees, acquisitions). ` +
          `EPS growth overstates business performance; per-share compounding is impaired. (Buffett 1984: "The Superinvestors")`)
      }
    }
  }

  // ── Owner Earnings Yield vs Treasury ─────────────────────────────────────
  // Buffett's 1977 Fortune article: equities are long-duration bonds with a variable coupon.
  // When owner earnings yield > treasury + 3%, equities are cheap on an absolute basis.
  // This is the most direct answer to: "Should I buy stocks or bonds?"

  if (fundamentals.ownerEarningsYield !== undefined && fundamentals.treasuryYield10yr !== undefined) {
    const p = ALL_PRINCIPLES.find(p => p.id === 'bl_1977_owner_earnings')!
    if (p) {
      const oeYield   = fundamentals.ownerEarningsYield
      const tsy       = fundamentals.treasuryYield10yr
      const spread    = oeYield - tsy
      const spreadScore = spread >= 0.07 ? 1 : spread >= 0.05 ? 0.85 : spread >= 0.03 ? 0.65 :
        spread >= 0.01 ? 0.40 : spread >= 0 ? 0.20 : 0.05
      triggered.push({ principle: p, score: spreadScore,
        note: `OE yield: ${(oeYield * 100).toFixed(1)}% | Treasury: ${(tsy * 100).toFixed(1)}% | Spread: ${(spread * 100).toFixed(1)}%` })
      if (spread >= 0.05) {
        audit.push(`PASS: Owner earnings yield ${(oeYield * 100).toFixed(1)}% vs 10Y treasury ${(tsy * 100).toFixed(1)}% — ` +
          `${(spread * 100).toFixed(1)}% spread. Buffett 1977: ` +
          `"At this spread, equities are dramatically superior to bonds on a risk-adjusted basis." Screaming buy on absolute value. (Buffett, Fortune 1977)`)
      } else if (spread <= 0) {
        audit.push(`WARN: Owner earnings yield (${(oeYield * 100).toFixed(1)}%) is BELOW the 10-year treasury (${(tsy * 100).toFixed(1)}%). ` +
          `On an absolute yield basis, fixed income currently pays more than this equity. ` +
          `Buffett: "When bonds yield more than stocks, the logical investor buys bonds." (Buffett, 1999 speech)`)
      }
    }
  }

  // ── Insider Transactions (SEC Form 4) ─────────────────────────────────────
  // Open-market purchases by directors/officers with personal money are one of
  // the strongest return predictors in the literature (Seyhun 1998, Lakonishok 2001).
  // These people have legal inside knowledge of business trajectory. They don't
  // buy for diversification — they buy because they think it's cheap.
  // Selling is weaker signal (taxes, diversification) but cluster-selling is a warning.

  if (insider && insider.length > 0) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 90)  // look at last 90 days

    const recent = insider.filter(t => {
      if (!t.transactionDate) return false
      return new Date(t.transactionDate) >= cutoff
    })

    const recentBuys  = recent.filter(t => t.transactionType?.startsWith('P'))
    const recentSells = recent.filter(t => t.transactionType?.startsWith('S'))
    const distinctBuyers = new Set(recentBuys.map(t => t.reportingName)).size

    const p = ALL_PRINCIPLES.find(p => p.id === 'bl_1990_moat_identification')!
    if (p) {
      if (recentBuys.length >= 2 || distinctBuyers >= 2) {
        // Multiple insiders buying — very strong signal
        const insiderScore = Math.min(1, 0.5 + recentBuys.length * 0.1)
        triggered.push({ principle: p, score: insiderScore,
          note: `Insider buying: ${recentBuys.length} purchases by ${distinctBuyers} insiders (90d)` })
        audit.push(
          `PASS: ${recentBuys.length} open-market insider purchases in 90 days by ${distinctBuyers} distinct insiders. ` +
          `Seyhun (1998): cluster insider buying predicts 6-12 month outperformance with high statistical confidence. ` +
          `These people know the business better than anyone and are betting their own money.`
        )
      } else if (recentBuys.length === 1) {
        triggered.push({ principle: p, score: 0.70,
          note: `Insider buying: 1 purchase by ${recentBuys[0]?.reportingName ?? 'insider'} (90d)` })
        audit.push(
          `PASS: Insider purchase in last 90 days by ${recentBuys[0]?.reportingName ?? 'an insider'}. ` +
          `Single purchase is a moderate positive signal — watch for follow-on buying.`
        )
      } else if (recentSells.length > 0 && recentBuys.length === 0) {
        const distinctSellers = new Set(recentSells.map(t => t.reportingName)).size
        if (distinctSellers >= 3 || recentSells.length >= 4) {
          // Cluster selling with no offsetting buys — warning
          triggered.push({ principle: p, score: 0.20,
            note: `Insider selling: ${recentSells.length} sales by ${distinctSellers} insiders (90d), no buys` })
          audit.push(
            `WARN: ${recentSells.length} insider sales in 90 days by ${distinctSellers} distinct insiders with zero offsetting purchases. ` +
            `Cluster selling without buying is a warning — may indicate insiders see headwinds. ` +
            `Not a veto (selling has many benign explanations) but warrants caution.`
          )
        }
      }
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

  // Build bear-case risks array
  const f = fundamentals
  const risks: string[] = []

  // Valuation risk
  if (f.pe && f.pe > 20) risks.push(`P/E of ${f.pe.toFixed(1)}x leaves limited margin for earnings disappointment`)
  if (iv && iv.marginOfSafety < 40) risks.push(`Margin of safety of ${iv.marginOfSafety.toFixed(1)}% is thin — a 10% earnings miss could eliminate the discount`)

  // Balance sheet risk
  if (f.debtToEquity && f.debtToEquity > 0.5) risks.push(`Debt-to-equity of ${f.debtToEquity.toFixed(2)}x — rising rates or a credit crunch could compress valuation multiples`)
  if (f.currentRatio && f.currentRatio < 1.5) risks.push(`Current ratio of ${f.currentRatio.toFixed(2)} — limited liquidity buffer if business deteriorates`)

  // DCF sensitivity
  if (iv?.dcfValue) risks.push(`DCF assumes normalized growth continues — terminal value sensitive to growth rate assumptions`)

  // Macro risk
  if (f.sector) risks.push(`${f.sector} sector exposure — sector-specific regulatory, cyclical, or disruption risk`)

  // Data quality
  if (!f.freeCashFlow) risks.push('Free cash flow data unavailable — owner earnings estimate relies on accounting income')
  if (!f.eps || f.eps <= 0) risks.push('No positive earnings history to anchor valuation — speculative element present')

  if (vetoed.length > 0) {
    return {
      total: 0,
      conviction: 'avoid',
      signal: 'PASS',
      categoryScores: buildCategoryScores(triggered),
      triggeredPrinciples: triggered,
      vetoedBy: vetoed,
      auditTrail: audit,
      risks,
    }
  }

  const weightedTotal = triggered.reduce((sum, t) => sum + t.score * t.principle.weight, 0)
  const maxTotal = triggered.reduce((sum, t) => sum + t.principle.weight, 0)
  const score = maxTotal > 0 ? (weightedTotal / maxTotal) * 100 : 0

  const conviction = scoreToConviction(score, iv.marginOfSafety, criteria.overallPass, fundamentals.businessTier)
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
    risks,
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

function scoreToConviction(score: number, mos: number, grahamPass: boolean, tier?: BusinessTier): ConvictionLevel {
  // Wonderful businesses with persistent moats deserve lower score thresholds.
  // A wonderful company at 78/100 with 38% MOS is better than an adequate one at 76/100.
  // Buffett: "It's far better to buy a wonderful company at a fair price than a fair company at a wonderful price."
  const tierBoost = tier === 'wonderful' ? 5 : tier === 'good' ? 2 : 0
  const adj = score + tierBoost

  if (adj >= 85 && mos >= 40) return 'exceptional'
  if (adj >= 75 && mos >= 30 && grahamPass) return 'strong_buy'
  if (adj >= 60 && mos >= 30) return 'buy'
  if (adj >= 50 && mos >= 10) return 'watchlist'
  if (adj >= 50 && mos < 0) return 'hold'
  return 'avoid'
}

function convictionToSignal(conviction: ConvictionLevel): TradeSignal {
  switch (conviction) {
    case 'exceptional': return 'BUY'
    case 'strong_buy':  return 'BUY'
    case 'buy':         return 'BUY'
    case 'watchlist':   return 'PASS'
    case 'hold':        return 'HOLD'
    case 'avoid':       return 'PASS'
    case 'sell':        return 'SELL'
  }
}
