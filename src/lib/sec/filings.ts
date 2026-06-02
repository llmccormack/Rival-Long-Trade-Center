// Fetches 10-K annual report text from SEC EDGAR
// Free, official, no API key. Rate limit: 10 req/sec per SEC policy.

const SEC_HEADERS = {
  'User-Agent': 'value-investing-platform contact@rivalautomations.com',
  'Accept-Encoding': 'gzip, deflate',
}

interface Filing {
  accessionNumber: string
  filingDate: string
  form: string
  primaryDocument: string
}

// Get CIK for a ticker from our cached SEC tickers list
export async function getCikForTicker(ticker: string): Promise<number | null> {
  try {
    const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: SEC_HEADERS,
    })
    if (!res.ok) return null
    const json = await res.json() as Record<string, { cik_str: number; ticker: string; title: string }>
    const match = Object.values(json).find(e => e.ticker.toUpperCase() === ticker.toUpperCase())
    return match?.cik_str ?? null
  } catch { return null }
}

// Get the most recent 10-K filing for a company
async function getLatest10KFiling(cik: number): Promise<Filing | null> {
  try {
    const paddedCik = String(cik).padStart(10, '0')
    const res = await fetch(`https://data.sec.gov/submissions/CIK${paddedCik}.json`, {
      headers: SEC_HEADERS,
    })
    if (!res.ok) return null
    const data = await res.json()

    const filings = data.filings?.recent
    if (!filings) return null

    const forms: string[] = filings.form ?? []
    const dates: string[] = filings.filingDate ?? []
    const accessions: string[] = filings.accessionNumber ?? []
    const primaryDocs: string[] = filings.primaryDocument ?? []

    // Find most recent 10-K
    for (let i = 0; i < forms.length; i++) {
      if (forms[i] === '10-K') {
        return {
          accessionNumber: accessions[i],
          filingDate: dates[i],
          form: forms[i],
          primaryDocument: primaryDocs[i],
        }
      }
    }
    return null
  } catch { return null }
}

// Fetch the actual 10-K text, truncated to the most useful sections
export async function fetch10KSections(ticker: string): Promise<string | null> {
  try {
    const cik = await getCikForTicker(ticker)
    if (!cik) return null

    const filing = await getLatest10KFiling(cik)
    if (!filing) return null

    const accessionFormatted = filing.accessionNumber.replace(/-/g, '')
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionFormatted}/${filing.primaryDocument}`

    const res = await fetch(docUrl, { headers: SEC_HEADERS })
    if (!res.ok) return null

    let text = await res.text()

    // Strip HTML tags if it's an HTML filing
    if (text.includes('<html') || text.includes('<HTML')) {
      text = text
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s{3,}/g, '\n\n')
    }

    // Extract the most relevant sections (Business, Risk Factors, MD&A)
    // These appear in Items 1, 1A, and 7 of a 10-K
    const relevantSections = extractRelevantSections(text)

    // Cap at 15,000 chars to keep Claude costs low
    return relevantSections.slice(0, 15000)
  } catch { return null }
}

function extractRelevantSections(text: string): string {
  const sections: string[] = []

  // Try to find Item 1 (Business), Item 1A (Risk Factors), Item 7 (MD&A)
  const patterns = [
    /item\s+1[\.\s]+business/i,
    /item\s+1a[\.\s]+risk\s+factors/i,
    /item\s+7[\.\s]+management.{0,30}discussion/i,
  ]

  let lastIdx = 0
  for (const pattern of patterns) {
    const match = text.slice(lastIdx).search(pattern)
    if (match !== -1) {
      const absIdx = lastIdx + match
      sections.push(text.slice(absIdx, absIdx + 5000))
      lastIdx = absIdx + 100
    }
  }

  if (sections.length === 0) {
    // Fallback: just take from the beginning, skipping cover page boilerplate
    return text.slice(Math.min(2000, text.length))
  }

  return sections.join('\n\n---\n\n')
}
