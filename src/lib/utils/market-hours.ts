export function isMarketHours(): boolean {
  const now = new Date()
  // Convert to ET
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay() // 0=Sun, 6=Sat
  const hour = et.getHours()
  const minute = et.getMinutes()
  const timeInMinutes = hour * 60 + minute
  const marketOpen = 9 * 60 + 30  // 9:30 ET
  const marketClose = 16 * 60     // 16:00 ET
  return day >= 1 && day <= 5 && timeInMinutes >= marketOpen && timeInMinutes < marketClose
}

export function isMarketDay(): boolean {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  return day >= 1 && day <= 5
}
