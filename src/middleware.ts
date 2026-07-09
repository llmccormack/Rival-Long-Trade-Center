// ─── Global auth + rate-limit middleware ──────────────────────────────────────
//
// Before this existed, the app was fully public: anyone with the Railway URL
// could view the portfolio, rewrite autopilot config (including mode='live'),
// trigger runs, and burn the Anthropic/FMP quotas via /api/chat and
// /api/analysis. Everything now requires either a login session (APP_PASSWORD)
// or a machine bearer token (CRON_SECRET / API_SECRET).
//
// Fail-closed: in production with no APP_PASSWORD set, the app serves 503s
// (except /api/health and bearer-authenticated cron calls) until it is set.

import { NextRequest, NextResponse } from 'next/server'

const SESSION_COOKIE = 'gc_session'
const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/health'])

// Best-effort per-IP rate limit for /api — stops a crawler (or a stranger)
// from draining the FMP quota, since one /api/analysis hit costs ~8 FMP calls.
// Per-isolate memory; resets on cold start, which is acceptable for this job.
const API_LIMIT_PER_MIN = 240
const hits = new Map<string, { n: number; reset: number }>()

// Same formula as deriveSessionToken in src/lib/auth/session.ts, but WebCrypto
// because middleware runs on the edge runtime.
async function deriveToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`graham-capital|${password}`)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next()

  if (pathname.startsWith('/api/')) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const now = Date.now()
    const h = hits.get(ip)
    if (!h || now > h.reset) {
      if (hits.size > 5000) hits.clear()
      hits.set(ip, { n: 1, reset: now + 60_000 })
    } else if (++h.n > API_LIMIT_PER_MIN) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }
  }

  // Machine callers with a correct bearer secret bypass the session
  const bearer = req.headers.get('authorization')?.replace('Bearer ', '')
  if (bearer && (
    (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) ||
    (process.env.API_SECRET && bearer === process.env.API_SECRET)
  )) {
    return NextResponse.next()
  }

  const password = process.env.APP_PASSWORD
  if (!password) {
    if (process.env.NODE_ENV !== 'production') return NextResponse.next()  // dev convenience
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'APP_PASSWORD not configured — access disabled until it is set' }, { status: 503 })
    }
    return new NextResponse(
      'Graham Capital is locked. Set the APP_PASSWORD environment variable on the server, then reload.',
      { status: 503, headers: { 'content-type': 'text/plain' } }
    )
  }

  const cookie = req.cookies.get(SESSION_COOKIE)?.value
  if (cookie && cookie === await deriveToken(password)) return NextResponse.next()

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized — login required' }, { status: 401 })
  }
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|apple-touch-icon\\.png|.*\\.svg).*)'],
}
