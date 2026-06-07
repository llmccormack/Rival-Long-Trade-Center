# Value Philosophy Strategy v2 — QuantConnect LEAN Algorithm
# Fixed: 200-day MA calculated via History() instead of SMA indicators
# (SMA indicators require AddSecurity() — History() works for any symbol)

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
        self.SetBenchmark("SPY")

        # SPY for macro overlay only
        self.spy = self.AddEquity("SPY", Resolution.Daily).Symbol
        self.spy_sma200 = self.SMA("SPY", 200, Resolution.Daily)

        # Rebalance monthly
        self.Schedule.On(
            self.DateRules.MonthStart(10),
            self.TimeRules.AfterMarketOpen("SPY", 30),
            self.Rebalance
        )

        self._targets = {}
        self._sector_map = {}

        # Strategy parameters
        self.MAX_PE          = 20
        self.MAX_PB          = 2.5
        self.MAX_DE          = 1.5
        self.MIN_CR          = 1.2
        self.MIN_MOS         = 0.15
        self.MIN_ROE         = 0.12
        self.MIN_ROIC        = 0.08
        self.MAX_POSITIONS   = 20
        self.MIN_MARKET_CAP  = 500e6
        self.CAPE_HIGH       = 30
        self.CAPE_EXTREME    = 35

        self.Log("Value Philosophy v2 initialized — 200d MA via History(), macro overlay, ROE>12%")

    def _get_cape_proxy(self):
        """Approximate market valuation from SPY vs its 200-day SMA"""
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
            self.Log(f"Market expensive (CAPE proxy ~{cape}) — 25% exposure")
            return 0.25
        elif cape >= self.CAPE_HIGH:
            self.Log(f"Market elevated (CAPE proxy ~{cape}) — 50% exposure")
            return 0.50
        return 1.0

    def CoarseSelectionFilter(self, coarse):
        """Pre-filter — NO indicator creation here"""
        filtered = [
            x for x in coarse
            if x.HasFundamentalData
            and x.Market == Market.USA
            and x.Price > 5
            and x.DollarVolume > 5e6
        ]
        sorted_by_vol = sorted(filtered, key=lambda x: x.DollarVolume, reverse=True)
        return [x.Symbol for x in sorted_by_vol[:500]]

    def FineSelectionFilter(self, fine):
        """Full value + quality + 200-day MA filter using History()"""
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

                # Basic validation
                if not price or price <= 0: continue
                if not eps   or eps   <= 0: continue
                if not bvps  or bvps  <= 0: continue

                # Graham criteria
                if pe  and pe  > self.MAX_PE: continue
                if pb  and pb  > self.MAX_PB: continue
                if de  and de  > self.MAX_DE: continue
                if cr  and cr  < self.MIN_CR: continue

                # Quality filters (tightened in v2)
                if not roe  or roe  < self.MIN_ROE:  continue
                if not roic or roic < self.MIN_ROIC: continue

                # Graham Number + MOS
                graham_number = math.sqrt(22.5 * eps * bvps)
                mos = (graham_number - price) / graham_number
                if mos < self.MIN_MOS: continue

                # 200-day MA momentum filter — use History() instead of SMA indicator
                # Only buy stocks in uptrend (avoids falling knives)
                try:
                    hist = self.History(sym, 200, Resolution.Daily)
                    if not hist.empty and 'close' in hist.columns:
                        sma200 = float(hist['close'].mean())
                        if price < sma200 * 0.98:
                            continue  # Below 200-day MA — skip
                except Exception:
                    pass  # If history unavailable, allow through

                # Sector
                sector = f.AssetClassification.MorningstarSectorCode
                self._sector_map[sym] = sector

                # Philosophy score
                score = 50

                if mos > 0.40:   score += 20
                elif mos > 0.30: score += 15
                elif mos > 0.20: score += 10
                else:            score += 5

                if pe and pe < 12:   score += 15
                elif pe and pe < 15: score += 10
                elif pe and pe < 20: score += 5

                if pb and pb < 1.0:   score += 10
                elif pb and pb < 1.5: score += 6
                elif pb and pb < 2.0: score += 3

                if roe > 0.20:   score += 12
                elif roe > 0.15: score += 8
                elif roe > 0.12: score += 4

                if roic > 0.15:   score += 10
                elif roic > 0.12: score += 6
                elif roic > 0.08: score += 3

                if cr and cr > 2.0:  score += 5
                if de and de < 0.3:  score += 8
                elif de and de < 0.5: score += 5

                if f.MarketCap > 10e9: score += 3  # Large-cap stability

                candidates.append((sym, score, mos, graham_number, sector))

            except Exception:
                continue

        # Sort by score
        candidates.sort(key=lambda x: x[1], reverse=True)

        # Apply sector cap — max 5 stocks per sector
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
            self.Log(f"Selected {len(final)} | Top 5: {', '.join(str(s) for s,_,_,_ in final[:5])}")
        else:
            self.Log("No qualifying stocks — holding cash")

        return [sym for sym, _, _, _ in final]

    def Rebalance(self):
        if not self._targets:
            self.Liquidate()
            self.Log("No qualifying stocks — 100% cash")
            return

        size_mult = self._position_size_multiplier()
        target_weight = (1.0 / len(self._targets)) * size_mult

        cash_pct = 1.0 - (target_weight * len(self._targets))
        if cash_pct > 0.1:
            self.Log(f"Holding {cash_pct:.0%} cash (macro overlay)")

        # Sell anything not in target
        for symbol in list(self.Portfolio.Keys):
            if symbol not in self._targets and self.Portfolio[symbol].Invested:
                self.Liquidate(symbol)

        # Buy/rebalance targets
        for symbol in self._targets:
            self.SetHoldings(symbol, target_weight)

        self.Log(f"Rebalanced: {len(self._targets)} positions @ {target_weight:.1%} | macro mult: {size_mult:.2f}")

    def OnData(self, data):
        pass

    def OnEndOfAlgorithm(self):
        total_return = (self.Portfolio.TotalPortfolioValue / 100000 - 1) * 100
        self.Log("=" * 50)
        self.Log(f"Final: ${self.Portfolio.TotalPortfolioValue:,.0f} | Return: {total_return:+.1f}%")
        self.Log("v2: ROE>12%, History()-based 200d MA, macro overlay, sector caps")
        self.Log("=" * 50)
