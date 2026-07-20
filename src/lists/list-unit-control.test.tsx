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
// docs/ui-density.md: the mobile bottom bar is `lg:hidden`, so any control with
// a separate mobile placement must gate its desktop copy on `lg`, NOT `md`, or
// both render across 768-1023px. That exact bug has shipped four times here
// (gear, food, lists add-affordances) and STILL exists for the Pack toggle -
// ListDocumentToolbar is `hidden md:flex` while MobilePackToggle is
// `lg:hidden`. Fixing Pack is its own change; this asserts the unit control
// does not join it.
describe('list unit control placement', () => {
  it('gates the toolbar unit control on lg, not md', () => {
    render(<ListDocumentToolbar list={list} packMode={false} onTogglePackMode={vi.fn()} />)

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
      .find((line) => line.includes('lg:hidden') && line.includes('flex items-center gap-2'))
    expect(mobileRow, 'mobile unit/pack row wrapper not found').toBeDefined()
    expect(mobileRow).not.toContain('md:hidden')
    // And the control itself is inside that row, not gated separately.
    expect(src).toContain('idPrefix="list-mobile"')
  })

  it('keeps the unit control available in pack mode', () => {
    // Weights are still on screen while packing, so the switcher must not be
    // swept away with the pack-mode-suppressed list-admin controls.
    render(<ListDocumentToolbar list={list} packMode onTogglePackMode={vi.fn()} />)
    expect(screen.getByRole('radiogroup', { name: 'Weight units' })).toBeInTheDocument()
    // ...whereas List options IS suppressed, which is the existing contract.
    expect(screen.queryByText('list-settings-button')).toBeNull()
  })
})
