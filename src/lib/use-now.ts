import { useEffect, useState } from 'react'

/**
 * Returns the current `Date.now()` and re-renders the consumer at the
 * given interval. Use for relative-time displays ("5 mins ago") that
 * need to retick while the user keeps the page open.
 *
 * One interval per consumer; multiple consumers don't share a clock.
 * That's intentional — different parts of the UI may want different
 * granularities (a 1s clock for a stopwatch, a 60s clock for relative
 * dates), and at our app's scale the cost of two intervals is nothing.
 *
 * Background-tab behavior: most browsers throttle setInterval in
 * background tabs (typically clamped to ≥1s), so the clock ticks less
 * often when the user isn't looking. A foreground tab stays in sync
 * within `intervalMs` of real time. Acceptable for our use case
 * (relative dates that the user only reads while the page is visible).
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
