import { getTickerNews } from '@/lib/fmp/client'

// GET /api/news/[ticker] — fetch recent news with hard-veto and disruption analysis
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params
    const symbol = ticker.toUpperCase()

    const news = await getTickerNews(symbol)

    return Response.json(news)
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
