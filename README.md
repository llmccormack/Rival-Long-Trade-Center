# Graham Capital — Value Investing Platform

Benjamin Graham & Warren Buffett value investing methodology, automated.

## Philosophy Encoded

- **Margin of Safety** — only buy when price is 30%+ below intrinsic value
- **Mr. Market** — treat price swings as opportunities, not signals
- **Owner Earnings** — Buffett's formula: Net Income + D&A − CapEx
- **Graham Number** — √(22.5 × EPS × Book Value Per Share)
- **Long-term holding** — sell only when fundamentals deteriorate, never on price drops

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

Edit `.env.local` with your:
- `DATABASE_URL` — PostgreSQL connection string
- `FMP_API_KEY` — [Financial Modeling Prep](https://financialmodelingprep.com/developer) (free tier works for analysis; Starter plan recommended for full screener)
- `SCHWAB_CLIENT_ID` / `SCHWAB_CLIENT_SECRET` — [Schwab Developer Portal](https://developer.schwab.com)
- `SCHWAB_REDIRECT_URI` — set to `http://localhost:3000/api/schwab/auth/callback`

### 3. Set up database

```bash
# Run migrations (requires PostgreSQL running)
npx prisma migrate dev --name init

# Or push schema directly
npx prisma db push
```

### 4. Run development server

```bash
npm run dev
```

---

## Features

### Graham Screener (`/screener`)
Runs all 7 Benjamin Graham Chapter 14 Defensive Investor criteria:

| Criterion | Threshold |
|-----------|-----------|
| P/E Ratio | ≤ 15 |
| Price/Book | ≤ 1.5 |
| Current Ratio | ≥ 2 |
| LT Debt vs Net Current Assets | LTD ≤ NCA |
| EPS Growth (10yr CAGR) | ≥ 3%/yr |
| Dividend History | ≥ 20 consecutive years |
| No Earnings Deficit | Last 10 years |

### Stock Analysis (`/analysis/[ticker]`)
- Graham Number calculation
- DCF using Owner Earnings (Buffett's method)
- Composite intrinsic value (40% Graham Number, 60% DCF)
- Margin of Safety gauge
- 10-year EPS, Revenue, FCF, and Book Value charts — no price charts, ever

### Portfolio Management (`/portfolio`)
- Position tracking with cost basis
- Margin of Safety vs current price for every holding
- Quarterly rebalance reviews fundamentals, never sells on price drops
- Max 10% per position (equal weighting)

### Watchlist (`/watchlist`)
- Add tickers to watch
- Auto-calculates target buy price (intrinsic value − 30%)
- Alerts when a stock hits the buy threshold

### Automated Trading (Schwab API)
- OAuth 2.0 with auto token refresh every 30 minutes
- Places market orders when a watchlist stock passes all 7 criteria + 30% MOS
- `POST /api/schwab/orders` — trigger a buy
- `POST /api/portfolio { "action": "rebalance" }` — run quarterly review

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), TypeScript |
| Styling | Tailwind CSS v4 |
| Charts | Recharts (fundamentals only) |
| Database | PostgreSQL via Prisma 7 |
| Fundamental Data | Financial Modeling Prep API |
| Brokerage | Schwab Developer API (OAuth 2.0) |

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Dashboard
│   ├── screener/page.tsx           # Graham screener
│   ├── analysis/[ticker]/page.tsx  # Deep dive analysis
│   ├── portfolio/page.tsx          # Holdings
│   ├── watchlist/page.tsx          # Watch + alerts
│   └── api/
│       ├── screener/
│       ├── analysis/[ticker]/
│       ├── fundamentals/[ticker]/
│       ├── portfolio/
│       ├── watchlist/
│       ├── alerts/
│       └── schwab/{auth,orders,portfolio}/
├── lib/
│   ├── graham/
│   │   ├── screener.ts             # Chapter 14 criteria
│   │   └── intrinsic-value.ts      # Graham Number + DCF
│   ├── fmp/client.ts               # Financial Modeling Prep
│   ├── schwab/{auth,client}.ts     # OAuth + trading API
│   ├── portfolio/manager.ts        # Auto-buy + rebalancing
│   └── db/client.ts                # Prisma singleton
└── components/
    ├── ui/                         # Badge, MetricCard, MOSGauge, FundamentalChart
    ├── dashboard/                  # AlertsFeed
    ├── screener/                   # ScreenerTable
    └── portfolio/                  # PositionsTable
```
