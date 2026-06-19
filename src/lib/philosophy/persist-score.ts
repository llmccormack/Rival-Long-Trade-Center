// Shared helper — upserts a philosophy score into the StockScore leaderboard.
// Called fire-and-forget from both the market-scan route and the autopilot full-run.
// One row per ticker; each call overwrites with the latest score.

import { prisma } from '@/lib/db/client'

export interface ScoreRecord {
  ticker:        string
  name?:         string | null
  sector?:       string | null
  price:         number
  score:         number
  mos:           number
  intrinsicValue?: number | null
  grahamNumber?: number | null
  pe?:           number | null
  pb?:           number | null
  signal:        string
  conviction?:   string | null
  vetoCount:     number
  vetoReasons:   string[]
  source:        'scan' | 'autopilot'
}

export async function upsertStockScore(record: ScoreRecord): Promise<void> {
  const data = {
    name:          record.name          ?? undefined,
    sector:        record.sector        ?? undefined,
    price:         record.price,
    score:         record.score,
    mos:           record.mos,
    intrinsicValue: record.intrinsicValue ?? undefined,
    grahamNumber:  record.grahamNumber  ?? undefined,
    pe:            record.pe            ?? undefined,
    pb:            record.pb            ?? undefined,
    signal:        record.signal,
    conviction:    record.conviction    ?? undefined,
    vetoCount:     record.vetoCount,
    vetoReasons:   record.vetoReasons,
    source:        record.source,
    scoredAt:      new Date(),
  }

  await prisma.stockScore.upsert({
    where:  { ticker: record.ticker },
    create: { ticker: record.ticker, ...data },
    update: data,
  })
}
