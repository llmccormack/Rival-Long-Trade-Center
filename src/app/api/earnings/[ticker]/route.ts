import { getEarningsCalendar } from '@/lib/fmp/client'

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params
  const data = await getEarningsCalendar(ticker.toUpperCase())
  return Response.json(data)
}
