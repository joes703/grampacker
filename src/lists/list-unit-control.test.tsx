// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
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
// Route identity, mode controls, and units share one document toolbar at every
// viewport so switching modes changes tools without replacing the heading.
describe('list unit control placement', () => {
  it('keeps a single unit control in the viewport-independent toolbar', () => {
    render(<ListDocumentToolbar list={list} mode="edit" />, { wrapper: MemoryRouter })

    expect(screen.getAllByRole('radiogroup', { name: 'Weight units' })).toHaveLength(1)

    const sources = import.meta.glob('./ListDetailPage.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    const src = Object.values(sources)[0]!
    expect(src).not.toContain('idPrefix="list-mobile"')
    expect(src.match(/<ListDocumentToolbar/g)).toHaveLength(1)
  })

  it('hides the unit control and list options in Pack', () => {
    render(
      <ListDocumentToolbar list={list} mode="pack" />,
      { wrapper: MemoryRouter },
    )
    expect(screen.queryByRole('radiogroup', { name: 'Weight units' })).toBeNull()
    expect(screen.queryByText('list-settings-button')).toBeNull()
  })

  it('offers List and Pack as peer views in every list mode', () => {
    // Organize was a third peer here. It merged into Pack, so the nav is two
    // destinations and nothing links to /organize any more - the retired URLs
    // survive only as redirects (see list-detail-mode).
    const { rerender } = render(
      <ListDocumentToolbar
        list={list}
        mode="edit"
      />,
      { wrapper: MemoryRouter },
    )
    expect(screen.getByRole('navigation', { name: 'List views' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'List', current: 'page' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pack' })).not.toHaveAttribute('aria-current')
    expect(screen.queryByRole('link', { name: 'Organize' })).toBeNull()

    rerender(
      <ListDocumentToolbar
        list={list}
        mode="pack"
      />,
    )
    expect(screen.getByRole('link', { name: 'Pack', current: 'page' })).toBeInTheDocument()
  })
})
