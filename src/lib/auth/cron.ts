import { NextRequest } from 'next/server'
import { hasValidSession } from './session'

// FIXED (fail-open bug): the old version allowed any request with NO auth
// header on the theory that it "came from the browser UI" — meaning a bare
// curl could trigger autopilot runs, rebalances, and the admin cleanup.
// Callers must now present either the CRON_SECRET bearer token (machine
// callers: Railway cron, scripts) or a valid login session cookie (browser UI).
export function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (secret && authHeader?.replace('Bearer ', '') === secret) return true
  return hasValidSession(request)
}
