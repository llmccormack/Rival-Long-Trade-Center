import { NextRequest } from 'next/server'
import { hasValidSession } from './session'

// FIXED (spoofable-origin bug): the old version trusted the Origin/Referer
// headers, which any HTTP client can set freely — an attacker could rewrite
// the autopilot config (including mode='live') with one curl command.
// Mutations now require either the API_SECRET bearer token (machine callers)
// or a valid login session cookie (browser UI).
export function isMutationAuthorized(request: NextRequest): boolean {
  const secret = process.env.API_SECRET
  const authHeader = request.headers.get('authorization')
  if (secret && authHeader?.replace('Bearer ', '') === secret) return true
  if (hasValidSession(request)) return true
  // Dev convenience only — production always requires one of the above
  return process.env.NODE_ENV !== 'production' && !process.env.APP_PASSWORD
}
