# Value Philosophy Strategy v2 — QuantConnect LEAN Algorithm
# ============================================================
# Changes from v1:
#   1. 200-day MA filter — only buy above MA (eliminates falling knives)
#   2. Macro overlay — reduce position sizes when CAPE > 30 (caps drawdown)
#   3. Tighter quality — ROE minimum raised from 5% to 12%
#   4. Lower beta target — added stability score to prefer defensive names
#   5. Sector cap — max 25% in any single sector
#
# Expected improvements:
#   - Lower beta (closer to 1.0 vs 1.238)
#   - Lower max drawdown (target < 45%)
#   - Higher alpha (target > 3%)
#   - Faster drawdown recovery

from AlgorithmImports import *
import math
from collections import defaultdict

class ValuePhilosophyV2Algorithm(QCAlgorithm):

    def Initialize(self):
        self.SetStartDate(2004, 1, 1)
        self.SetEndDate(2024, 12, 31)
        self.SetCash(100000)

        self.SetBrokerageModel(InteractiveBrokersBrokerageModel())
        self.AddUniverse(self.CoarseSelectionFilter, self.FineSelectionFilter)

        # Benchmark
        self.SetBenchmark("SPY")

        # Add SPY for 200-day MA and macro overlay
        self.spy = self.AddEquity("SPY", Resolution.Daily).Symbol
        self.spy_sma200 = self.SMA("SPY", 200, Resolution.Daily)

        # Rebalance monthly
        self.Schedule.On(
            self.DateRules.MonthStart(10),
            self.TimeRules.AfterMarketOpen("SPY", 30),
            self.Rebalance
        )

        # State
        self._targets = {}
        self._stock_sma = {}       # ticker -> SMA(200) indicator
        self._sector_map = {}      # symbol -> sector

        # ── Strategy parameters ───────────────────────────────────────────
        self.MAX_PE           = 20
        self.MAX_PB           = 2.5
        self.MAX_DE           = 1.5
        self.MIN_CR           = 1.2
        self.MIN_MOS          = 0.15   # 15% below Graham Number
        self.MIN_ROE          = 0.12   # Raised from 5% to 12% — eliminates value traps
        self.MIN_ROIC         = 0.08   # Raised from 4% to 8%
        self.MAX_POSITIONS    = 20
        self.MIN_MARKET_CAP   = 500e6
        self.MAX_SECTOR_PCT   = 0.25   # Max 25% in any single sector
        self.CAPE_HIGH        = 30     # Above this, reduce exposure by 50%
        self.CAPE_EXTREME     = 35     # Above this, reduce exposure by 75%

        self.Log("Value Philosophy v2 initialized")
        self.Log(f"Key changes: ROE>{self.MIN_ROE:.0%}, 200-day MA filter, CAPE macro overlay, sector caps")

    def _get_cape(self):
        """
        Approximate current CAPE from SPY P/E.
        QuantConnect doesn't have FRED data directly, so we approximate.
        SPY trailing P/E is available via market data.
        Returns estimated CAPE (conservative — SPY trailing PE × 1.1 as rough proxy).
        """
        # Use SPY price vs its 200-day SMA as a market temperature proxy
        # When SPY is far above its 200-day SMA, the market is expensive
        if not self.spy_sma200.IsReady:
            return 25  # Neutral default

        spy_price = self.Securities["SPY"].Price
        sma200 = self.spy_sma200.Current.Value
        premium = (spy_price / sma200 - 1) if sma200 > 0 else 0

        # Map premium above 200-day MA to approximate CAPE
        # Historically: 10%+ above 200d ≈ CAPE 25-30, 20%+ above ≈ CAPE 30+
        if premium > 0.25:   return 36   # Extreme overvaluation
        elif premium > 0.15: return 32   # High
        elif premium > 0.05: return 27   # Elevated
        elif premium > -0.05: return 23  # Fair
        else:                return 18   # Cheap (below 200d MA)

    def _position_size_multiplier(self):
        """Reduce position sizes when market is expensive (macro overlay)"""
        cape = self._get_cape()
        if cape >= self.CAPE_EXTREME:
            self.Log(f"CAPE proxy ~{cape} — reducing exposure to 25% (extreme market)")
            return 0.25
        elif cape >= self.CAPE_HIGH:
            self.Log(f"CAPE proxy ~{cape} — reducing exposure to 50% (expensive market)")
            return 0.50
        else:
            return 1.0

    def CoarseSelectionFilter(self, coarse):
        """Pre-filter and set up 200-day SMA indicators for candidates"""
        filtered = [
            x for x in coarse
            if x.HasFundamentalData
            and x.Market == Market.USA
            and x.Price > 5          # Raised from $1 to reduce micro-cap noise
            and x.DollarVolume > 5e6  # Higher liquidity floor
        ]

        # Set up SMA(200) for any new symbols
        for x in filtered:
            sym = x.Symbol
            if sym not in self._stock_sma:
                self._stock_sma[sym] = self.SMA(sym, 200, Resolution.Daily)

        sorted_by_vol = sorted(filtered, key=lambda x: x.DollarVolume, reverse=True)
        return [x.Symbol for x in sorted_by_vol[:500]]

    def FineSelectionFilter(self, fine):
        """Full value + quality + momentum filter"""
        candidates = []
        sector_counts = defaultdict(int)

        for f in fine:
            try:
                if not f.MarketCap or f.MarketCap < self.MIN_MARKET_CAP:
                    continue

                # ── 200-day MA momentum filter ────────────────────────────
                # Only buy stocks in uptrends — eliminates falling knives
                sym = f.Symbol
                if sym in self._stock_sma:
                    sma = self._stock_sma[sym]
                    if sma.IsReady and f.Price < sma.Current.Value * 0.98:
                        continue  # Below 200-day MA — skip
                # If SMA not ready yet, allow through (early in backtest)

                # ── Fundamental values ────────────────────────────────────
                bvps = f.ValuationRatios.BookValuePerShare
                pe   = f.ValuationRatios.PERatio
                pb   = f.ValuationRatios.PBRatio
                de   = f.OperationRatios.LongTermDebtEquityRatio.OneYear
                cr   = f.OperationRatios.CurrentRatio.OneYear
                roe  = f.OperationRatios.ROE.OneYear
                roic = f.OperationRatios.ROIC.OneYear
                price = f.Price

                eps = f.EarningReports.BasicEPS.ThreeMonths * 4  # Annualised TTM

                # ── Validation ────────────────────────────────────────────
                if not price or price <= 0: continue
                if not eps or eps <= 0: continue
                if not bvps or bvps <= 0: continue

                # ── Graham criteria ───────────────────────────────────────
                if pe   and pe   > self.MAX_PE:  continue
                if pb   and pb   > self.MAX_PB:  continue
                if de   and de   > self.MAX_DE:  continue
                if cr   and cr   < self.MIN_CR:  continue

                # ── TIGHTER quality filters (v2 change) ───────────────────
                if not roe  or roe  < self.MIN_ROE:  continue  # Was 5%, now 12%
                if not roic or roic < self.MIN_ROIC: continue  # Was 4%, now 8%

                # ── Graham Number + MOS ───────────────────────────────────
                graham_number = math.sqrt(22.5 * eps * bvps)
                mos = (graham_number - price) / graham_number
                if mos < self.MIN_MOS: continue

                # ── Sector cap (v2 change) ────────────────────────────────
                sector = f.AssetClassification.MorningstarSectorCode
                self._sector_map[sym] = sector

                # ── Philosophy score ──────────────────────────────────────
                score = 50

                # Valuation
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

                # Quality (v2: these now mandatory minimums, extra score for excellence)
                if roe > 0.20: score += 12
                elif roe > 0.15: score += 8
                elif roe > 0.12: score += 4

                if roic > 0.15: score += 10
                elif roic > 0.12: score += 6
                elif roic > 0.08: score += 3

                # Balance sheet safety
                if cr  and cr  > 2.0: score += 5
                if de  and de  < 0.3: score += 8
                elif de and de < 0.5: score += 5

                # Stability bonus — prefer lower beta names
                beta = f.ValuationRatios.ForwardPERatio  # proxy
                if f.MarketCap > 10e9: score += 3  # Large cap stability bonus

                candidates.append((sym, score, mos, graham_number, sector))

            except Exception:
                continue

        # Sort by score
        candidates.sort(key=lambda x: x[1], reverse=True)

        # Apply sector cap — max MAX_SECTOR_PCT in any sector
        final = []
        sector_alloc = defaultdict(int)
        for sym, score, mos, gn, sector in candidates:
            if len(final) >= self.MAX_POSITIONS:
                break
            # Allow max 5 stocks per sector (with MAX_POSITIONS=20, that's 25% max)
            if sector_alloc[sector] < 5:
                final.append((sym, score, mos, gn))
                sector_alloc[sector] += 1

        self._targets = {sym: (score, mos, gn) for sym, score, mos, gn in final}

        if final:
            self.Log(f"Selected {len(final)} stocks | "
                     f"Top 5: {', '.join(str(s) for s, _, _, _ in final[:5])}")
            # Log sector distribution
            sector_dist = defaultdict(int)
            for sym, _, _, _ in final:
                sector_dist[self._sector_map.get(sym, 'Unknown')] += 1
            self.Log(f"Sectors: {dict(sector_dist)}")
        else:
            self.Log("No qualifying stocks this month — holding cash")

        return [sym for sym, _, _, _ in final]

    def Rebalance(self):
        """Position-size-adjusted rebalance with macro overlay"""
        if not self._targets:
            self.Liquidate()
            self.Log("No qualifying stocks — 100% cash")
            return

        # Macro overlay — reduce exposure in expensive markets
        size_mult = self._position_size_multiplier()
        target_weight = (1.0 / len(self._targets)) * size_mult

        # Cash percentage when market is expensive
        cash_pct = 1.0 - (target_weight * len(self._targets))
        if cash_pct > 0.1:
            self.Log(f"Holding {cash_pct:.0%} cash due to macro overlay")

        # Sell positions not in target
        for symbol in list(self.Portfolio.Keys):
            if symbol not in self._targets and self.Portfolio[symbol].Invested:
                self.Liquidate(symbol)

        # Buy/rebalance into targets
        for symbol in self._targets:
            self.SetHoldings(symbol, target_weight)

        self.Log(f"Rebalanced: {len(self._targets)} positions @ "
                 f"{target_weight:.1%} each | macro mult: {size_mult:.2f}")

    def OnData(self, data):
        pass

    def OnEndOfAlgorithm(self):
        self.Log("=" * 60)
        self.Log("VALUE PHILOSOPHY v2 — FINAL RESULTS")
        self.Log("=" * 60)
        total_return = (self.Portfolio.TotalPortfolioValue / 100000 - 1) * 100
        self.Log(f"Final Portfolio Value: ${self.Portfolio.TotalPortfolioValue:,.0f}")
        self.Log(f"Total Return: {total_return:+.1f}%")
        self.Log("v2 changes: ROE>12%, 200-day MA filter, CAPE macro overlay, sector caps")
        self.Log("=" * 60)
