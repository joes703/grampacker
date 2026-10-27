// Dates shown in the app, in the browser's own locale and wording.

// "Jan 5, 2026": list rows past a week and gear purchase dates.
export const SHORT_DATE = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// "now", "5 minutes ago", "yesterday", ... for the last week, then SHORT_DATE.
// `now` comes from the caller (ListRow's useNow), so the text re-ticks each
// minute while the page stays open.
export function formatRelativeDate(iso: string, now: number): string {
  const diffMs = now - new Date(iso).getTime()
  if (diffMs < MINUTE) return RELATIVE.format(0, 'second')
  if (diffMs < HOUR) return RELATIVE.format(-Math.floor(diffMs / MINUTE), 'minute')
  if (diffMs < DAY) return RELATIVE.format(-Math.floor(diffMs / HOUR), 'hour')
  if (diffMs < 7 * DAY) return RELATIVE.format(-Math.floor(diffMs / DAY), 'day')
  return SHORT_DATE.format(new Date(iso))
}

const pad = (n: number) => String(n).padStart(2, '0')

// Local date and time parts, zero-padded: { date: '2026-07-09', hh, mm, ss }.
export function localTimestampParts(d: Date) {
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hh: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  }
}
