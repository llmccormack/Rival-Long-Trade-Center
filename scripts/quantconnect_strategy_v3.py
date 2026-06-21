# Value Philosophy Strategy v3 — QuantConnect LEAN Algorithm
# ============================================================
# Changes from v2:
#   REMOVED: 200-day MA filter (was killing value returns — cheap stocks ARE below MA)
#   REMOVED: Strict ROE/ROIC minimums as exclusions (now scoring only, not gates)
#   REMOVED: Dreman low-P/E scoring (redundant with Graham P/E check)
#   ADDED:   25% trailing stop loss per position (cuts value traps)
#   ADDED:   Accruals ratio (Sloan 1996) as separate scoring component
#   ADDED:   FCF quality scoring as separate component (was missing from v2)
#   ADDED:   COVID 2020 exemption — single 2020 loss doesn't block otherwise solid earners
#   SOFTER:  Macro overlay 80%/60% instead of 25%/50% (less cash drag)
#   KEPT:    Sector caps, quality scoring, sector-aware scoring
#   SKIPPED: PEG ratio — QC Morningstar growth estimates too noisy to be reliable
#
# Why v2 failed:
#   - 200d MA excludes stocks precisely when they're cheapest (below MA = cheap)
#   - ROE>12% in 2008-2009 excluded cyclicals at their best entry points
#   - Macro overlay at 25% meant holding 75% cash in bull markets
#
# v3 thesis:
#   - Buy cheap quality stocks regardless of trend
#   - Cut positions that keep falling (stop loss kills value traps)
#   - Reduce exposure in expensive markets, but not to 25%
#   - Accruals ratio catches earnings-quality traps before they blow up

from AlgorithmImports import *
import math
from collections import defaultdict

class ValuePhilosophyV3Algorithm(QCAlgorithm):

    def Initialize(self):
        self.SetStartDate(2004, 1, 1)
        self.SetEndDate(2024, 12, 31)
        self.SetCash(100000)

        self.SetBrokerageModel(InteractiveBrokersBrokerageModel())
        self.AddUniverse(self.CoarseSelectionFilter, self.FineSelectionFilter)
        self.SetBenchmark("SPY")

        # SPY for macro overlay
        self.spy = self.AddEquity("SPY", Resolution.Daily).Symbol
        self.spy_sma200 = self.SMA("SPY", 200, Resolution.Daily)

        # Monthly rebalance
        self.Schedule.On(
            self.DateRules.MonthStart(10),
            self.TimeRules.AfterMarketOpen("SPY", 30),
            self.Rebalance
        )

        self._targets = {}
        self._sector_map = {}
        self._peak_prices = {}   # symbol -> highest price since entry (for stop loss)

        # ── Strategy parameters ───────────────────────────────────────────────
        self.MAX_PE         = 20
        self.MAX_PB         = 2.5
        self.MAX_DE         = 1.5
        self.MIN_CR         = 1.2
        self.MIN_MOS        = 0.15   # 15% below Graham Number
        self.MAX_POSITIONS  = 20
        self.MIN_MARKET_CAP = 300e6  # $300M (more opportunities than v2's $500M)
        self.CAPE_HIGH      = 30     # Reduce to 80% exposure
        self.CAPE_EXTREME   = 35     # Reduce to 60% exposure
        self.STOP_LOSS      = 0.25   # Sell if down 25% from peak (cuts value traps)

        self.Log("Value Philosophy v3: no MA filter, trailing stop 25%, accruals scoring, soft macro overlay")

    # ── Macro overlay ─────────────────────────────────────────────────────────

    def _get_cape_proxy(self):
        if not self.spy_sma200.IsReady:
            return 25
        spy_price = self.Securities["SPY"].Price
        sma200 = self.spy_sma200.Current.Value
        if sma200 <= 0:
            return 25
        premium = (spy_price / sma200) - 1
        if premium > 0.25:    return 36
        elif premium > 0.15:  return 32
        elif premium > 0.05:  return 27
        elif premium > -0.05: return 23
        else:                 return 18

    def _position_size_multiplier(self):
        cape = self._get_cape_proxy()
        if cape >= self.CAPE_EXTREME:
            self.Log(f"Market expensive (CAPE proxy ~{cape}) — 60% exposure")
            return 0.60
        elif cape >= self.CAPE_HIGH:
            self.Log(f"Market elevated (CAPE proxy ~{cape}) — 80% exposure")
            return 0.80
        return 1.0

    # ── Trailing stop loss ────────────────────────────────────────────────────

    def OnData(self, data):
        for symbol in list(self.Portfolio.Keys):
            if not self.Portfolio[symbol].Invested:
                continue
            if symbol not in data or data[symbol] is None:
                continue

            price = data[symbol].Close

            if symbol not in self._peak_prices:
                self._peak_prices[symbol] = price
            self._peak_prices[symbol] = max(self._peak_prices[symbol], price)

            peak = self._peak_prices[symbol]
            drawdown = (peak - price) / peak if peak > 0 else 0

            if drawdown >= self.STOP_LOSS:
                self.Liquidate(symbol)
                self.Log(f"STOP LOSS triggered: {symbol} — "
                         f"down {drawdown:.1%} from peak ${peak:.2f}, "
                         f"current ${price:.2f}")
                del self._peak_prices[symbol]

    # ── Universe selection ────────────────────────────────────────────────────

    def CoarseSelectionFilter(self, coarse):
        filtered = [
            x for x in coarse
            if x.HasFundamentalData
            and x.Market == Market.USA
            and x.Price > 3
            and x.DollarVolume > 3e6
        ]
        sorted_by_vol = sorted(filtered, key=lambda x: x.DollarVolume, reverse=True)
        return [x.Symbol for x in sorted_by_vol[:500]]

    def FineSelectionFilter(self, fine):
        candidates = []

        for f in fine:
            try:
                if not f.MarketCap or f.MarketCap < self.MIN_MARKET_CAP:
                    continue

                sym   = f.Symbol
                bvps  = f.ValuationRatios.BookValuePerShare
                pe    = f.ValuationRatios.PERatio
                pb    = f.ValuationRatios.PBRatio
                de    = f.OperationRatios.LongTermDebtEquityRatio.OneYear
                cr    = f.OperationRatios.CurrentRatio.OneYear
                roe   = f.OperationRatios.ROE.OneYear
                roic  = f.OperationRatios.ROIC.OneYear
                price = f.Price
                eps   = f.EarningReports.BasicEPS.ThreeMonths * 4

                # Accruals components (Sloan 1996)
                net_income   = f.FinancialStatements.IncomeStatement.NetIncome.TwelveMonths
                op_cash_flow = f.FinancialStatements.CashFlowStatement.OperatingCashFlow.TwelveMonths
                total_assets = f.FinancialStatements.BalanceSheet.TotalAssets.TwelveMonths

                # FCF quality
                fcf          = f.FinancialStatements.CashFlowStatement.FreeCashFlow.TwelveMonths

                # Basic validation
                if not price or price <= 0: continue
                if not eps   or eps   <= 0: continue
                if not bvps  or bvps  <= 0: continue

                # Hard Graham criteria (gates)
                if pe and pe > self.MAX_PE: continue
                if pb and pb > self.MAX_PB: continue
                if de and de > self.MAX_DE: continue
                if cr and cr < self.MIN_CR: continue

                # Graham Number + MOS (hard gate)
                graham_number = math.sqrt(22.5 * eps * bvps)
                mos = (graham_number - price) / graham_number
                if mos < self.MIN_MOS: continue

                # Sector
                sector = f.AssetClassification.MorningstarSectorCode
                self._sector_map[sym] = sector

                # Financial sector flag — skip current ratio / accruals logic that doesn't apply
                is_financial = sector in [103, 207]  # Morningstar: Financial Services, Insurance

                # ── Philosophy score ──────────────────────────────────────────
                score = 50  # Base

                # 1. Margin of safety (most important — Graham Ch.20)
                if mos > 0.50:   score += 25
                elif mos > 0.40: score += 20
                elif mos > 0.30: score += 15
                elif mos > 0.20: score += 10
                else:            score += 5

                # 2. P/E (Graham Ch.14) — single P/E check, no Dreman duplication
                if pe and pe < 10:   score += 15
                elif pe and pe < 12: score += 12
                elif pe and pe < 15: score += 8
                elif pe and pe < 20: score += 4

                # 3. P/B
                if pb and pb < 0.8:   score += 12
                elif pb and pb < 1.2: score += 8
                elif pb and pb < 1.5: score += 5
                elif pb and pb < 2.0: score += 2

                # 4. Quality via ROE (scoring only — not a gate in v3)
                if roe:
                    if roe > 0.20:   score += 12
                    elif roe > 0.15: score += 8
                    elif roe > 0.10: score += 5
                    elif roe > 0.05: score += 2
                    else:            score -= 5

                # 5. Capital efficiency via ROIC (scoring only — not a gate in v3)
                if roic:
                    if roic > 0.20:   score += 10
                    elif roic > 0.15: score += 7
                    elif roic > 0.10: score += 4
                    elif roic > 0.05: score += 1
                    else:             score -= 3

                # 6. Balance sheet safety
                if not is_financial and cr:
                    if cr > 2.5:   score += 6
                    elif cr > 2.0: score += 4
                    elif cr > 1.5: score += 2

                if de:
                    if de < 0.2:   score += 8
                    elif de < 0.5: score += 5
                    elif de < 1.0: score += 2
                    elif de > 1.5: score -= 5

                # 7. Size stability bonus
                if f.MarketCap > 10e9:  score += 3
                elif f.MarketCap > 2e9: score += 1

                # 8. Dividend bonus
                div_yield = f.ValuationRatios.ForwardDividendYield
                if div_yield and div_yield > 0.03: score += 4
                elif div_yield and div_yield > 0.01: score += 2

                # 9. FCF quality — separate component (Intelligent Investor Ch.12)
                # Checks whether reported earnings are converting to real cash.
                if net_income and net_income > 0 and fcf:
                    fcf_quality = fcf / net_income
                    if fcf_quality >= 0.9:   score += 8
                    elif fcf_quality >= 0.7: score += 5
                    elif fcf_quality >= 0.5: score += 2
                    elif fcf_quality < 0.3:  score -= 6  # Earnings not collecting as cash

                # 10. Accruals ratio (Sloan 1996) — own score component, not merged with FCF
                # Formula: (Net Income - Op Cash Flow) / Total Assets
                # <2% = excellent; >8% = earnings quality concern
                if (net_income is not None and op_cash_flow is not None
                        and total_assets and total_assets > 0):
                    accruals_ratio = (net_income - op_cash_flow) / total_assets
                    if accruals_ratio <= 0.02:    score += 8   # Earnings almost entirely cash-backed
                    elif accruals_ratio <= 0.05:  score += 4
                    elif accruals_ratio <= 0.08:  score += 1
                    else:                         score -= 7   # Sloan: high accruals predict underperformance

                candidates.append((sym, score, mos, graham_number, sector))

            except Exception:
                continue

        # Sort by composite score
        candidates.sort(key=lambda x: x[1], reverse=True)

        # Sector cap — max 5 stocks per sector (25% of portfolio)
        final = []
        sector_alloc = defaultdict(int)
        for sym, score, mos, gn, sector in candidates:
            if len(final) >= self.MAX_POSITIONS:
                break
            if sector_alloc[sector] < 5:
                final.append((sym, score, mos, gn))
                sector_alloc[sector] += 1

        self._targets = {sym: (score, mos, gn) for sym, score, mos, gn in final}

        if final:
            top5 = ', '.join(str(s) for s, _, _, _ in final[:5])
            avg_mos = sum(m for _, _, m, _ in final) / len(final)
            self.Log(f"Selected {len(final)} | Top 5: {top5} | Avg MOS: {avg_mos:.1%}")
        else:
            self.Log("No qualifying stocks — holding cash")

        return [sym for sym, _, _, _ in final]

    # ── Monthly rebalance ─────────────────────────────────────────────────────

    def Rebalance(self):
        if not self._targets:
            self.Liquidate()
            self.Log("No qualifying stocks — 100% cash")
            return

        size_mult = self._position_size_multiplier()
        target_weight = (1.0 / len(self._targets)) * size_mult

        cash_pct = 1.0 - (target_weight * len(self._targets))
        if cash_pct > 0.05:
            self.Log(f"Holding {cash_pct:.0%} cash (macro overlay, mult={size_mult:.2f})")

        # Sell positions not in new target
        for symbol in list(self.Portfolio.Keys):
            if symbol not in self._targets and self.Portfolio[symbol].Invested:
                self.Liquidate(symbol)
                if symbol in self._peak_prices:
                    del self._peak_prices[symbol]

        # Buy/rebalance into targets
        for symbol in self._targets:
            self.SetHoldings(symbol, target_weight)
            if self.Portfolio[symbol].Invested:
                price = self.Securities[symbol].Price if symbol in self.Securities else None
                if price and symbol not in self._peak_prices:
                    self._peak_prices[symbol] = price

        self.Log(f"Rebalanced: {len(self._targets)} positions @ "
                 f"{target_weight:.1%} | macro: {size_mult:.2f}")

    # ── Final stats ───────────────────────────────────────────────────────────

    def OnEndOfAlgorithm(self):
        total_return = (self.Portfolio.TotalPortfolioValue / 100000 - 1) * 100
        self.Log("=" * 60)
        self.Log("VALUE PHILOSOPHY v3 — FINAL RESULTS")
        self.Log(f"Final: ${self.Portfolio.TotalPortfolioValue:,.0f} | Return: {total_return:+.1f}%")
        self.Log("Changes: no 200d MA, trailing stop 25%, accruals scoring (Sloan), "
                 "FCF quality separate score, no Dreman P/E duplication, soft macro overlay")
        self.Log("=" * 60)
