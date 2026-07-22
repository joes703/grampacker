import { describe, expect, it } from 'vitest'
import { buildMobileDestinationItems } from './mobile-nav-destinations'

// Food is parked, so the primary destinations are Gear and Lists only.
//
// The mobile array is consumed by every bottom action bar. AppShell's own
// rendered test independently pins the desktop half of the same contract.
const EXPECTED = ['Gear', 'Lists']

describe('primary navigation order', () => {
  it('orders the mobile destination slots Gear, Lists', () => {
    const items = buildMobileDestinationItems('/gear')
    expect(items.map((i) => i.label)).toEqual(EXPECTED)
  })

  it('keeps each slot pointing at its own route after the reorder', () => {
    // A reorder that swapped labels but not targets would still pass the
    // ordering assertion above, so pin the pairing too.
    const items = buildMobileDestinationItems('/gear')
    expect(items.map((i) => (i.type === 'link' ? i.to : null))).toEqual([
      '/gear',
      '/lists',
    ])
  })

  it('keeps Lists as the same index destination at every viewport', () => {
    const sources = import.meta.glob('./AppShell.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    const src = Object.values(sources)[0]!

    function linkElement(to: string): string {
      const start = src.indexOf(`to="${to}"`)
      expect(start, `no <Link to="${to}"> found`).toBeGreaterThan(-1)
      const end = src.indexOf('</Link>', start)
      expect(end, `unterminated <Link to="${to}">`).toBeGreaterThan(-1)
      return src.slice(start, end)
    }

    expect(linkElement('/lists')).not.toContain('readLastListPath()')
    expect(src).not.toContain("from '../lib/last-list-path'")
  })

  it('hands primary navigation from the bottom bar to the header at lg', () => {
    const sources = import.meta.glob('./AppShell.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    const src = Object.values(sources)[0]!

    expect(src).toContain('className="hidden lg:flex items-center gap-4"')
    expect(src).not.toContain('className="hidden md:flex items-center gap-4"')
  })
})
