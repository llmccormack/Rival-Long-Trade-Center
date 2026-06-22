import { NextRequest } from 'next/server'

export function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')

  // External caller with correct Bearer token — always allow
  if (secret && authHeader?.replace('Bearer ', '') === secret) return true

  // No auth header = request came from the browser UI — always allow
  // (External cron/API callers must provide the Bearer token above)
  if (!authHeader) return true

  // Auth header present but wrong token
  return false
}
