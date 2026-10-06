// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { GearItem, List, ListItemWithGear } from '../lib/types'
import ListDocumentToolbar from './ListDocumentToolbar'
import {
  emptyFood,
  list as pageList,
  listId,
  renderListDetailPage,
  stubViewport,
} from './test/list-detail-harness'

vi.mock('./CurrentListHeader', () => ({ default: () => <div>current-list-header</div> }))
vi.mock('./ListSettingsButton', () => ({ default: () => <div>list-settings-button</div> }))

// For the one test that mounts the whole page.
const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
}))

// Keeps better-auth's session atom from mounting (test/list-detail-harness.tsx
// explains why).
vi.mock('../lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'owner-1' } }, isPending: false }) },
}))

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, ...h }
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

const list: List = {
  id: 'list-1',
  name: 'Trip',
  description: null,
  slug: 'trip',
  isShared: false,
  isDraft: false,
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
  it('keeps a single unit control in the viewport-independent toolbar', async () => {
    const gear = { id: 'gear-1', name: 'Cooking pot', weightGrams: 210, categoryId: null } as unknown as GearItem
    h.fetchLists.mockResolvedValue([pageList])
    h.fetchListItems.mockResolvedValue([
      { id: 'li-1', gearItemId: 'gear-1', gearItem: gear, quantity: 1, sortOrder: 0 } as unknown as ListItemWithGear,
    ])
    h.fetchGearItems.mockResolvedValue([gear])
    h.fetchCategories.mockResolvedValue([])
    h.fetchPackingLocations.mockResolvedValue([])
    h.fetchListFood.mockResolvedValue(emptyFood)

    // The page mounts different surfaces below and above lg, so check both.
    for (const width of [375, 1280]) {
      stubViewport(width)
      await renderListDetailPage(`/lists/${listId}`, ['/lists/:id'])
      // The category footer exists only past the page's loading gate.
      await screen.findByRole('button', { name: 'Add new item' })
      expect(screen.getAllByRole('radiogroup', { name: 'Weight units' }), `${width}px`).toHaveLength(1)
      cleanup()
    }
  })

  it('hides the unit control and list options in Pack', () => {
    render(
      <ListDocumentToolbar list={list} mode="pack" />,
      { wrapper: MemoryRouter },
    )
    expect(screen.queryByRole('radiogroup', { name: 'Weight units' })).toBeNull()
    expect(screen.queryByText('list-settings-button')).toBeNull()
  })

  // Food is weights everywhere - hiding the page-level unit control there
  // would be a regression - but list admin (Options) is not a food-view
  // concern, same as Pack.
  it('keeps the unit control but hides list options in Food', () => {
    render(
      <ListDocumentToolbar list={list} mode="food" />,
      { wrapper: MemoryRouter },
    )
    expect(screen.getAllByRole('radiogroup', { name: 'Weight units' })).toHaveLength(1)
    expect(screen.queryByText('list-settings-button')).toBeNull()
  })

  // The toolbar passes its mode on to the view nav, which marks that view as
  // the current page. ListViewNav.test.tsx covers the nav's own links.
  it('marks the current view in the view nav', () => {
    const { rerender } = render(
      <ListDocumentToolbar
        list={list}
        mode="edit"
      />,
      { wrapper: MemoryRouter },
    )
    expect(screen.getByRole('navigation', { name: 'List views' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Category', current: 'page' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pack' })).not.toHaveAttribute('aria-current')

    rerender(
      <ListDocumentToolbar
        list={list}
        mode="pack"
      />,
    )
    expect(screen.getByRole('link', { name: 'Pack', current: 'page' })).toBeInTheDocument()
  })
})
