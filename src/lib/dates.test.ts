import { describe, expect, it } from 'vitest'
import { formatRelativeDate } from './dates'

const now = Date.parse('2026-10-27T12:00:00Z')
const ago = (ms: number) => new Date(now - ms).toISOString()
const MIN = 60_000

// "Updated ..." on a list row: the browser's relative wording for the last
// week, then a short date.
describe('formatRelativeDate', () => {
  it('uses relative words for the last week', () => {
    expect(formatRelativeDate(ago(10_000), now)).toBe('now')
    expect(formatRelativeDate(ago(5 * MIN), now)).toBe('5 minutes ago')
    expect(formatRelativeDate(ago(3 * 60 * MIN), now)).toBe('3 hours ago')
    expect(formatRelativeDate(ago(3 * 24 * 60 * MIN), now)).toBe('3 days ago')
  })

  it('uses a short date after a week', () => {
    expect(formatRelativeDate('2026-01-05T12:00:00Z', now)).toBe(
      new Date('2026-01-05T12:00:00Z').toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    )
  })
})
