# Setup TODO — everything you need to do outside the code

The running checklist. Items are ordered — top ones block the ones below.
(This file is maintained by the build sessions; check things off as you go.)

## 1. Deploy blockers (the app serves 503s until these are set)

- [ ] **Set `APP_PASSWORD` on Railway** — the app is now fail-closed behind a login
      wall. Without this env var, production serves 503s everywhere except
      `/api/health`. Pick a strong passphrase; changing it later logs out all sessions.
- [ ] **Merge `claude/alpha-hardening` into `main`** — 6 commits: engine fixes,
      quality mode, auth, honest accounting, safety rails, journal, chat agent, UI.
      `prisma db push` runs automatically on deploy (new tables/columns apply themselves).
- [ ] **Log in once at `/login`** and confirm the dashboard loads.

## 2. Security (before any live-money mode, non-negotiable)

- [ ] **Set `TOKEN_ENCRYPTION_KEY`** (any long random string) — Schwab OAuth tokens
      are stored AES-encrypted only when this is set; plaintext otherwise (a warning
      logs on every token save until you do).
- [ ] **Confirm `CRON_SECRET` is set** — cron endpoints reject calls without it now.
- [ ] Optional: set `API_SECRET` if you ever want to script config changes with curl.

## 3. Railway cron jobs (Dashboard → your project → "Add New" → Cron Job)

All POST, all with header `Authorization: Bearer $CRON_SECRET`:

- [ ] **Daily full run** — `0 13 * * 1-5` → `$DOMAIN/api/autopilot/full-run`
      (may already exist — verify it's still firing; the dead-man's switch will
      now alert you if it stops)
- [ ] **Friday rebalance** — `0 21 * * 5` → `$DOMAIN/api/autopilot/rebalance`
- [ ] **Sunday investor letter** — `0 14 * * 0` → `$DOMAIN/api/reports/weekly` *(new)*

## 4. Monitoring (10 minutes, free)

- [ ] **Point UptimeRobot (free) at `https://$DOMAIN/api/health`** every 5 min —
      this powers the dead-man's switch 24/7 (otherwise it only checks while the
      UI is open). No auth needed; health is a public endpoint.
- [ ] Confirm `NTFY_TOPIC` is set and the ntfy app is on your phone — circuit
      breaker, stall alerts, and trade notifications all go there.

## 5. Data quality (the single highest-ROI spend)

- [ ] **Upgrade FMP to Starter (~$25/mo)** — the free tier's ~5 years of statements
      starves Shiller EPS, earnings stability, F-Score history, and makes the
      backtest untrustworthy. Everything analytical gets better with this one change.

## 5b. Strategy rebalance — new tunables (optional, sensible defaults set)

The strategy was shifted to **invested-by-default** (quality-first, no CAPE cash
timing, value-ETF sleeve). Defaults are live; adjust in Settings only if you want:

- [ ] Review **`targetInvestedPct`** (default 80) — how much capital the bot aims
      to keep in equities; the ETF sleeve fills the gap so cash isn't idle.
- [ ] Review **`etfSleeveTicker`** (default `VTV`) — the value-ETF the sleeve buys.
      Change to `AVUV` (small-cap value), `QUAL`, `SCHD`, etc. if you prefer.
- [ ] **`maxQualityPct`** was raised 35 → 70; **`etfSleeveEnabled`** default on.
      No action needed unless you want to dial them back.
- [ ] Nothing new to set on Railway for this — all applied via `prisma db push`.

## 6. Evidence gathering (after the above)

- [ ] **Run the real-engine backtest:**
      `FMP_API_KEY=... npx tsx scripts/backtest-engine.ts`
      → bring the JSON output to a build session for interpretation.
- [ ] **Let paper mode run 4+ weeks untouched** — the shadow book, decision journal,
      and topBlockers need data before threshold tuning means anything.
- [ ] Ask the AI Analyst: *"Why hasn't the bot made any buys yet?"* — it now
      answers from recorded data. Sanity-check that the answer matches the
      autopilot page.

## 7. Before ever flipping `mode: live`

- [ ] All of section 2 done, plus 4+ weeks of paper evidence reviewed
- [ ] Schwab OAuth connected in Settings and `/api/schwab/portfolio` returns data
- [ ] Re-read the live-path safety notes in `src/lib/portfolio/manager.ts`
      (intent-first orders, daily caps, marketable limits — all live, but paper
      evidence comes first)

---
*Env var quick reference:* `APP_PASSWORD` · `TOKEN_ENCRYPTION_KEY` · `CRON_SECRET` ·
`FMP_API_KEY` · `ANTHROPIC_API_KEY` · `DATABASE_URL` (auto) · `NTFY_TOPIC` ·
`RESEND_API_KEY` + `NOTIFY_EMAIL` (email) · `NEXT_PUBLIC_APP_URL` · `API_SECRET` (optional)
