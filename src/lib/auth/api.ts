import { NextRequest } from 'next/server'

export function isMutationAuthorized(request: NextRequest): boolean {
  const secret = process.env.API_SECRET
  const isProd = process.env.NODE_ENV === 'production'

  if (!secret) return !isProd

  const authHeader = request.headers.get('authorization')

  if (authHeader?.replace('Bearer ', '') === secret) return true

  if (!authHeader) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    if (!appUrl) return !isProd
    const origin = request.headers.get('origin') ?? ''
    const referer = request.headers.get('referer') ?? ''
    if (origin.startsWith(appUrl) || referer.startsWith(appUrl)) return true
  }

  return false
}
