// @vitest-environment jsdom
import { makeList, makeListItem } from '../test/fixtures'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { Category, GearItem } from '../lib/types'
import { renderListDetailPage, shimDialog, stubViewport } from './test/list-detail-harness'

// The list row's inline description cell clears to NULL: the write contract
// rejects '' (empty string is not a valid description - clients send null),
// so the page's sharedGroupProps boundary converts the control's empty
// emission before updateGearItem sees it. The name cell keeps the non-blank
// rule and commits nothing when cleared. GearItemRow.test.tsx pins the same
// pair on the gear library's own rows; this file pins the second surface.

const listId = 'list-1'

const list = makeList({
  id: listId,
  name: 'Sierra High Route',
  isShared: false,
  updatedAt: '2026-07-01T00:00:00.000Z',
})

const category: Category = {
  id: 'c1',
  name: 'Shelter',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const gear: GearItem = {
  id: 'g1',
  categoryId: 'c1',
  name: 'Tent',
  description: 'Two-person',
  weightGrams: 1000,
  cost: null,
  purchaseDate: null,
  status: 'active',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const listItem = makeListItem({
  id: 'li-1',
  gearItemId: 'g1',
  gearItem: gear,
  quantity: 1,
  isWorn: false,
  isConsumable: false,
  sortOrder: 0,
  packingLocationId: null,
})

const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
  updateGearItem: vi.fn<(id: string, patch: unknown) => Promise<unknown>>(),
}))

// Keeps better-auth's session atom from mounting (test/list-detail-harness.tsx
// explains why); only the last-list pointer reads it.
vi.mock('../lib/auth-client', async () =>
  (await import('../test/auth-client-mock')).signedInAuthClient)

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, ...h }
})

beforeAll(shimDialog)

beforeEach(() => {
  stubViewport(1280)
  h.fetchLists.mockResolvedValue([list])
  h.fetchListItems.mockResolvedValue([listItem])
  h.fetchGearItems.mockResolvedValue([gear])
  h.fetchCategories.mockResolvedValue([category])
  h.fetchPackingLocations.mockResolvedValue([])
  h.fetchListFood.mockResolvedValue({ dayCount: 0, slots: [], items: [] })
  h.updateGearItem.mockResolvedValue(gear)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

async function renderDetail() {
  await renderListDetailPage(`/lists/${listId}`, ['/lists/:id'])
  await screen.findByText('Two-person')
}

describe('list row inline description clearing', () => {
  it('clearing the description patches null', async () => {
    await renderDetail()
    fireEvent.click(screen.getByText('Two-person'))
    const input = screen.getByDisplayValue('Two-person')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // mutate() runs its mutationFn on a microtask.
    await waitFor(() =>
      expect(h.updateGearItem).toHaveBeenCalledWith('g1', { description: null }),
    )
  })

  it('clearing the name patches nothing', async () => {
    await renderDetail()
    // Role-scoped: the gear picker panel shows the same name as a static span.
    fireEvent.click(screen.getByRole('button', { name: 'Tent' }))
    const input = screen.getByDisplayValue('Tent')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // Flush the microtask a mutate() would have scheduled before asserting
    // the absence.
    await act(async () => {
      await Promise.resolve()
    })
    expect(h.updateGearItem).not.toHaveBeenCalled()
  })
})
