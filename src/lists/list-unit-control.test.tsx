// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { List } from '../lib/types'
import ListDocumentToolbar from './ListDocumentToolbar'

vi.mock('./CurrentListHeader', () => ({ default: () => <div>current-list-header</div> }))
vi.mock('./ListSettingsButton', () => ({ default: () => <div>list-settings-button</div> }))

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const list: List = {
  id: 'list-1',
  name: 'Trip',
  description: null,
  slug: 'trip',
  foodPlanId: null,
  isShared: false,
  isDraft: false,
  groupWorn: false,
  readyChecksEnabled: false,
  sortOrder: 0,
  createdAt: '2026-06-06T00:00:00.000Z',
  updatedAt: '2026-06-06T00:00:00.000Z',
}

// The list view had no unit switcher; the only one in the product lived on the
// public share page. These pin the placement, because the placement is where
// this repo keeps getting burned.
//
// docs/ui-density.md: the mode controls move to the md+ document toolbar,
// while the unit control does not move there until lg. Their mobile wrappers
// deliberately use different breakpoints so neither control double-renders.
describe('list unit control placement', () => {
  it('gates the toolbar unit control on lg, not md', () => {
    render(<ListDocumentToolbar list={list} mode="edit" onTogglePackMode={vi.fn()} onToggleOrganizeMode={vi.fn()} />)

    const group = screen.getByRole('radiogroup', { name: 'Weight units' })
    // Walk up to the responsive wrapper and assert the breakpoint literally.
    const wrapper = group.closest('div.hidden')
    expect(wrapper).not.toBeNull()
    const cls = wrapper!.className
    expect(cls).toContain('lg:block')
    // If this ever reads md:, the control double-renders at 768-1023px
    // alongside the lg:hidden mobile placement in ListDetailPage.
    expect(cls).not.toContain('md:')
  })

  it('gates the list-detail mobile unit control on lg:hidden', () => {
    // The desktop assertion above is only half the contract: a breakpoint pair
    // is only safe if BOTH sides agree. Rendering ListDetailPage here would
    // need a QueryClient, a router and a pile of mocks for what is a one-token
    // question, so this reads the source instead - the same '?raw' pattern the
    // repo already uses for tests that must inspect repo files (test files get
    // no node types, so there is no fs module available).
    const sources = import.meta.glob('./ListDetailPage.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    const src = Object.values(sources)[0]!

    // The mobile placement's wrapper must be lg:hidden, pairing with the
    // toolbar's hidden lg:block. If either side drifts to md:, the control
    // double-renders across 768-1023px.
    const mobileRow = src
      .split('\n')
      .find((line) => line.includes('lg:hidden') && line.includes('flex-wrap items-center gap-2'))
    expect(mobileRow, 'mobile unit/pack row wrapper not found').toBeDefined()
    expect(mobileRow).not.toContain('md:hidden')
    // And the control itself is inside that row, not gated separately.
    expect(src).toContain('idPrefix="list-mobile"')
    expect(src).toContain('className="md:hidden"')
    expect(src).toContain('<ListModeToggles')
  })

  it('keeps the unit control available in pack mode', () => {
    // Weights are still on screen while packing, so the switcher must not be
    // swept away with the pack-mode-suppressed list-admin controls.
    render(<ListDocumentToolbar list={list} mode="pack" onTogglePackMode={vi.fn()} onToggleOrganizeMode={vi.fn()} />)
    expect(screen.getByRole('radiogroup', { name: 'Weight units' })).toBeInTheDocument()
    // ...whereas List options IS suppressed, which is the existing contract.
    expect(screen.queryByText('list-settings-button')).toBeNull()
  })

  it('offers Pack and Organize as peer toggles in every list mode', () => {
    const onTogglePackMode = vi.fn()
    const onToggleOrganizeMode = vi.fn()
    const { rerender } = render(
      <ListDocumentToolbar
        list={list}
        mode="edit"
        onTogglePackMode={onTogglePackMode}
        onToggleOrganizeMode={onToggleOrganizeMode}
      />,
    )
    expect(screen.getByRole('group', { name: 'List mode' })).toBeInTheDocument()
    const pack = screen.getByRole('button', { name: 'Pack mode' })
    const organize = screen.getByRole('button', { name: 'Organize mode' })
    expect(pack).toHaveAttribute('aria-pressed', 'false')
    expect(organize).toHaveAttribute('aria-pressed', 'false')
    pack.click()
    organize.click()
    expect(onTogglePackMode).toHaveBeenCalledTimes(1)
    expect(onToggleOrganizeMode).toHaveBeenCalledTimes(1)

    rerender(
      <ListDocumentToolbar
        list={list}
        mode="organize"
        onTogglePackMode={onTogglePackMode}
        onToggleOrganizeMode={onToggleOrganizeMode}
      />,
    )
    expect(screen.getByRole('button', { name: 'Pack mode' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Organize mode' })).toHaveAttribute('aria-pressed', 'true')
  })
})
