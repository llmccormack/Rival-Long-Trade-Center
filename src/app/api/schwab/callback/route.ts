import { NextRequest } from 'next/server'
import { exchangeCodeForTokens, saveTokens } from '@/lib/schwab/auth'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const error = request.nextUrl.searchParams.get('error')

  if (error) {
    return Response.redirect(new URL(`/settings?schwab=error&reason=${encodeURIComponent(error)}`, request.url))
  }

  if (!code) {
    return Response.redirect(new URL('/settings?schwab=error&reason=no_code', request.url))
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    // Use 'default' as accountId until we can fetch the real account number via the Schwab accounts API
    await saveTokens('default', tokens)
    return Response.redirect(new URL('/settings?schwab=connected', request.url))
  } catch (err: any) {
    return Response.redirect(
      new URL(`/settings?schwab=error&reason=${encodeURIComponent(err.message)}`, request.url)
    )
  }
}
