// ─── Session auth (single-user) ───────────────────────────────────────────────
//
// The app is gated by one shared password (APP_PASSWORD env var). The session
// cookie value is SHA-256("graham-capital|" + APP_PASSWORD): deterministic, so
// middleware (WebCrypto) and route handlers (node crypto) derive the same token
// without a session store, and rotating the password invalidates every session.
//
// Machine callers (Railway cron, scripts) bypass sessions with
// `Authorization: Bearer $CRON_SECRET` / `$API_SECRET`.

import { createHash, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

export const SESSION_COOKIE = 'gc_session'

export function deriveSessionToken(password: string): string {
  return createHash('sha256').update(`graham-capital|${password}`).digest('hex')
}

export function hasValidSession(request: NextRequest): boolean {
  const password = process.env.APP_PASSWORD
  if (!password) return false  // fail closed: no password configured = no sessions
  const cookie = request.cookies.get(SESSION_COOKIE)?.value
  if (!cookie) return false
  const expected = deriveSessionToken(password)
  const a = Buffer.from(cookie)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
