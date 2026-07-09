import axios from 'axios'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { prisma } from '@/lib/db/client'

const SCHWAB_AUTH_URL = 'https://api.schwabapi.com/v1/oauth/authorize'
const SCHWAB_TOKEN_URL = 'https://api.schwabapi.com/v1/oauth/token'

// ─── Token encryption at rest (AES-256-GCM) ───────────────────────────────────
// Schwab tokens grant TRADING access to a real brokerage account. Stored
// plaintext, a database leak = someone can trade the account. With
// TOKEN_ENCRYPTION_KEY set, tokens are encrypted before hitting Postgres.
// Backwards compatible: legacy plaintext rows (no "enc:v1:" prefix) still read
// fine and get encrypted on their next refresh.

const ENC_PREFIX = 'enc:v1:'
let warnedNoKey = false

function encKey(): Buffer | null {
  const k = process.env.TOKEN_ENCRYPTION_KEY
  if (!k) {
    if (!warnedNoKey) {
      console.warn('[schwab] TOKEN_ENCRYPTION_KEY not set — brokerage tokens are stored PLAINTEXT. Set it before going live.')
      warnedNoKey = true
    }
    return null
  }
  return createHash('sha256').update(k).digest()
}

function encryptToken(plain: string): string {
  const key = encKey()
  if (!key) return plain
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ENC_PREFIX + Buffer.concat([iv, tag, enc]).toString('base64')
}

function decryptToken(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored  // legacy plaintext row
  const key = encKey()
  if (!key) throw new Error('Stored Schwab tokens are encrypted but TOKEN_ENCRYPTION_KEY is not set')
  const raw = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const data = raw.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

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
      refresh_token: decryptToken(stored.refreshToken),
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
      accessToken: encryptToken(res.data.access_token),
      refreshToken: encryptToken(res.data.refresh_token),
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

  return decryptToken(stored.accessToken)
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
      accessToken: encryptToken(tokens.access_token),
      refreshToken: encryptToken(tokens.refresh_token),
      expiresAt,
    },
    update: {
      accessToken: encryptToken(tokens.access_token),
      refreshToken: encryptToken(tokens.refresh_token),
      expiresAt,
    },
  })
}
