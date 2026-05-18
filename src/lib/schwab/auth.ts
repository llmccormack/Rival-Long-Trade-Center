import axios from 'axios'
import { prisma } from '@/lib/db/client'

const SCHWAB_AUTH_URL = 'https://api.schwabapi.com/v1/oauth/authorize'
const SCHWAB_TOKEN_URL = 'https://api.schwabapi.com/v1/oauth/token'

export function getAuthorizationUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: process.env.SCHWAB_CLIENT_ID!,
    redirect_uri: process.env.SCHWAB_REDIRECT_URI!,
    response_type: 'code',
    scope: 'readonly trading',
    ...(state ? { state } : {}),
  })
  return `${SCHWAB_AUTH_URL}?${params.toString()}`
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  scope: string
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const credentials = Buffer.from(
    `${process.env.SCHWAB_CLIENT_ID}:${process.env.SCHWAB_CLIENT_SECRET}`
  ).toString('base64')

  const res = await axios.post<TokenResponse>(
    SCHWAB_TOKEN_URL,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.SCHWAB_REDIRECT_URI!,
    }),
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  )
  return res.data
}

export async function refreshAccessToken(accountId: string): Promise<string> {
  const stored = await prisma.schwabToken.findUnique({ where: { accountId } })
  if (!stored) throw new Error('No token found for account')

  const credentials = Buffer.from(
    `${process.env.SCHWAB_CLIENT_ID}:${process.env.SCHWAB_CLIENT_SECRET}`
  ).toString('base64')

  const res = await axios.post<TokenResponse>(
    SCHWAB_TOKEN_URL,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
    }),
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  )

  const expiresAt = new Date(Date.now() + res.data.expires_in * 1000)
  await prisma.schwabToken.update({
    where: { accountId },
    data: {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
      expiresAt,
    },
  })

  return res.data.access_token
}

export async function getValidAccessToken(accountId: string): Promise<string> {
  const stored = await prisma.schwabToken.findUnique({ where: { accountId } })
  if (!stored) throw new Error('Not authenticated with Schwab')

  // Refresh 60 seconds before expiry to avoid edge cases
  const bufferMs = 60 * 1000
  if (stored.expiresAt.getTime() - bufferMs < Date.now()) {
    return refreshAccessToken(accountId)
  }

  return stored.accessToken
}

export async function saveTokens(
  accountId: string,
  tokens: TokenResponse
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
  await prisma.schwabToken.upsert({
    where: { accountId },
    create: {
      accountId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
    },
    update: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
    },
  })
}
