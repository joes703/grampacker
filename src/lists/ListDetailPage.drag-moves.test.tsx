// @vitest-environment jsdom
import { makeGearItem, makeListItem } from '../test/fixtures'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Category, PackingLocation } from '../lib/types'
import type { FoodItemResponse, ListFoodResponse } from '../../shared/food'
import {
  emptyFood,
  list,
  listId,
  renderListDetailPage,
  stubViewport,
} from './test/list-detail-harness'

// Tests for the page-level drag and move wiring. The pure planners have their
// own suites; what is pinned here is which mutation each drag kind reaches,
// the payload a pack reorder sends, and the announcements a screen reader
// hears. dnd-kit cannot be driven by synthetic pointers in jsdom, so
// the DndContext stub records the page's own handlers and the tests invoke
// them with the events a real drag would deliver.

const gearA = makeGearItem({ id: 'gear-a', name: 'Stove', weightGrams: 90, categoryId: null })
const gearB = makeGearItem({ id: 'gear-b', name: 'Cooking pot', weightGrams: 210, categoryId: null })

const rowA = makeListItem({
  id: 'li-a',
  gearItemId: gearA.id,
  gearItem: gearA,
  quantity: 1,
  isWorn: false,
  isConsumable: false,
  isPacked: false,
  isReady: false,
  packingLocationId: 'loc-1',
  sortOrder: 0,
  packSortOrder: 0,
})
const rowB = makeListItem({
  ...rowA,
  id: 'li-b',
  gearItemId: gearB.id,
  gearItem: gearB,
  packingLocationId: 'loc-1',
  sortOrder: 1,
  packSortOrder: 1,
})

const backpack: PackingLocation = {
  id: 'loc-1', name: 'Backpack', sortOrder: 0, containerListItemId: null,
}
const tent: PackingLocation = {
  id: 'loc-2', name: 'Tent', sortOrder: 1, containerListItemId: null,
}

const tortillas: FoodItemResponse = {
  id: 'food-1',
  name: 'Tortillas',
  weightGrams: 300,
  quantity: 2, isPerMeal: false, unitCount: 2,
  sortOrder: 0,
  isPacked: false,
  isReady: false,
  packingLocationId: null,
  packSortOrder: 2,
  slotIds: [],
}
const foodWithTortillas: ListFoodResponse = { dayCount: 1, slots: [], items: [tortillas] }

type DragHandlers = {
  onDragStart?: (e: unknown) => void
  onDragEnd?: (e: unknown) => void
  onDragCancel?: () => void
}

const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
  updateListItem: vi.fn(),
  updateFoodItem: vi.fn(),
  reorderListItems: vi.fn(),
  reorderPackListItems: vi.fn(),
  // Latest drag handlers per mounted DndContext (the edit-mode page mounts a
  // second one inside DesktopListsPanel). Tests fire an event at every
  // instance; the handlers all parse the id's kind and the wrong ones no-op,
  // exactly as the shared real DndContext dispatches to self-gating handlers.
  dragContexts: new Map<string, DragHandlers>(),
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

// The food PATCH is imported from its own module, not the queries barrel.
vi.mock('../lib/queries/food', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries/food')>()
  return { ...actual, updateFoodItem: h.updateFoodItem }
})

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core')
  const { useEffect, useId } = await import('react')
  return {
    ...actual,
    DndContext: ({ children, onDragStart, onDragEnd, onDragCancel }: {
      children: ReactNode
    } & DragHandlers) => {
      const id = useId()
      h.dragContexts.set(id, { onDragStart, onDragEnd, onDragCancel })
      useEffect(() => () => void h.dragContexts.delete(id), [id])
      return <div>{children}</div>
    },
    DragOverlay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    useSensor: vi.fn(),
    useSensors: vi.fn(() => []),
  }
})

vi.mock('@dnd-kit/sortable', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/sortable')>('@dnd-kit/sortable')
  return {
    ...actual,
    SortableContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  }
})

function fireDragStart(e: { active: { id: string } }) {
  act(() => {
    for (const ctx of h.dragContexts.values()) ctx.onDragStart?.(e)
  })
}
function fireDragEnd(e: { active: { id: string }; over: { id: string } | null }) {
  act(() => {
    for (const ctx of h.dragContexts.values()) ctx.onDragEnd?.(e)
  })
}
function fireDragCancel() {
  act(() => {
    for (const ctx of h.dragContexts.values()) ctx.onDragCancel?.()
  })
}

async function renderPack() {
  await renderListDetailPage(`/lists/${listId}/pack`, ['/lists/:id/pack'])
  await screen.findByLabelText('New packing location')
  // The anchor above renders outside the tree; wait for the rows too, so a
  // drag never fires against a half-loaded page. findAll: the name renders
  // in the row and again in the xl picker aside.
  await screen.findAllByText('Stove')
}

async function renderEdit() {
  await renderListDetailPage(`/lists/${listId}`, ['/lists/:id'])
  await screen.findByRole('button', { name: 'Add new item' })
}

beforeEach(() => {
  stubViewport(1280)
  h.fetchLists.mockResolvedValue([list])
  h.fetchListItems.mockResolvedValue([rowA, rowB])
  h.fetchGearItems.mockResolvedValue([gearA, gearB])
  h.fetchCategories.mockResolvedValue([] as Category[])
  h.fetchPackingLocations.mockResolvedValue([backpack, tent])
  h.fetchListFood.mockResolvedValue(emptyFood)
  h.updateListItem.mockResolvedValue({ ...rowA, packingLocationId: tent.id })
  h.updateFoodItem.mockResolvedValue({ ...tortillas, packingLocationId: tent.id })
  h.reorderListItems.mockResolvedValue(undefined)
  h.reorderPackListItems.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  h.dragContexts.clear()
})

describe('cross-location drag moves', () => {
  it('moves gear dropped on another bag and narrates the move', async () => {
    await renderPack()

    fireDragEnd({
      active: { id: 'packing-item:li-a' },
      over: { id: 'packing-location:loc-2' },
    })

    // The announcement flips Moving -> Moved only after the PATCH resolves.
    expect(screen.getByText('Moving Stove to Tent.')).toBeInTheDocument()
    await waitFor(() => expect(h.updateListItem).toHaveBeenCalledTimes(1))
    expect(h.updateListItem).toHaveBeenCalledWith(listId, rowA.id, {
      packingLocationId: tent.id,
    })
    await screen.findByText('Moved Stove to Tent.')
    // A move never writes ranks through the reorder endpoints.
    expect(h.reorderListItems).not.toHaveBeenCalled()
    expect(h.reorderPackListItems).not.toHaveBeenCalled()
  })

  it('moves a food row dropped on another bag through the food PATCH', async () => {
    h.fetchListFood.mockResolvedValue(foodWithTortillas)
    await renderPack()
    await screen.findAllByText('Tortillas')

    fireDragEnd({
      active: { id: 'packing-food-item:food-1' },
      over: { id: 'packing-location:loc-2' },
    })

    expect(screen.getByText('Moving Tortillas to Tent.')).toBeInTheDocument()
    await waitFor(() => expect(h.updateFoodItem).toHaveBeenCalledTimes(1))
    expect(h.updateFoodItem).toHaveBeenCalledWith(listId, tortillas.id, {
      packingLocationId: tent.id,
    })
    await screen.findByText('Moved Tortillas to Tent.')
    expect(h.updateListItem).not.toHaveBeenCalled()
  })
})

describe('category-grouping drags', () => {
  it('routes an item: drag to the DOCUMENT reorder, never the pack one', async () => {
    await renderEdit()

    fireDragEnd({
      active: { id: 'item:li-a' },
      over: { id: 'item:li-b' },
    })

    await waitFor(() => expect(h.reorderListItems).toHaveBeenCalledTimes(1))
    const [calledListId, updates] = h.reorderListItems.mock.calls[0] as [
      string,
      { id: string; sortOrder: number }[],
    ]
    expect(calledListId).toBe(listId)
    // Document order (sortOrder), not pack rank, and both permuted rows are
    // in the payload.
    expect(updates.map((u) => u.id).sort()).toEqual(['li-a', 'li-b'])
    for (const update of updates) expect(update).toHaveProperty('sortOrder')
    expect(h.reorderPackListItems).not.toHaveBeenCalled()
  })
})

describe('drag narration', () => {
  // dnd-kit announces drag start and a user cancel itself. Our live region
  // adds only what dnd-kit cannot know (saving, saved, failed, refused).
  it('does not repeat the start or cancel of a packing drag', async () => {
    await renderPack()

    fireDragStart({ active: { id: 'packing-item:li-a' } })
    expect(screen.queryByText(/^Dragging Stove/)).toBeNull()

    fireDragCancel()
    expect(screen.queryByText('Move canceled.')).toBeNull()
  })
})

describe('pack reorder by drag', () => {
  it('sends the union pack reorder and narrates it', async () => {
    // Held open so the Reordering -> Reordered transition is observable.
    let settle!: () => void
    h.reorderPackListItems.mockImplementation(
      () => new Promise<void>((resolve) => { settle = resolve }),
    )
    await renderPack()

    fireDragEnd({
      active: { id: 'packing-item:li-a' },
      over: { id: 'packing-item:li-b' },
    })

    expect(screen.getByText('Reordering Stove.')).toBeInTheDocument()
    await waitFor(() => expect(h.reorderPackListItems).toHaveBeenCalledTimes(1))
    const [calledListId, updates] = h.reorderPackListItems.mock.calls[0] as [
      string,
      { items: { id: string; packSortOrder: number }[]; foodItems: unknown[] },
    ]
    expect(calledListId).toBe(listId)
    // Stove moves below the Cooking pot: the bag's ranks are reassigned in
    // the new order.
    expect(updates.items).toEqual([
      { id: 'li-b', packSortOrder: 0 },
      { id: 'li-a', packSortOrder: 1 },
    ])
    expect(updates.foodItems).toEqual([])
    act(() => settle())
    await screen.findByText('Reordered Stove.')
  })
})
