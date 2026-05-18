import axios, { AxiosInstance } from 'axios'
import { getValidAccessToken } from './auth'
import type { SchwabAccount, SchwabPosition, SchwabOrderRequest } from '@/types'

const BASE_URL = 'https://api.schwabapi.com/trader/v1'

function createSchwabClient(accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  })
}

// ─── Account ──────────────────────────────────────────────────────────────────

interface SchwabAccountRaw {
  securitiesAccount: {
    accountNumber: string
    type: string
    currentBalances: {
      cashBalance: number
      liquidationValue: number
    }
    positions?: Array<{
      instrument: { symbol: string; assetType: string }
      longQuantity: number
      marketValue: number
      averagePrice: number
    }>
  }
}

export async function getAccount(accountId: string): Promise<SchwabAccount> {
  const token = await getValidAccessToken(accountId)
  const client = createSchwabClient(token)

  const res = await client.get<SchwabAccountRaw>(`/accounts/${accountId}`, {
    params: { fields: 'positions' },
  })

  const raw = res.data.securitiesAccount
  const positions: SchwabPosition[] = (raw.positions ?? [])
    .filter((p) => p.instrument.assetType === 'EQUITY')
    .map((p) => ({
      ticker: p.instrument.symbol,
      shares: p.longQuantity,
      marketValue: p.marketValue,
      averagePrice: p.averagePrice,
    }))

  return {
    accountId,
    accountNumber: raw.accountNumber,
    type: raw.type,
    balance: {
      cashBalance: raw.currentBalances.cashBalance,
      totalValue: raw.currentBalances.liquidationValue,
    },
    positions,
  }
}

export async function getAccountIds(accountId: string): Promise<string[]> {
  const token = await getValidAccessToken(accountId)
  const client = createSchwabClient(token)
  const res = await client.get<Array<{ accountNumber: string }>>('/accounts/accountNumbers')
  return res.data.map((a) => a.accountNumber)
}

// ─── Orders ───────────────────────────────────────────────────────────────────

interface SchwabOrderPayload {
  orderType: string
  session: string
  duration: string
  orderStrategyType: string
  price?: number
  orderLegCollection: Array<{
    instruction: string
    quantity: number
    instrument: { symbol: string; assetType: string }
  }>
}

export async function placeOrder(request: SchwabOrderRequest): Promise<{ orderId: string }> {
  const token = await getValidAccessToken(request.accountId)
  const client = createSchwabClient(token)

  const payload: SchwabOrderPayload = {
    orderType: request.orderType,
    session: 'NORMAL',
    duration: 'DAY',
    orderStrategyType: 'SINGLE',
    orderLegCollection: [
      {
        instruction: 'BUY',
        quantity: request.shares,
        instrument: {
          symbol: request.ticker.toUpperCase(),
          assetType: 'EQUITY',
        },
      },
    ],
  }

  if (request.orderType === 'LIMIT' && request.limitPrice) {
    payload.price = request.limitPrice
  }

  const res = await client.post(`/accounts/${request.accountId}/orders`, payload)

  // Schwab returns the order ID in the Location header
  const location: string = res.headers['location'] ?? ''
  const orderId = location.split('/').pop() ?? 'unknown'

  return { orderId }
}

export async function getOrders(
  accountId: string,
  fromDate: string,
  toDate: string
): Promise<Array<{ orderId: string; status: string; ticker: string; quantity: number; price?: number }>> {
  const token = await getValidAccessToken(accountId)
  const client = createSchwabClient(token)

  const res = await client.get(`/accounts/${accountId}/orders`, {
    params: { fromEnteredTime: fromDate, toEnteredTime: toDate, status: 'FILLED' },
  })

  return (res.data ?? []).map((o: any) => ({
    orderId: String(o.orderId),
    status: o.status,
    ticker: o.orderLegCollection?.[0]?.instrument?.symbol ?? '',
    quantity: o.orderLegCollection?.[0]?.quantity ?? 0,
    price: o.price,
  }))
}

// ─── Quote ────────────────────────────────────────────────────────────────────

export async function getSchwabQuote(
  accountId: string,
  ticker: string
): Promise<{ price: number } | null> {
  const token = await getValidAccessToken(accountId)
  const client = createSchwabClient(token)

  try {
    const res = await client.get(`/marketdata/v1/${ticker.toUpperCase()}/quotes`)
    const quote = res.data?.[ticker.toUpperCase()]?.quote
    return quote ? { price: quote.lastPrice } : null
  } catch {
    return null
  }
}
