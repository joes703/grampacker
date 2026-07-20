import { describe, expect, it } from 'vitest'
import { buildMobileDestinationItems } from './mobile-nav-destinations'

// The primary destinations read Gear, Lists, Food. Lists sits in the middle
// because it is the workspace users move through most; Food is the newest and
// least-visited surface.
//
// The order exists in TWO places that cannot import each other: this shared
// array (consumed by six mobile bars) and the hand-written <Link>s in
// AppShell's desktop header, which differ because the desktop Lists link
// carries a "return to last opened list" onClick the mobile array has no
// equivalent for. Two sources, one contract - so this pins the shared half by
// behavior, and asserts the desktop half by reading AppShell's source, since
// rendering AppShell would need a session, a router and a QueryClient for what
// is a pure ordering question.
const EXPECTED = ['Gear', 'Lists', 'Food']

describe('primary navigation order', () => {
  it('orders the mobile destination slots Gear, Lists, Food', () => {
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
      '/food',
    ])
  })

  it('orders the desktop header links the same way', () => {
    const sources = import.meta.glob('./AppShell.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    const src = Object.values(sources)[0]!

    // Read the order the nav's <Link to="..."> targets appear in. Scoped to
    // the three destination routes so the brand link (to="/") and the settings
    // cog cannot shift the result.
    const order = [...src.matchAll(/to="(\/gear|\/lists|\/food)"/g)].map((m) => m[1])
    expect(order).toEqual(['/gear', '/lists', '/food'])
  })

  it('keeps the last-opened-list shortcut on the Lists link specifically', () => {
    // Moving the Lists <Link> past Food meant moving its onClick intercept
    // with it. An earlier version of this test just asserted
    // readLastListPath() appeared SOMEWHERE in the file, which would still
    // pass if the reorder had left the handler on the Food link - i.e. it
    // proved nothing about the thing that could actually break. Scope it to
    // the link element that owns it.
    const sources = import.meta.glob('./AppShell.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    const src = Object.values(sources)[0]!

    // Slice each destination <Link ...> element out by its `to` target and
    // check which one carries the handler.
    function linkElement(to: string): string {
      const start = src.indexOf(`to="${to}"`)
      expect(start, `no <Link to="${to}"> found`).toBeGreaterThan(-1)
      const end = src.indexOf('</Link>', start)
      expect(end, `unterminated <Link to="${to}">`).toBeGreaterThan(-1)
      return src.slice(start, end)
    }

    expect(linkElement('/lists')).toContain('readLastListPath()')
    // ...and nowhere else in the nav, which is what the old assertion missed.
    expect(linkElement('/food')).not.toContain('readLastListPath()')
    expect(linkElement('/gear')).not.toContain('readLastListPath()')
  })
})
