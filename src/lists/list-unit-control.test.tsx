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
vi.mock('../lib/auth-client', async () =>
  (await import('../test/auth-client-mock')).signedInAuthClient)

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

  // Persistent chrome renders in EVERY mode. The old per-mode hiding (no
  // unit control or options in Pack, no options in Food) made the view nav
  // slide sideways on every view switch, because the nav sits against the
  // controls to its right. Unit and options are also genuinely useful
  // everywhere: pack rows edit a weight at lg+, and list admin being
  // reachable mid-pack costs nothing.
  it.each(['edit', 'pack', 'food'] as const)(
    'keeps the unit control and List options in %s',
    (mode) => {
      render(
        <ListDocumentToolbar list={list} mode={mode} />,
        { wrapper: MemoryRouter },
      )
      expect(screen.getAllByRole('radiogroup', { name: 'Weight units' })).toHaveLength(1)
      expect(screen.getByText('list-settings-button')).toBeInTheDocument()
    },
  )

  // Print is the one contextual tool: pack-only, and placed at the LEFT end
  // of the control group so its appearance is absorbed by the title's slack
  // instead of displacing the nav. ListDetailPage.print.test.tsx pins the
  // pack-mode presence; this pins the absence elsewhere.
  it.each(['edit', 'food'] as const)('offers no Print in %s', (mode) => {
    render(
      <ListDocumentToolbar list={list} mode={mode} />,
      { wrapper: MemoryRouter },
    )
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull()
  })

  // The tabs get a row of their own under the title, at every width, so they
  // read as the list's sections rather than one more control beside Share.
  it('puts the view tabs on their own row under the title', () => {
    render(<ListDocumentToolbar list={list} mode="edit" />, { wrapper: MemoryRouter })
    const titleRow = screen.getByTestId('list-toolbar-title-row')
    const nav = screen.getByRole('navigation', { name: 'List views' })
    expect(titleRow).toContainElement(screen.getByText('current-list-header'))
    expect(titleRow).not.toContainElement(nav)
    expect(titleRow.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
    expect(screen.getByRole('link', { name: 'List', current: 'page' })).toBeInTheDocument()
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
