// ─── Daily Market Rundown Cron ─────────────────────────────────────────────────
//
// Called by Railway cron at 7:00 AM ET every weekday.
// Fetches macro data, grabs top scored stocks, asks Claude for a 2-3 sentence
// commentary, and saves it to autopilotConfig.dailyRundown so it appears on
// the dashboard and autopilot page.
//
// Railway setup:
//   Schedule: 0 12 * * 1-5  (7am ET = 12:00 UTC, Mon–Fri)
//   URL:      https://YOUR_APP.up.railway.app/api/cron/daily-rundown
//   Method:   POST
//   Headers:  Authorization: Bearer $CRON_SECRET

import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db/client'
import { getMarketContext } from '@/lib/macro/market-context'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // no secret set — allow (dev mode)
  const auth = req.headers.get('authorization') ?? ''
  return auth === `Bearer ${secret}`
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // 1. Grab macro context
    const macro = await getMarketContext()

    // 2. Grab top scored stocks
    const topScores = await prisma.stockScore.findMany({
      orderBy: { score: 'desc' },
      take: 10,
    }).catch(() => [])

    const buySignals  = topScores.filter((s: any) => s.signal === 'BUY')
    const aboveThresh = topScores.filter((s: any) => s.score >= 45)

    // 3. Ask Claude for a rundown
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    const tempDescriptions: Record<string, string> = {
      cold:    'a rare buying opportunity — CAPE well below historical norms',
      fair:    'fairly valued — good time for selective deployment',
      warm:    'slightly elevated — maintain discipline and require margin of safety',
      hot:     'expensive relative to history — raise your bar, be patient',
      extreme: 'extremely overvalued by Shiller CAPE — Buffett is hoarding cash for a reason',
    }
    const tempDesc = tempDescriptions[macro.marketTemperature] ?? macro.marketTemperature

    const contextStr = [
      `Date: ${today}`,
      `S&P 500 CAPE: ${macro.sp500Cape.toFixed(1)} (${tempDesc})`,
      `10Y Treasury: ${(macro.treasury10yr * 100).toFixed(2)}%`,
      `Equity earnings yield: ${(1 / macro.sp500Cape * 100).toFixed(2)}%`,
      `Excess earnings yield vs bonds: ${(macro.excessEarningsYield * 100).toFixed(2)}%`,
      `Score board: ${topScores.length} stocks tracked, ${aboveThresh.length} above buy threshold, ${buySignals.length} buy signals`,
      buySignals.length > 0
        ? `Buy signals: ${buySignals.map((s: any) => `${s.ticker} (${s.score}/100, MOS ${s.mos?.toFixed(1)}%)`).join(', ')}`
        : 'No current buy signals.',
    ].join('\n')

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 200,
      system: `You are a terse, numbers-first value investing analyst. Write a single short paragraph (2-3 sentences max) morning market rundown.
Rules: no bullet points, no headers, no fluff. Lead with the CAPE number and what it means. Mention any buy signals if they exist. End with one actionable sentence. Be direct.`,
      messages: [{ role: 'user', content: contextStr }],
    })

    const rundown = (message.content[0] as any).text as string

    // 4. Save to autopilot config
    await prisma.autopilotConfig.upsert({
      where: { id: 'singleton' },
      update: { dailyRundown: rundown },
      create: {
        id: 'singleton',
        isEnabled: false,
        mode: 'paper',
        dailyRundown: rundown,
      },
    })

    return Response.json({
      ok: true,
      rundown,
      macro: {
        cape: macro.sp500Cape,
        temperature: macro.marketTemperature,
        treasury10yr: (macro.treasury10yr * 100).toFixed(2) + '%',
      },
      signals: buySignals.length,
    })
  } catch (err: any) {
    console.error('[daily-rundown]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// Also allow GET so you can hit it manually from the browser to test
export async function GET(req: NextRequest) {
  return POST(req)
}
