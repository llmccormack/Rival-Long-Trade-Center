import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { deriveSessionToken, SESSION_COOKIE } from '@/lib/auth/session'

export async function POST(request: NextRequest) {
  const password = process.env.APP_PASSWORD
  if (!password) {
    return Response.json({ error: 'APP_PASSWORD is not configured on the server' }, { status: 503 })
  }

  const body = await request.json().catch(() => ({} as { password?: unknown }))
  const attempt = typeof body.password === 'string' ? body.password : ''

  // Constant small delay blunts online brute-force
  await new Promise(r => setTimeout(r, 300))

  const a = Buffer.from(attempt)
  const b = Buffer.from(password)
  const ok = a.length === b.length && timingSafeEqual(a, b)
  if (!ok) return Response.json({ error: 'Wrong password' }, { status: 401 })

  const token = deriveSessionToken(password)
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  const res = Response.json({ ok: true })
  res.headers.set(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure}`
  )
  return res
}
