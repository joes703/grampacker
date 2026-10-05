import { describe, expect, it } from 'vitest'
import { buildMobileDestinationItems } from './mobile-nav-destinations'

// Food is parked, so the primary destinations are Gear and Lists only.
//
// The mobile array is consumed by every bottom action bar. AppShell's own
// rendered test independently pins the desktop half of the same contract.
const EXPECTED = ['Gear', 'Lists']

describe('primary navigation order', () => {
  it('keeps each slot pointing at its own route after the reorder', () => {
    // The label order is pinned on the rendered bar (mobile-action-bars.test.tsx).
    // A reorder that swapped labels but not targets would still pass that, so
    // pin the pairing too.
    const items = buildMobileDestinationItems('/gear')
    expect(items.map((i) => i.label)).toEqual(EXPECTED)
    expect(items.map((i) => (i.type === 'link' ? i.to : null))).toEqual([
      '/gear',
      '/lists',
    ])
  })
})
