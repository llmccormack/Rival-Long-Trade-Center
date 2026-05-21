import { NextRequest } from 'next/server'
import { getCompleteFundamentals } from '@/lib/fmp/client'
import { prisma } from '@/lib/db/client'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params

  try {
    const fundamentals = await getCompleteFundamentals(ticker.toUpperCase())

    // Persist to DB (upsert stock + latest fundamental year)
    const stock = await prisma.stock.upsert({
      where: { ticker: ticker.toUpperCase() },
      create: {
        ticker: ticker.toUpperCase(),
        name: fundamentals.name,
        sector: fundamentals.sector,
        industry: fundamentals.industry,
        exchange: fundamentals.exchange,
      },
      update: {
        name: fundamentals.name,
        sector: fundamentals.sector,
        industry: fundamentals.industry,
      },
    })

    const currentYear = new Date().getFullYear()
    await prisma.fundamental.upsert({
      where: { stockId_year_period: { stockId: stock.id, year: currentYear, period: 'annual' } },
      create: {
        stockId: stock.id,
        year: currentYear,
        period: 'annual',
        netIncome: fundamentals.netIncome,
        eps: fundamentals.eps,
        revenue: fundamentals.revenue,
        bookValuePerShare: fundamentals.bookValuePerShare,
        currentAssets: fundamentals.currentAssets,
        currentLiabilities: fundamentals.currentLiabilities,
        longTermDebt: fundamentals.longTermDebt,
        operatingCashFlow: fundamentals.operatingCashFlow,
        capitalExpenditures: fundamentals.capitalExpenditures,
        freeCashFlow: fundamentals.freeCashFlow,
        depreciation: fundamentals.depreciation,
        ownerEarnings: fundamentals.ownerEarnings,
        pe: fundamentals.pe,
        pb: fundamentals.pb,
        currentRatio: fundamentals.currentRatio,
        debtToEquity: fundamentals.debtToEquity,
        roe: fundamentals.roe,
        roic: fundamentals.roic,
        price: fundamentals.price,
        marketCap: fundamentals.marketCap,
        sharesOutstanding: fundamentals.sharesOutstanding,
      },
      update: {
        netIncome: fundamentals.netIncome,
        eps: fundamentals.eps,
        price: fundamentals.price,
        ownerEarnings: fundamentals.ownerEarnings,
      },
    })

    const dataFreshness = {
      fetchedAt: new Date().toISOString(),
      priceAgeMinutes: 15, // FMP free tier quotes are ~15min delayed
      fundamentalsAgeQuarters: 1, // quarterly filings
      warning: fundamentals.price ? null : 'Price data unavailable — fundamentals may be stale',
    }

    return Response.json({ ...fundamentals, dataFreshness })
  } catch (err: any) {
    return Response.json(
      { error: 'Failed to fetch fundamentals', message: err.message },
      { status: 500 }
    )
  }
}
