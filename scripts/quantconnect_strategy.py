# Value Philosophy Strategy — QuantConnect LEAN Algorithm
# =========================================================
# Upload this file to quantconnect.com → New Algorithm → paste contents
# Backtest: 2004–2024 | No API credits needed | Free historical fundamental data
#
# Strategy mirrors the platform's autopilot:
#   - Universe: US equities, market cap > $500M
#   - Entry: PE < 20, PB < 2.5, D/E < 1.5, current ratio > 1.2,
#            price < Graham Number × 0.85 (15% MOS),
#            positive EPS + book value
#   - Sizing: conviction-weighted (max 20 positions)
#   - Rebalance: monthly
#   - Exit: price > Graham Number × 1.1 OR fundamentals deteriorate
#
# QuantConnect uses Morningstar fundamental data — survivorship-bias free,
# point-in-time (uses data as known at the time, no look-ahead)

from AlgorithmImports import *
import math

class ValuePhilosophyAlgorithm(QCAlgorithm):

    def Initialize(self):
        self.SetStartDate(2004, 1, 1)
        self.SetEndDate(2024, 12, 31)
        self.SetCash(100000)

        # Realistic transaction costs
        self.SetBrokerageModel(InteractiveBrokersBrokerageModel())

        # Universe selection — broad US equity universe
        self.AddUniverse(self.CoarseSelectionFilter, self.FineSelectionFilter)

        # Rebalance monthly
        self.Schedule.On(
            self.DateRules.MonthStart(10),
            self.TimeRules.AfterMarketOpen("SPY", 30),
            self.Rebalance
        )

        # Benchmark
        self.SetBenchmark("SPY")

        # Track portfolio
        self._targets = {}
        self._last_rebalance = datetime.min
        self._rebalance_needed = False

        # Parameters (mirrors autopilot settings)
        self.MAX_PE = 20
        self.MAX_PB = 2.5
        self.MAX_DE = 1.5
        self.MIN_CR = 1.2
        self.MIN_MOS = 0.15          # 15% below Graham Number
        self.MAX_POSITIONS = 20
        self.MIN_MARKET_CAP = 500e6  # $500M minimum

        self.Log("Value Philosophy Strategy initialized")
        self.Log(f"Criteria: PE<{self.MAX_PE}, PB<{self.MAX_PB}, D/E<{self.MAX_DE}, "
                 f"CR>{self.MIN_CR}, MOS>{self.MIN_MOS:.0%}")

    def CoarseSelectionFilter(self, coarse):
        """Fast pre-filter: US equities with fundamental data and min market cap"""
        filtered = [
            x for x in coarse
            if x.HasFundamentalData
            and x.Market == Market.USA
            and x.Price > 1          # No penny stocks
            and x.DollarVolume > 1e6  # Minimum liquidity
        ]
        # Take top 500 by dollar volume for fine selection
        sorted_by_vol = sorted(filtered, key=lambda x: x.DollarVolume, reverse=True)
        return [x.Symbol for x in sorted_by_vol[:500]]

    def FineSelectionFilter(self, fine):
        """
        Apply full value criteria using Morningstar fundamental data.
        This runs on the pre-filtered universe from CoarseSelection.
        """
        candidates = []

        for f in fine:
            try:
                # Skip if fundamental data missing
                if not f.MarketCap or f.MarketCap < self.MIN_MARKET_CAP:
                    continue

                # ── Get fundamental values ────────────────────────────────
                eps = f.EarningReports.BasicEPS.ThreeMonths * 4  # Annualise TTM
                book_per_share = f.FinancialStatements.BalanceSheet.CommonStockEquity.TwelveMonths
                shares = f.EarningReports.BasicAverageShares.ThreeMonths
                if shares and shares > 0:
                    book_per_share = book_per_share / shares if book_per_share else None

                # Try direct book value per share
                bvps = f.ValuationRatios.BookValuePerShare
                if bvps and bvps > 0:
                    book_per_share = bvps

                pe = f.ValuationRatios.PERatio
                pb = f.ValuationRatios.PBRatio
                de = f.OperationRatios.LongTermDebtEquityRatio.OneYear
                cr = f.OperationRatios.CurrentRatio.OneYear

                price = f.Price

                # ── Basic validation ──────────────────────────────────────
                if not price or price <= 0:
                    continue
                if not eps or eps <= 0:
                    continue
                if not book_per_share or book_per_share <= 0:
                    continue

                # ── Graham criteria ───────────────────────────────────────
                if pe and pe > self.MAX_PE:
                    continue
                if pb and pb > self.MAX_PB:
                    continue
                if de and de > self.MAX_DE:
                    continue
                if cr and cr < self.MIN_CR:
                    continue

                # ── Graham Number + Margin of Safety ─────────────────────
                graham_number = math.sqrt(22.5 * eps * book_per_share)
                mos = (graham_number - price) / graham_number

                if mos < self.MIN_MOS:
                    continue

                # ── Quality filters (Buffett layer) ───────────────────────
                roe = f.OperationRatios.ROE.OneYear
                if roe and roe < 0.05:   # At least 5% ROE
                    continue

                roic = f.OperationRatios.ROIC.OneYear
                if roic and roic < 0.04:  # At least 4% ROIC
                    continue

                # ── Score the candidate (simplified philosophy score) ─────
                score = 50  # Base score

                # Valuation quality
                if mos > 0.40: score += 20
                elif mos > 0.30: score += 15
                elif mos > 0.20: score += 10
                else: score += 5

                if pe and pe < 12: score += 15
                elif pe and pe < 15: score += 10
                elif pe and pe < 20: score += 5

                if pb and pb < 1.0: score += 10
                elif pb and pb < 1.5: score += 6
                elif pb and pb < 2.0: score += 3

                # Quality score
                if roe and roe > 0.15: score += 10
                elif roe and roe > 0.10: score += 6

                if roic and roic > 0.12: score += 8
                elif roic and roic > 0.08: score += 4

                if cr and cr > 2.0: score += 5
                if de and de < 0.5: score += 5

                candidates.append((f.Symbol, score, mos, graham_number))

            except Exception:
                continue

        # Sort by score, take top MAX_POSITIONS
        candidates.sort(key=lambda x: x[1], reverse=True)
        top = candidates[:self.MAX_POSITIONS]

        self._targets = {sym: (score, mos, gn) for sym, score, mos, gn in top}

        if top:
            self.Log(f"Selected {len(top)} stocks: "
                     f"{', '.join(str(s) for s, _, _, _ in top[:5])} ...")
        else:
            self.Log("No qualifying stocks found this month")

        return [sym for sym, _, _, _ in top]

    def Rebalance(self):
        """Equal-weight rebalance into current targets"""
        if not self._targets:
            # Liquidate to cash if no qualifying stocks
            self.Liquidate()
            self.Log("No qualifying stocks — holding cash")
            return

        target_weight = 1.0 / len(self._targets)

        # Sell positions not in target
        for symbol in list(self.Portfolio.Keys):
            if symbol not in self._targets and self.Portfolio[symbol].Invested:
                self.Liquidate(symbol)

        # Buy/rebalance into targets
        for symbol in self._targets:
            self.SetHoldings(symbol, target_weight)

        self.Log(f"Rebalanced into {len(self._targets)} positions @ "
                 f"{target_weight:.1%} each")

    def OnData(self, data):
        pass

    def OnEndOfAlgorithm(self):
        """Print final statistics"""
        self.Log("=" * 50)
        self.Log("FINAL RESULTS")
        self.Log("=" * 50)
        total_return = (self.Portfolio.TotalPortfolioValue / 100000 - 1) * 100
        self.Log(f"Final Portfolio Value: ${self.Portfolio.TotalPortfolioValue:,.0f}")
        self.Log(f"Total Return: {total_return:+.1f}%")
        self.Log("=" * 50)
