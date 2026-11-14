export const DAY = 86_400_000
export const startOfDay = (t: number | Date = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
export const endOfDay = (t: number | Date = Date.now()) => startOfDay(t) + DAY // exclusive (DST drift ignored)

/** Compact interval for rating buttons: "10m", "3h", "3d", "2mo", "1.2y". */
export function fmtInterval(ms: number): string {
  const m = Math.max(0, ms) / 60_000
  if (m < 0.5) return '<1m'
  if (m < 59.5) return `${Math.max(1, Math.round(m))}m`
  if (m < 1440) return `${Math.round(m / 60)}h`
  const d = m / 1440
  if (d < 30) return `${Math.round(d)}d`
  if (d < 365) return `${Math.round(d / 30)}mo`
  return `${(d / 365).toFixed(1).replace(/\.0$/, '')}y`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dateLabel = (t: number) => { const d = new Date(t); return `${MONTHS[d.getMonth()]} ${d.getDate()}` }
const clock = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** "in 4 days (Nov 18)", "in 3 hours (today 18:30)", "tomorrow (Nov 15)", "now". */
export function relDue(due: number, now = Date.now()): string {
  if (due <= now) return 'now'
  const dd = Math.round((startOfDay(due) - startOfDay(now)) / DAY)
  if (dd >= 2) return `in ${plural(dd, 'day')} (${dateLabel(due)})`
  if (dd === 1) return `tomorrow (${dateLabel(due)})`
  const min = Math.round((due - now) / 60_000)
  const rel = min < 60 ? `in ${plural(Math.max(1, min), 'minute')}` : `in ${plural(Math.round(min / 60), 'hour')}`
  return `${rel} (today ${clock(due)})`
}

/** Full sentence for a card row. */
export function nextReviewText(c: { state: number; due: number }, now = Date.now()): string {
  if (c.state === 0) return 'New card, not studied yet'
  return c.due <= now ? 'Due now' : `Next review: ${relDue(c.due, now)}`
}
