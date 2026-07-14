// Decision journal feed — post-mortems + weekly letters for the /journal page.
// Session-protected by the global middleware.

import { prisma } from '@/lib/db/client'

export async function GET() {
  try {
    const [postMortems, letters] = await Promise.all([
      prisma.tradePostMortem.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
      prisma.weeklyLetter.findMany({ orderBy: { generatedAt: 'desc' }, take: 8 }),
    ])

    const verdictCounts = postMortems.reduce<Record<string, number>>((acc, m) => {
      acc[m.verdict] = (acc[m.verdict] ?? 0) + 1
      return acc
    }, {})

    return Response.json({ postMortems, letters, verdictCounts })
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'error' }, { status: 500 })
  }
}
