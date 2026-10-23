// @vitest-environment jsdom
import { makeList } from '../test/fixtures'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { Category } from '../lib/types'
import { renderListDetailPage, shimDialog, stubViewport } from './test/list-detail-harness'

// In-list category creation (AddCategoryControl + the starter section).
// Building a list from scratch used to dead-end: an empty list pointed at
// the gear picker, and making a category meant leaving for the Gear page -
// the first stumble in every 2026-10 UX audit run. The page-level piece
// worth testing here is the starter-section bridge: the list view hides
// empty categories by design, so a category created here must render its
// (empty) section anyway, with the add-item row already open.

const listId = 'list-1'
const list = makeList({ id: listId, name: 'Sierra High Route' })

const created: Category = {
  id: 'c-new',
  name: 'Shelter',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
  createCategory: vi.fn(),
}))

vi.mock('../lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'owner-1' } }, isPending: false }) },
}))

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, ...h }
})

beforeAll(shimDialog)

beforeEach(() => {
  stubViewport(1280)
  h.fetchLists.mockResolvedValue([list])
  h.fetchListItems.mockResolvedValue([])
  h.fetchGearItems.mockResolvedValue([])
  h.fetchCategories.mockResolvedValue([])
  h.fetchPackingLocations.mockResolvedValue([])
  h.fetchListFood.mockResolvedValue({ dayCount: 0, slots: [], items: [] })
  h.createCategory.mockResolvedValue(created)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('in-list category creation', () => {
  it('an empty list offers Add category and the new section opens ready to type', async () => {
    await renderListDetailPage(`/lists/${listId}`, ['/lists/:id'])

    // Empty state still points at the picker, and the category path exists.
    expect(await screen.findByText('Add gear to this list')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }))
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Shelter' } })
    fireEvent.keyDown(screen.getByLabelText('Category name'), { key: 'Enter' })

    await waitFor(() => expect(h.createCategory).toHaveBeenCalledWith('Shelter'))
    // The starter section renders although the category is empty (the list
    // view hides empty categories otherwise), with the inline add-item row
    // already open.
    expect(await screen.findByText('Shelter')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Item name')).toBeInTheDocument()
    // The empty-state cell has yielded to the section.
    expect(screen.queryByText('Add gear to this list')).toBeNull()
  })

  it('a starter category does not blank Pack’s empty state', async () => {
    // Pack never renders starter sections, so counting them as content there
    // would hide the "Add gear" guidance and show nothing in its place
    // (Codex review finding).
    await renderListDetailPage(`/lists/${listId}`, ['/lists/:id', '/lists/:id/pack'])
    await screen.findByText('Add gear to this list')
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }))
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Shelter' } })
    fireEvent.keyDown(screen.getByLabelText('Category name'), { key: 'Enter' })
    await screen.findByPlaceholderText('Item name')

    fireEvent.click(screen.getByRole('link', { name: 'Pack' }))
    expect(await screen.findByText('Add gear to this list')).toBeInTheDocument()
  })
})
