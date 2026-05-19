import { NextRequest } from 'next/server'

// Allow same-origin UI requests without a secret.
// External callers (Railway cron) must pass Authorization: Bearer <CRON_SECRET>.
// If CRON_SECRET is not set, all requests pass (dev convenience).
export function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true

  const authHeader = request.headers.get('authorization')

  // External caller with correct secret
  if (authHeader?.replace('Bearer ', '') === secret) return true

  // No auth header — allow if same-origin (browser UI buttons)
  if (!authHeader) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    const origin = request.headers.get('origin') ?? ''
    const referer = request.headers.get('referer') ?? ''
    if (!appUrl) return true  // no URL configured — allow (dev)
    if (origin.startsWith(appUrl) || referer.startsWith(appUrl)) return true
  }

  return false
}
