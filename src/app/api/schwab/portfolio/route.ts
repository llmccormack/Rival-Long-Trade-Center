import { NextRequest } from 'next/server'
import { getAccount } from '@/lib/schwab/client'

export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get('accountId')

  if (!accountId) {
    return Response.json({ error: 'Missing accountId' }, { status: 400 })
  }

  try {
    const account = await getAccount(accountId)
    return Response.json(account)
  } catch (err: any) {
    return Response.json(
      { error: 'Failed to fetch account', message: err.message },
      { status: 500 }
    )
  }
}
