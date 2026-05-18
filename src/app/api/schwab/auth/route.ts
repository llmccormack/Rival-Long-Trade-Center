import { NextRequest } from 'next/server'
import { getAuthorizationUrl, exchangeCodeForTokens, saveTokens } from '@/lib/schwab/auth'

// GET /api/schwab/auth — redirect user to Schwab login
export async function GET() {
  const url = getAuthorizationUrl()
  return Response.redirect(url)
}

// GET /api/schwab/auth?code=...&state=... — OAuth callback
export async function POST(request: NextRequest) {
  const { code, accountId } = await request.json()

  if (!code || !accountId) {
    return Response.json({ error: 'Missing code or accountId' }, { status: 400 })
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    await saveTokens(accountId, tokens)
    return Response.json({ success: true })
  } catch (err: any) {
    return Response.json(
      { error: 'Token exchange failed', message: err.message },
      { status: 500 }
    )
  }
}
