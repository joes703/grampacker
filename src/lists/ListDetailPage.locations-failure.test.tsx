// @vitest-environment jsdom
import { makeGearItem, makeListItem } from '../test/fixtures'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { makeDnDId } from '../lib/dnd-ids'
import type { Category, PackingLocation } from '../lib/types'
import {
  emptyFood,
  list,
  listId,
  renderListDetailPage,
  stubViewport,
} from './test/list-detail-harness'
import { deferred } from '../test/deferred'

// What a FAILED packing-locations query is allowed to do to the page.
//
// The locations query is deliberately outside the detail-data gate: the list
// stays usable while it loads, and the removal preflight resolves the query
// itself rather than trusting the render's array. The cost of that choice is
// that `packingLocations` is [] in three different situations - still loading,
// failed, and genuinely empty - and only the last one may be written against.
//
// Every case below is a write that was computed from that fallback array:
// creating a location whose sort slot is derived from "no locations", moving an
// item to Unassigned chosen from a destination list built out of nothing, and a
// pack reorder whose planner assumes a single Unassigned cohort. The
// location-free list is the control: a SUCCESSFUL [] is resolved, and must keep
// working exactly as before.

const gear = makeGearItem({
  id: 'gear-1',
  name: 'Cooking pot',
  weightGrams: 210,
  categoryId: null,
})

const listItem = makeListItem({
  id: 'li-1',
  gearItemId: 'gear-1',
  gearItem: gear,
  quantity: 1,
  isWorn: false,
  isConsumable: false,
  isPacked: false,
  isReady: false,
  // Non-null: this row really does sit in a bag. It is the row for which an
  // enabled "Unassigned" is a wrong write rather than a no-op.
  packingLocationId: 'loc-1',
  sortOrder: 0,
  packSortOrder: 0,
})

const secondItem = makeListItem({
  ...listItem,
  id: 'li-2',
  gearItemId: 'gear-2',
  gearItem: { ...gear, id: 'gear-2', name: 'Stove' },
  sortOrder: 1,
  packSortOrder: 1,
})

const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
  reorderPackListItems: vi.fn(),
  reorderListItems: vi.fn(),
}))

// Keeps better-auth's session atom from mounting (test/list-detail-harness.tsx
// explains why). The session is read here only for the last-list pointer's
// owner id, which no test in this file asserts on.
vi.mock('../lib/auth-client', async () =>
  (await import('../test/auth-client-mock')).signedInAuthClient)

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, ...h }
})

// dnd-kit cannot be driven by a synthetic pointer sequence in jsdom, and the
// guard under test lives in the page's own onDragEnd rather than in the pure
// planner. Mocking DndContext to expose that handler is the only way to reach
// it - the same passthrough pattern the gear bulk-actions suite uses.
vi.mock('@dnd-kit/core', async () =>
  (await import('../test/dnd-kit-mock')).mockDndKitCore(() => ({
    active: { id: makeDnDId('item', 'li-2') },
    over: { id: makeDnDId('item', 'li-1') },
  })))

vi.mock('@dnd-kit/sortable', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/sortable')>('@dnd-kit/sortable')
  return {
    ...actual,
    SortableContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  }
})

async function renderDetail(path: string) {
  await renderListDetailPage(path, ['/lists/:id', '/lists/:id/pack'])
  // Anchors on content that only exists past the detail loading gate. The
  // packing location create form is unconditional in Pack mode (not gated on
  // items or on the packing-locations query this file exercises), so it
  // survives every scenario below, including the zero-items one.
  await screen.findByLabelText('New packing location')
}

const locationInput = () => screen.getByLabelText('New packing location')
// Scoped to the create form: an empty list renders its own "Add" affordance
// elsewhere on the page, so a bare role+name query is ambiguous.
const addLocation = () =>
  within(locationInput().closest('form') as HTMLFormElement)
    .getByRole('button', { name: 'Add' })

async function openRowMenu() {
  await userEvent.click(
    screen.getByRole('button', { name: 'Open Cooking pot packing options' }),
  )
}

beforeEach(() => {
  stubViewport(1280)
  h.fetchLists.mockResolvedValue([list])
  h.fetchListItems.mockResolvedValue([listItem, secondItem])
  h.fetchGearItems.mockResolvedValue([gear])
  h.fetchCategories.mockResolvedValue([] as Category[])
  h.fetchListFood.mockResolvedValue(emptyFood)
  h.reorderPackListItems.mockResolvedValue(undefined)
  h.reorderListItems.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('a list that genuinely has no packing locations', () => {
  beforeEach(() => {
    h.fetchPackingLocations.mockResolvedValue([] as PackingLocation[])
  })

  // The control for everything below. A successful [] is RESOLVED - we know
  // there are none - so none of the gates may fire. This is every list's first
  // visit to Pack, and it must stay fully usable.
  it('can still create a location', async () => {
    await renderDetail(`/lists/${listId}/pack`)

    fireEvent.change(locationInput(), { target: { value: 'Main pack' } })
    expect(addLocation()).toBeEnabled()
  })

  it('still offers the onboarding nudge, which is only true when resolved', async () => {
    await renderDetail(`/lists/${listId}/pack`)
    expect(
      screen.getByRole('heading', { name: 'Start with where your gear lives' }),
    ).toBeInTheDocument()
  })

  // mode decides which ordering a drag writes, NOT grouping.kind - so a
  // category-grouped pack surface still writes PACK ranks. That combination is
  // the one this guard has to leave alone for a location-free list.
  it('still lets a pack drag write pack order', async () => {
    await renderDetail(`/lists/${listId}/pack`)
    // The locations query is NOT part of the detail gate, so the Food heading
    // renderDetail waits on says nothing about it. The nudge renders only when
    // locations RESOLVED empty, which is the state under test - without this
    // anchor the drag fires while the query is still pending and the guard
    // (correctly) refuses it, making the control pass for the wrong reason.
    await screen.findByRole('heading', { name: 'Start with where your gear lives' })

    fireEvent.click(screen.getByRole('button', { name: 'fire drag end' }))

    // mutate() dispatches its mutationFn asynchronously, so this has to wait
    // rather than assert on the same tick as the click.
    await waitFor(() => expect(h.reorderPackListItems).toHaveBeenCalled())
  })

  it('leaves the row menu fully usable', async () => {
    await renderDetail(`/lists/${listId}/pack`)
    await openRowMenu()

    expect(screen.getByRole('button', { name: /Use as container/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Unassigned/ })).toBeEnabled()
  })
})

describe('a packing-locations query that failed to load', () => {
  beforeEach(() => {
    h.fetchPackingLocations.mockRejectedValue(new Error('offline'))
  })

  // The cap check reads locations.length, so with [] it is vacuous, and the
  // optimistic insert would compute its slot against no locations at all.
  it('refuses to create a location', async () => {
    await renderDetail(`/lists/${listId}/pack`)

    fireEvent.change(locationInput(), { target: { value: 'Main pack' } })
    expect(addLocation()).toBeDisabled()
  })

  // The nudge asserts "this list has none". A failed fetch cannot support that,
  // and its three starter buttons would happily create a duplicate.
  it('does not claim the list has no locations', async () => {
    await renderDetail(`/lists/${listId}/pack`)
    expect(
      screen.queryByRole('heading', { name: 'Start with where your gear lives' }),
    ).not.toBeInTheDocument()
  })

  // The destination list is built from the empty array PLUS a hardcoded
  // Unassigned, so the one enabled choice is the one that unassigns a row which
  // really is in a bag.
  it('disables the move destinations and container promotion', async () => {
    await renderDetail(`/lists/${listId}/pack`)
    await openRowMenu()

    expect(screen.getByRole('button', { name: /Unassigned/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Use as container/ })).toBeDisabled()
  })

  // The silent one. Grouping falls back to categories, the drag is still a PACK
  // action because mode says so, and planListItemReorder's category branch is
  // justified by "every item is in the single Unassigned cohort" - true for a
  // list that HAS no locations, false when they merely failed to load. Writing
  // anyway redistributes pack ranks across items that really do sit in
  // different bags, and nothing on screen says so.
  it('refuses to write pack order from a drag', async () => {
    await renderDetail(`/lists/${listId}/pack`)
    // Wait for the query to actually SETTLE in error. A pending locations query
    // is also refused, so without this the assertion below would hold before
    // the failure had even happened.
    await screen.findByText(
      "Couldn't load packing locations. Showing the last available grouping.",
    )

    fireEvent.click(screen.getByRole('button', { name: 'fire drag end' }))

    // Assert the guard positively - that the handler ran and REFUSED - before
    // asserting the absence, so this cannot pass merely by checking too early.
    expect(
      await screen.findByText('Cannot reorder until packing locations have loaded.'),
    ).toBeInTheDocument()
    expect(h.reorderPackListItems).not.toHaveBeenCalled()
  })

  // A list with no items yet must still show the notice and a retry, not a
  // disabled Add with no reason given. That is exactly the list a user is
  // most likely to be adding a first location to.
  it('explains itself and offers a retry on a list with no items', async () => {
    h.fetchListItems.mockResolvedValue([])
    await renderDetail(`/lists/${listId}/pack`)

    expect(
      await screen.findByText(
        "Couldn't load packing locations. Showing the last available grouping.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(addLocation()).toBeDisabled()
  })

  // The one action in that menu that stays correct during the outage:
  // requestRemoveListItem resolves the locations query itself and fail-safes to
  // a confirm, so it must NOT be swept up by the same flag.
  it('keeps Remove from list working', async () => {
    await renderDetail(`/lists/${listId}/pack`)
    await openRowMenu()

    expect(screen.getByRole('button', { name: /Remove from list/ })).toBeEnabled()
  })
})

// The reorder-pending guards must watch the PACK reorder too, not only the
// document-order mutation, which never fires in Pack view. Otherwise the
// packing menus stay live during a pack reorder and a second reorder can start
// against ranks the first is still rewriting. The guards read
// anyItemReorderPending, which watches both mutations. This lives here
// rather than in the pack suite because firing a pack reorder in jsdom needs
// this file's DndContext passthrough.
describe('a pack reorder in flight', () => {
  beforeEach(() => {
    h.fetchPackingLocations.mockResolvedValue([] as PackingLocation[])
  })

  it('locks the packing menus until it settles, then re-arms', async () => {
    const reorder = deferred<undefined>()
    h.reorderPackListItems.mockImplementation(() => reorder.promise)
    await renderDetail(`/lists/${listId}/pack`)
    // Same anchor as the drag test above: fire only once locations RESOLVED
    // empty, or the drag is refused for the unrelated still-loading reason.
    await screen.findByRole('heading', { name: 'Start with where your gear lives' })

    fireEvent.click(screen.getByRole('button', { name: 'fire drag end' }))
    await waitFor(() => expect(h.reorderPackListItems).toHaveBeenCalledTimes(1))

    // The pack write is in flight NOW, so the row's packing menu - the entry
    // point to moves and further reorders - must be locked.
    const trigger = screen.getByRole('button', {
      name: 'Open Cooking pot packing options',
    })
    await waitFor(() => expect(trigger).toBeDisabled())

    // And it is pending-scoped, not a latch: settling re-arms the menu.
    reorder.resolve(undefined)
    await waitFor(() => expect(trigger).toBeEnabled())
  })
})

describe('a list-items query that failed to load', () => {
  beforeEach(() => {
    h.fetchPackingLocations.mockResolvedValue([] as PackingLocation[])
    h.fetchListItems.mockRejectedValue(new Error('offline'))
  })

  // The gear picker mounts in the desktop aside, OUTSIDE the detail gate, so
  // it is on screen and interactive during exactly this failure. Its
  // already-on-this-list set comes from the list items, which are now [] - so
  // every row would read as not-yet-added and adding one re-adds gear the list
  // already holds.
  it('stops the gear picker offering to add gear it cannot check', async () => {
    await renderListDetailPage(`/lists/${listId}`, ['/lists/:id'])

    expect(await screen.findByText("Couldn't load this list's items.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cooking pot/ })).not.toBeInTheDocument()
  })
})
