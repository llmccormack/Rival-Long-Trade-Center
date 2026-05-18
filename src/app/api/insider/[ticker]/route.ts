import { getInsiderTransactions } from '@/lib/fmp/client'

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params
  const data = await getInsiderTransactions(ticker.toUpperCase())
  return Response.json(data)
}
