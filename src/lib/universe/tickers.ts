// ─── Stock Universe ──────────────────────────────────────────────────────────
//
// A curated ~300-ticker value universe used as a fallback when FMP's paid
// screener endpoint is unavailable (free tier). Covers S&P 500 value names,
// dividend payers, financials, industrials, energy, and known Graham-type stocks.
//
// The autopilot rotates through this list in daily batches so the full universe
// is covered in ~10 days. Each ticker is then quick-screened (2 FMP calls)
// before deep analysis (7 FMP calls), so only the cheap ones use quota.

export const VALUE_UNIVERSE: string[] = [
  // Financials / Banks
  'JPM','BAC','WFC','C','USB','TFC','PNC','SCHW','MS','GS','BK','STT',
  'MTB','RF','CFG','HBAN','KEY','FITB','ZION','FHN','WAL','EWBC',
  // Insurance
  'BRK.B','AFL','MET','PRU','AIG','ALL','HIG','L','CB','TRV','PGR',
  // Healthcare
  'JNJ','ABBV','MRK','PFE','BMY','AMGN','GILD','CVS','CI','HUM','MOH',
  'UNH','ELV','CNC','HCA','THC','UHS','ANTM',
  // Energy
  'XOM','CVX','COP','EOG','PSX','VLO','MPC','OXY','DVN','PXD','FANG',
  'HAL','SLB','BKR','NOV',
  // Materials / Industrials
  'MMM','GE','HON','RTX','LMT','NOC','GD','BA','CAT','DE','EMR','ETN',
  'PH','ROK','AME','CARR','OTIS','XYL','ITW','DOV',
  // Consumer Staples
  'KO','PEP','PM','MO','BTI','WMT','TGT','KR','SYY','HRL','CAG','CPB',
  'GIS','K','MKC','CLX','CHD','CL','PG','KMB',
  // Consumer Discretionary (value names)
  'GM','F','STLA','LKQ','AN','LAD','KMX','AZO','ORLY','PAG',
  // Technology (value zone)
  'CSCO','IBM','HPQ','HPE','INTC','MU','STX','WDC','JNPR','NTAP','LRCX',
  'KLAC','TXN','QCOM','MSI','CDW','LDOS','SAIC','CACI','EPAM',
  // Utilities
  'NEE','SO','DUK','AEP','D','EXC','SRE','XEL','WEC','ES','PPL','FE',
  'NI','CNP','OGE','PNW',
  // REITs
  'O','VICI','MPW','WPC','NNN','STOR','ADC','EPRT','IIPR','STAG',
  // Telecom
  'VZ','T','TMUS','LUMN','CMCSA','CHTR','DISH',
  // Small/mid cap value
  'GOOG','META','AMZN', // large but value-zone on earnings basis
  'WBA','CVS','RAD',
  'BIG','M','JWN','KSS','BBY',
  'MHO','MDC','TPH','LGIH','GRBK','SKY',
  'NUE','STLD','CMC','RS','WOR','ZEUS',
  'MATX','SAIA','ODFL','XPO','JBHT','CHRW',
  'ORI','RLI','KMPR','CINF','SFG','ERIE',
  'AVA','POR','MGEE','SJW','MSEX','CWCO',
  'BEN','IVZ','AMG','VRTS','ROME','VCNX',
  'DFS','COF','SYF','AXP','ADS','CACC',
  'SNV','CMA','BOKF','FFIN','CBSH','PACW',
  'OLN','ALB','FMC','CE','EMN','HUN','TROX',
  'PKG','IP','SEE','SLVM','BERY','GPAK',
  'WTRG','AWR','SJW','ARTNA','YORW',
  'MOS','CF','NTR','FMC','ICL',
  'ADNT','LEA','BWA','DAN','VC','APTV',
  'R','URI','HSC','KAR','CPRT','IAA',
].filter((v, i, a) => a.indexOf(v) === i) // deduplicate

// Daily rotation: pick a batch of N tickers starting at today's offset.
// This ensures the full universe is covered in ceil(UNIVERSE.length / batchSize) days.
export function getDailyBatch(batchSize: number, date: Date = new Date()): string[] {
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000
  )
  const start = (dayOfYear * batchSize) % VALUE_UNIVERSE.length
  const end   = start + batchSize

  if (end <= VALUE_UNIVERSE.length) {
    return VALUE_UNIVERSE.slice(start, end)
  }
  // Wrap around end of list
  return [...VALUE_UNIVERSE.slice(start), ...VALUE_UNIVERSE.slice(0, end - VALUE_UNIVERSE.length)]
}
