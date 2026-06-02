import Anthropic from '@anthropic-ai/sdk'
import { fetch10KSections } from '@/lib/sec/filings'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface MoatAnalysis {
  ticker: string
  companyName: string
  filingDate?: string
  moatScore: number        // 0-10: how durable is the competitive advantage
  moatType: string         // 'wide' | 'narrow' | 'none'
  moatSources: string[]    // e.g. ['brand', 'switching_costs', 'cost_advantage']
  managementScore: number  // 0-10: capital allocation quality, integrity
  businessQuality: string  // 'exceptional' | 'good' | 'fair' | 'poor'
  thesis: string           // 2-3 sentence investment thesis
  keyRisks: string[]       // top 3 risks
  catalysts: string[]      // what could drive value realization
  verdict: 'strong_buy' | 'buy' | 'watch' | 'avoid'
  confidence: number       // 0-100: how confident in the analysis
  generatedAt: string
}

// Cache to avoid re-analyzing the same company within 7 days
const analysisCache = new Map<string, { analysis: MoatAnalysis; expiresAt: number }>()

export async function analyzeMoat(
  ticker: string,
  companyName: string,
  quantScore: number,
  mos: number
): Promise<MoatAnalysis | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null

  const cacheKey = ticker.toUpperCase()
  const cached = analysisCache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) return cached.analysis

  // Fetch 10-K text
  const tenKText = await fetch10KSections(ticker).catch(() => null)

  const prompt = `You are Warren Buffett's analytical partner. Analyze this company for a value investing autopilot system.

Company: ${companyName} (${ticker})
Current quantitative score: ${quantScore}/100
Margin of safety: ${mos.toFixed(1)}%

${tenKText ? `10-K FILING EXCERPTS (Business Description, Risk Factors, MD&A):
${tenKText}` : 'Note: 10-K text unavailable — base analysis on general knowledge of this company.'}

Provide a rigorous value investing analysis. Be direct and honest — don't sugarcoat risks.

Respond in this exact JSON format:
{
  "moatScore": <0-10, where 10 = Coca-Cola/Apple brand level moat>,
  "moatType": "<wide|narrow|none>",
  "moatSources": ["<source1>", "<source2>"],
  "managementScore": <0-10, capital allocation quality and shareholder orientation>,
  "businessQuality": "<exceptional|good|fair|poor>",
  "thesis": "<2-3 sentence investment thesis focusing on why this is (or isn't) a good value investment now>",
  "keyRisks": ["<risk1>", "<risk2>", "<risk3>"],
  "catalysts": ["<catalyst1>", "<catalyst2>"],
  "verdict": "<strong_buy|buy|watch|avoid>",
  "confidence": <0-100>
}

Moat sources can include: brand, switching_costs, network_effects, cost_advantage, intangible_assets, efficient_scale, regulatory_moat.`

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = (msg.content[0] as { type: string; text: string }).text ?? ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])

    const analysis: MoatAnalysis = {
      ticker: ticker.toUpperCase(),
      companyName,
      moatScore: Math.min(10, Math.max(0, Number(parsed.moatScore) || 0)),
      moatType: parsed.moatType ?? 'none',
      moatSources: Array.isArray(parsed.moatSources) ? parsed.moatSources : [],
      managementScore: Math.min(10, Math.max(0, Number(parsed.managementScore) || 0)),
      businessQuality: parsed.businessQuality ?? 'fair',
      thesis: parsed.thesis ?? '',
      keyRisks: Array.isArray(parsed.keyRisks) ? parsed.keyRisks : [],
      catalysts: Array.isArray(parsed.catalysts) ? parsed.catalysts : [],
      verdict: parsed.verdict ?? 'watch',
      confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 50)),
      generatedAt: new Date().toISOString(),
    }

    // Cache for 7 days
    analysisCache.set(cacheKey, { analysis, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 })
    return analysis
  } catch { return null }
}

// Translate moat analysis verdict to score boost/penalty applied to philosophy score
export function moatScoreAdjustment(analysis: MoatAnalysis): number {
  let adj = 0
  // Moat quality boost
  if (analysis.moatScore >= 8) adj += 10
  else if (analysis.moatScore >= 6) adj += 5
  else if (analysis.moatScore >= 4) adj += 2
  else if (analysis.moatScore < 2) adj -= 10  // no moat is a red flag

  // Management quality
  if (analysis.managementScore >= 8) adj += 5
  else if (analysis.managementScore < 4) adj -= 5

  // Verdict
  if (analysis.verdict === 'avoid') adj -= 15
  else if (analysis.verdict === 'strong_buy') adj += 8

  return Math.max(-20, Math.min(15, adj))
}
