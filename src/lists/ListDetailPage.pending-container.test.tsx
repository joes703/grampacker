// @vitest-environment jsdom
import { makeGearItem, makeListItem } from '../test/fixtures'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { makeDnDId } from '../lib/dnd-ids'
import type { Category, ListItemWithGear, PackingLocation } from '../lib/types'
import {
  emptyFood,
  list,
  listId,
  renderListDetailPage,
  stubViewport,
} from './test/list-detail-harness'

// A pack drag while "Use as container" is still saving.
//
// The promotion optimistically inserts a temp- location backed by the row, and
// from that moment the row renders as the new section's header, not as a row
// in its old bag. The drag planner has to plan against the same rows: counting
// the hidden header would compute the move against a sequence the user is not
// looking at, and rewrite the header's rank as a side effect.

function gearRow(id: string, name: string, rank: number): ListItemWithGear {
  return makeListItem({
    id,
    gearItemId: `gear-${id}`,
    gearItem: makeGearItem({ id: `gear-${id}`, name, weightGrams: 100, categoryId: null }),
    quantity: 1,
    isWorn: false,
    isConsumable: false,
    isPacked: false,
    isReady: false,
    packingLocationId: 'loc-1',
    sortOrder: rank,
    packSortOrder: rank,
  })
}

// The row being promoted sits BETWEEN the two the user drags, so a planner
// that still counts it computes its move against [Stove, Stuff sack, Cooking
// pot] and rewrites the Stuff sack's rank.
const rowA = gearRow('li-a', 'Stove', 0)
const rowC = gearRow('li-c', 'Stuff sack', 1)
const rowB = gearRow('li-b', 'Cooking pot', 2)

const backpack: PackingLocation = {
  id: 'loc-1',
  name: 'Backpack',
  sortOrder: 0,
  containerListItemId: null,
}

const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
  createPackingLocation: vi.fn(),
  reorderPackListItems: vi.fn(),
}))

// See test/list-detail-harness.tsx: mocking the auth client keeps
// better-auth's session atom from outliving jsdom.
vi.mock('../lib/auth-client', async () =>
  (await import('../test/auth-client-mock')).signedInAuthClient)

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, ...h }
})

// dnd-kit cannot be driven by a synthetic pointer sequence in jsdom. The
// passthrough exposes the page's own onDragEnd, which is where the page hands
// the planner its exclusions - the part under test.
vi.mock('@dnd-kit/core', async () =>
  (await import('../test/dnd-kit-mock')).mockDndKitCore(() => ({
    active: { id: makeDnDId('packing-item', rowA.id) },
    over: { id: makeDnDId('packing-item', rowB.id) },
  })))

vi.mock('@dnd-kit/sortable', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/sortable')>('@dnd-kit/sortable')
  return {
    ...actual,
    SortableContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  }
})

async function renderPack() {
  await renderListDetailPage(`/lists/${listId}/pack`, ['/lists/:id/pack'])
}

beforeEach(() => {
  stubViewport(1280)
  h.fetchLists.mockResolvedValue([list])
  h.fetchListItems.mockResolvedValue([rowA, rowB, rowC])
  h.fetchGearItems.mockResolvedValue([rowA.gearItem, rowB.gearItem, rowC.gearItem])
  h.fetchCategories.mockResolvedValue([] as Category[])
  h.fetchPackingLocations.mockResolvedValue([backpack])
  h.fetchListFood.mockResolvedValue(emptyFood)
  h.reorderPackListItems.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('a pack drag while a container promotion is pending', () => {
  it('plans against the rows on screen and leaves the promoted row alone', async () => {
    // Held open for the whole test: the temp- location is what is under test.
    h.createPackingLocation.mockImplementation(() => new Promise(() => {}))
    await renderPack()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Open Stuff sack packing options' }),
    )
    await userEvent.click(screen.getByRole('button', { name: /Use as container/ }))
    await waitFor(() => expect(h.createPackingLocation).toHaveBeenCalledTimes(1))

    // The promoted row has left the Backpack's rows (it is now the pending
    // section's header, which has no row menu). Anchoring on that makes sure
    // the drag below fires against the optimistic state, not before it.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Open Stuff sack packing options' }),
      ).not.toBeInTheDocument(),
    )
    expect(
      screen.getByRole('button', { name: 'Open Stove packing options' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Open Cooking pot packing options' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'fire drag end' }))

    // Stove dropped on Cooking pot: the two visible rows swap their own ranks
    // (0 and 2). The Stuff sack keeps rank 1 and is not in the payload at all.
    await waitFor(() => expect(h.reorderPackListItems).toHaveBeenCalledTimes(1))
    expect(h.reorderPackListItems).toHaveBeenCalledWith(listId, {
      items: [
        { id: rowB.id, packSortOrder: 0 },
        { id: rowA.id, packSortOrder: 2 },
      ],
      foodItems: [],
    })
  })
})
