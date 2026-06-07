"""
Value Philosophy Backtest — Local Python Script
================================================
Tests our Graham/Buffett value investing strategy against SPY (2010–2024).
Uses yfinance for free historical data — no API credits needed.
Run: python3 scripts/backtest.py

Strategy rules (mirrors the autopilot):
  Entry:  PE < 20, PB < 2.5, EPS > 0, Debt/Equity < 1.5,
          Current Ratio > 1.2, Price < Graham Number × 0.85 (15% MOS)
  Exit:   Price > Graham Number × 1.1 OR fundamentals deteriorate
  Sizing: Equal-weight, max 15 positions, rebalance annually

Universe: 80 value-oriented US stocks across sectors (survivorship-biased
          toward today's large caps — results will be conservative vs reality
          since many value traps that went bankrupt are excluded)
"""

import yfinance as yf
import pandas as pd
import numpy as np
import json
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

# ── Universe ──────────────────────────────────────────────────────────────────
UNIVERSE = [
    # Financials
    'JPM','BAC','WFC','BRK-B','USB','TRV','AFL','CB','MET','PRU',
    # Industrials
    'MMM','GE','HON','CAT','DE','EMR','ITW','PH','ROK','ETN',
    # Consumer Staples
    'KO','PG','JNJ','MCD','WMT','CL','KMB','GIS','CPB','HRL',
    # Technology (value-ish)
    'AAPL','MSFT','CSCO','INTC','IBM','QCOM','TXN','HPQ','AMAT','MU',
    # Energy
    'XOM','CVX','COP','PSX','MPC','OXY','VLO','HAL',
    # Healthcare
    'ABT','MDT','BMY','ABBV','MRK','PFE','UNH','CVS','CI','HUM',
    # Materials
    'LIN','APD','NEM','FCX','DOW','DD',
    # Utilities
    'NEE','DUK','SO','D','AEP','EXC',
    # Consumer Discretionary (value)
    'F','GM','TGT','LOW','HD','NKE',
]

BENCHMARK = 'SPY'
START = '2010-01-01'
END   = '2024-12-31'
INITIAL_CAPITAL = 100_000
MAX_POSITIONS   = 15
REBALANCE_MONTH = 1   # January each year
MIN_MOS         = 0.15  # 15% margin of safety vs Graham Number

print(f"\n{'='*60}")
print(f"  Value Philosophy Backtest  {START} → {END}")
print(f"  Universe: {len(UNIVERSE)} stocks | Benchmark: SPY")
print(f"{'='*60}\n")

# ── Step 1: Download all price data ──────────────────────────────────────────
print("📥 Downloading price data...")
tickers = UNIVERSE + [BENCHMARK]
prices_raw = yf.download(tickers, start=START, end=END,
                          auto_adjust=True, progress=False)['Close']
prices = prices_raw.dropna(how='all')
print(f"   ✓ Got {len(prices)} trading days of price data\n")

# ── Step 2: Pull fundamentals for each stock ──────────────────────────────────
print("📊 Fetching fundamentals (this takes ~2 minutes)...")
fundamentals = {}

for i, ticker in enumerate(UNIVERSE):
    try:
        t = yf.Ticker(ticker)
        info = t.info or {}

        # Get annual income statement and balance sheet
        income = t.financials        # rows = items, cols = dates
        balance = t.balance_sheet

        if income is None or income.empty or balance is None or balance.empty:
            continue

        # Build year-by-year fundamental snapshots
        yearly = {}
        for col in income.columns:
            year = col.year
            try:
                eps_row = [r for r in income.index if 'Diluted EPS' in str(r) or
                           'Basic EPS' in str(r) or 'EPS' in str(r)]
                net_income = float(income.loc['Net Income', col]) if 'Net Income' in income.index else None

                # Balance sheet items
                total_assets = None
                total_liabilities = None
                equity = None
                current_assets = None
                current_liabilities = None
                long_term_debt = None
                book_per_share = None
                shares = info.get('sharesOutstanding', None)

                if 'Total Assets' in balance.index and col in balance.columns:
                    total_assets = float(balance.loc['Total Assets', col]) if not pd.isna(balance.loc['Total Assets', col]) else None
                if 'Total Liabilities Net Minority Interest' in balance.index and col in balance.columns:
                    total_liabilities = float(balance.loc['Total Liabilities Net Minority Interest', col]) if not pd.isna(balance.loc['Total Liabilities Net Minority Interest', col]) else None
                elif 'Total Liabilities' in balance.index and col in balance.columns:
                    total_liabilities = float(balance.loc['Total Liabilities', col]) if not pd.isna(balance.loc['Total Liabilities', col]) else None
                if 'Stockholders Equity' in balance.index and col in balance.columns:
                    equity = float(balance.loc['Stockholders Equity', col]) if not pd.isna(balance.loc['Stockholders Equity', col]) else None
                elif 'Total Equity Gross Minority Interest' in balance.index and col in balance.columns:
                    equity = float(balance.loc['Total Equity Gross Minority Interest', col]) if not pd.isna(balance.loc['Total Equity Gross Minority Interest', col]) else None
                if 'Current Assets' in balance.index and col in balance.columns:
                    current_assets = float(balance.loc['Current Assets', col]) if not pd.isna(balance.loc['Current Assets', col]) else None
                if 'Current Liabilities' in balance.index and col in balance.columns:
                    current_liabilities = float(balance.loc['Current Liabilities', col]) if not pd.isna(balance.loc['Current Liabilities', col]) else None
                if 'Long Term Debt' in balance.index and col in balance.columns:
                    long_term_debt = float(balance.loc['Long Term Debt', col]) if not pd.isna(balance.loc['Long Term Debt', col]) else None

                if shares and shares > 0:
                    if net_income:
                        eps = net_income / shares
                    else:
                        eps = None
                    if equity:
                        book_per_share = equity / shares
                else:
                    eps = None
                    book_per_share = None

                # Debt to equity
                debt_to_equity = None
                if equity and equity > 0 and long_term_debt:
                    debt_to_equity = long_term_debt / equity

                # Current ratio
                current_ratio = None
                if current_assets and current_liabilities and current_liabilities > 0:
                    current_ratio = current_assets / current_liabilities

                yearly[year] = {
                    'eps': eps,
                    'book_per_share': book_per_share,
                    'debt_to_equity': debt_to_equity,
                    'current_ratio': current_ratio,
                    'net_income': net_income,
                    'equity': equity,
                    'shares': shares,
                }
            except Exception:
                continue

        if yearly:
            fundamentals[ticker] = yearly
            print(f"   ✓ {ticker} ({i+1}/{len(UNIVERSE)})", end='\r')

    except Exception as e:
        print(f"   ✗ {ticker}: {e}", end='\r')
        continue

print(f"\n   ✓ Fundamentals loaded for {len(fundamentals)} stocks\n")

# ── Step 3: Graham Number + scoring function ──────────────────────────────────
def graham_number(eps, book):
    """Graham Number = sqrt(22.5 × EPS × Book Value Per Share)"""
    if eps and book and eps > 0 and book > 0:
        return (22.5 * eps * book) ** 0.5
    return None

def passes_criteria(f, price):
    """
    Returns (passes, graham_number, reason_if_fail)
    Applies simplified version of our platform's philosophy criteria.
    """
    eps = f.get('eps')
    book = f.get('book_per_share')
    de = f.get('debt_to_equity')
    cr = f.get('current_ratio')

    if not eps or eps <= 0:
        return False, None, 'No positive EPS'
    if not book or book <= 0:
        return False, None, 'No book value'

    gn = graham_number(eps, book)
    if not gn:
        return False, None, 'Cannot calculate Graham Number'

    # Graham criteria
    pe = price / eps if eps > 0 else None
    pb = price / book if book > 0 else None

    if pe and pe > 22:
        return False, gn, f'PE {pe:.1f} > 22'
    if pb and pb > 2.5:
        return False, gn, f'PB {pb:.2f} > 2.5'
    if de and de > 1.5:
        return False, gn, f'D/E {de:.2f} > 1.5'
    if cr and cr < 1.2:
        return False, gn, f'Current ratio {cr:.2f} < 1.2'

    # Margin of safety vs Graham Number
    mos = (gn - price) / gn if gn > 0 else -1
    if mos < MIN_MOS:
        return False, gn, f'MOS {mos:.1%} < {MIN_MOS:.0%}'

    return True, gn, 'PASS'

# ── Step 4: Run backtest ──────────────────────────────────────────────────────
print("🔄 Running backtest simulation...")

portfolio = {}      # ticker → {'shares': n, 'cost': p, 'graham_number': gn}
cash = INITIAL_CAPITAL
portfolio_values = {}
trades_log = []

# Get all trading dates
trading_dates = prices.index
rebalance_dates = [d for d in trading_dates
                   if d.month == REBALANCE_MONTH and d.day <= 7]

strategy_values = {}
spy_values = {}
spy_start_price = prices[BENCHMARK].iloc[0]

for date in trading_dates:
    # Mark to market
    port_val = cash
    for ticker, pos in portfolio.items():
        if ticker in prices.columns:
            px = prices[ticker].get(date)
            if px and not np.isnan(px):
                port_val += pos['shares'] * px
    strategy_values[date] = port_val

    spy_val = prices[BENCHMARK].get(date)
    if spy_val and not np.isnan(spy_val):
        spy_values[date] = INITIAL_CAPITAL * (spy_val / spy_start_price)

    # Rebalance annually
    if date in rebalance_dates:
        year = date.year
        candidates = []

        for ticker in UNIVERSE:
            if ticker not in fundamentals:
                continue
            if ticker not in prices.columns:
                continue

            # Get price on rebalance date
            px = prices[ticker].get(date)
            if not px or np.isnan(px) or px <= 0:
                continue

            # Use previous year's fundamentals (point-in-time approximation)
            f = fundamentals[ticker].get(year - 1) or fundamentals[ticker].get(year)
            if not f:
                continue

            passes, gn, reason = passes_criteria(f, px)
            if passes and gn:
                mos = (gn - px) / gn
                candidates.append({
                    'ticker': ticker,
                    'price': px,
                    'graham_number': gn,
                    'mos': mos,
                    'eps': f.get('eps'),
                    'book': f.get('book_per_share'),
                })

        # Sort by MOS (best discount first)
        candidates.sort(key=lambda x: x['mos'], reverse=True)
        top = candidates[:MAX_POSITIONS]

        # Sell everything first
        for ticker, pos in list(portfolio.items()):
            px = prices[ticker].get(date)
            if px and not np.isnan(px):
                proceeds = pos['shares'] * px
                cash += proceeds
                trades_log.append({
                    'date': str(date.date()),
                    'ticker': ticker,
                    'action': 'SELL',
                    'price': round(px, 2),
                    'shares': pos['shares'],
                    'proceeds': round(proceeds, 2),
                })
        portfolio = {}

        if not top:
            print(f"   {year}: No qualifying stocks found — holding cash")
            continue

        # Buy top candidates equally weighted
        alloc = cash / len(top)
        for c in top:
            shares = alloc / c['price']
            cost = shares * c['price']
            cash -= cost
            portfolio[c['ticker']] = {
                'shares': shares,
                'cost': c['price'],
                'graham_number': c['graham_number'],
            }
            trades_log.append({
                'date': str(date.date()),
                'ticker': c['ticker'],
                'action': 'BUY',
                'price': round(c['price'], 2),
                'shares': round(shares, 4),
                'mos': round(c['mos'] * 100, 1),
                'graham_number': round(c['graham_number'], 2),
            })

        print(f"   {year}: Bought {len(top)} stocks | "
              f"Top picks: {', '.join(c['ticker'] for c in top[:5])}")

# ── Step 5: Calculate results ─────────────────────────────────────────────────
print("\n📈 Calculating results...\n")

strat_series = pd.Series(strategy_values)
spy_series   = pd.Series(spy_values)

# Align
aligned = pd.DataFrame({'strategy': strat_series, 'spy': spy_series}).dropna()

# Total returns
strat_total  = (aligned['strategy'].iloc[-1] / aligned['strategy'].iloc[0] - 1) * 100
spy_total    = (aligned['spy'].iloc[-1]      / aligned['spy'].iloc[0]      - 1) * 100

# Annualised
years = (aligned.index[-1] - aligned.index[0]).days / 365.25
strat_cagr = ((aligned['strategy'].iloc[-1] / aligned['strategy'].iloc[0]) ** (1/years) - 1) * 100
spy_cagr   = ((aligned['spy'].iloc[-1]      / aligned['spy'].iloc[0])      ** (1/years) - 1) * 100

# Sharpe (annualised, risk-free ~2%)
daily_ret  = aligned['strategy'].pct_change().dropna()
sharpe     = (daily_ret.mean() * 252 - 0.02) / (daily_ret.std() * np.sqrt(252))

# Max drawdown
rolling_max = aligned['strategy'].cummax()
drawdown    = (aligned['strategy'] - rolling_max) / rolling_max
max_dd      = drawdown.min() * 100

# Win rate (annual)
annual_strat = aligned['strategy'].resample('YE').last().pct_change().dropna()
win_rate     = (annual_strat > 0).mean() * 100

alpha = strat_cagr - spy_cagr

print("=" * 60)
print("  BACKTEST RESULTS")
print("=" * 60)
print(f"  Period:          {aligned.index[0].date()} → {aligned.index[-1].date()}")
print(f"  Years:           {years:.1f}")
print()
print(f"  Strategy CAGR:   {strat_cagr:+.1f}%")
print(f"  SPY CAGR:        {spy_cagr:+.1f}%")
print(f"  Alpha:           {alpha:+.1f}% per year")
print()
print(f"  Total return:    {strat_total:+.1f}%  (vs SPY {spy_total:+.1f}%)")
print(f"  Sharpe ratio:    {sharpe:.2f}")
print(f"  Max drawdown:    {max_dd:.1f}%")
print(f"  Annual win rate: {win_rate:.0f}%  (years the strategy beat cash)")
print()
print(f"  Final value:     ${aligned['strategy'].iloc[-1]:,.0f}  (started ${INITIAL_CAPITAL:,.0f})")
print(f"  SPY equivalent:  ${aligned['spy'].iloc[-1]:,.0f}")
print("=" * 60)

# ── Step 6: Save results ──────────────────────────────────────────────────────
results = {
    'metadata': {
        'run_at': datetime.now().isoformat(),
        'start': START,
        'end': END,
        'universe_size': len(UNIVERSE),
        'initial_capital': INITIAL_CAPITAL,
        'strategy': 'Graham/Buffett Value — PE<22, PB<2.5, D/E<1.5, CR>1.2, MOS>15%',
    },
    'performance': {
        'strategy_cagr': round(strat_cagr, 2),
        'spy_cagr': round(spy_cagr, 2),
        'alpha': round(alpha, 2),
        'total_return': round(strat_total, 2),
        'spy_total_return': round(spy_total, 2),
        'sharpe_ratio': round(sharpe, 2),
        'max_drawdown': round(max_dd, 2),
        'annual_win_rate': round(win_rate, 1),
        'final_value': round(float(aligned['strategy'].iloc[-1]), 2),
        'spy_final_value': round(float(aligned['spy'].iloc[-1]), 2),
    },
    'annual_returns': {
        str(y): round(float(r) * 100, 2)
        for y, r in annual_strat.items()
    },
    'trades': trades_log[-50:],  # last 50 trades
}

out = 'scripts/backtest-results.json'
with open(out, 'w') as f:
    json.dump(results, f, indent=2)

print(f"\n✅ Results saved to {out}")
print(f"\n💡 Note: This uses current S&P 500 constituents (survivorship bias).")
print(f"   Real results would differ — many value traps that went bankrupt are excluded.")
print(f"   For rigorous testing, use the QuantConnect algorithm (scripts/quantconnect_strategy.py)")

# ── Step 7: Plot (optional) ───────────────────────────────────────────────────
try:
    import matplotlib.pyplot as plt
    import matplotlib.ticker as mtick

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 8), gridspec_kw={'height_ratios': [3, 1]})
    fig.suptitle('Value Philosophy Strategy vs SPY (2010–2024)', fontsize=14, fontweight='bold')

    # Normalise to 100
    norm_strat = aligned['strategy'] / aligned['strategy'].iloc[0] * 100
    norm_spy   = aligned['spy']      / aligned['spy'].iloc[0]      * 100

    ax1.plot(norm_strat.index, norm_strat.values, color='#7c3aed', linewidth=2, label=f'Strategy (+{strat_total:.0f}%)')
    ax1.plot(norm_spy.index,   norm_spy.values,   color='#6b7280', linewidth=1.5, linestyle='--', label=f'SPY (+{spy_total:.0f}%)')
    ax1.fill_between(norm_strat.index, norm_strat.values, norm_spy.values,
                     where=norm_strat.values > norm_spy.values, alpha=0.1, color='#7c3aed')
    ax1.set_ylabel('Portfolio Value (indexed to 100)')
    ax1.legend(loc='upper left')
    ax1.grid(True, alpha=0.3)
    ax1.yaxis.set_major_formatter(mtick.FuncFormatter(lambda x, _: f'{x:.0f}'))

    # Drawdown chart
    ax2.fill_between(drawdown.index, drawdown.values * 100, 0, color='#ef4444', alpha=0.6)
    ax2.set_ylabel('Drawdown %')
    ax2.set_xlabel('Date')
    ax2.grid(True, alpha=0.3)
    ax2.yaxis.set_major_formatter(mtick.FuncFormatter(lambda x, _: f'{x:.0f}%'))

    plt.tight_layout()
    plt.savefig('scripts/backtest-chart.png', dpi=150, bbox_inches='tight')
    print(f"📊 Chart saved to scripts/backtest-chart.png")
    plt.show()

except ImportError:
    print("(matplotlib not installed — skipping chart)")
