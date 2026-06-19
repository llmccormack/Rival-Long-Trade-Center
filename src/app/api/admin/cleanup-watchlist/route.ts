// POST /api/admin/cleanup-watchlist
// One-time migration: removes all auto-discovered / SEC EDGAR watchlist entries.
// Manual watchlist items (user-curated) are preserved.
// The FMP screener is now the universe source — these rows are obsolete.

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'
import { isAuthorized } from '@/lib/auth/cron'

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Auto-discovered patterns written by the old discovery system
  const AUTO_PREFIXES = [
    'Auto-discovered',
    'Auto-promoted',
    'Yahoo value screen',
    'SEC',
  ]

  try {
    // Count before
    const totalBefore = await prisma.watchlistItem.count()

    // Delete all auto-discovered entries
    const { count: deleted } = await prisma.watchlistItem.deleteMany({
      where: {
        OR: AUTO_PREFIXES.map(prefix => ({
          notes: { startsWith: prefix },
        })),
      },
    })

    // Also delete entries with null notes that were bulk-created (EDGAR dumps have no notes)
    const { count: deletedNull } = await prisma.watchlistItem.deleteMany({
      where: { notes: null },
    })

    const totalAfter = await prisma.watchlistItem.count()

    return Response.json({
      success: true,
      before: totalBefore,
      deleted: deleted + deletedNull,
      remaining: totalAfter,
      message: `Cleaned up ${deleted + deletedNull} auto-discovered entries. ${totalAfter} manual items kept.`,
    })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
