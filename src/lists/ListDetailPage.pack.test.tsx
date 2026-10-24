// @vitest-environment jsdom
import { makeGearItem, makeListItem } from '../test/fixtures'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { closestCenter, type CollisionDetection } from '@dnd-kit/core'
import type { ComponentProps } from 'react'
import { useLocation, useNavigationType } from 'react-router'
import type { Category, PackingLocation } from '../lib/types'
import {
  emptyFood,
  list,
  listId,
  renderListDetailPage,
  shimDialog,
  stubViewport,
} from './test/list-detail-harness'

// Pack's entry point back to the gear library.
//
// Desktop Pack hides the left aside on purpose so packing gets the focus.
// That also removed the only desktop way to put a forgotten item on the list
// without leaving the view - Pack could rearrange what was already there and
// nothing else. The drawer restores adding without giving the aside back.
//
// Which surface carries the trigger is the whole point of these tests, so
// they assert per-breakpoint and per-view rather than just "a button exists".

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
  packingLocationId: null,
  sortOrder: 0,
})

const wornItem = makeListItem({
  ...listItem,
  id: 'li-worn',
  gearItemId: 'gear-worn',
  gearItem: { ...gear, id: 'gear-worn', name: 'Sun hoody' },
  isWorn: true,
  sortOrder: 1,
})

const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
  deleteListItem: vi.fn(),
  quickAddListItem: vi.fn(),
  // The latest collision detector each mounted DndContext was given.
  collisionDetections: new Map<string, CollisionDetection | undefined>(),
}))

// DndContext still runs for real. The wrapper records which collision
// detector the page hands it, for the wiring test at the end. The page has
// more than one DndContext (the desktop lists panel has its own), so the
// record is per mounted instance and always holds its latest render.
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  const { createElement, useEffect, useId } = await import('react')
  return {
    ...actual,
    DndContext: (props: ComponentProps<typeof actual.DndContext>) => {
      const id = useId()
      h.collisionDetections.set(id, props.collisionDetection)
      useEffect(() => () => void h.collisionDetections.delete(id), [id])
      return createElement(actual.DndContext, props)
    },
  }
})

// Keeps better-auth's session atom from mounting (test/list-detail-harness.tsx
// explains why). The session is read here only for the last-list pointer's
// owner id, which no test in this file asserts on.
vi.mock('../lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'owner-1' } }, isPending: false }) },
}))

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, ...h }
})

async function renderDetail(path: string) {
  await renderListDetailPage(path, ['/lists/:id', '/lists/:id/pack'])
  // Anchors on content that only exists past the detail loading gate.
  //
  // The gear item's own name is NOT a safe anchor here: in List (edit)
  // view it renders in the desktop library aside too, which mounts OUTSIDE
  // the detail gate (it needs only the gear query) - so it would let this
  // file's negative assertions (no Add-gear button, no packing kebab, no
  // worn-remove button) pass vacuously before the gated item rows ever
  // render. Branch on mode instead, anchoring on something that is both
  // unconditional in that mode AND strictly inside the loaded branch:
  // the packing-location create form in Pack, the category section's
  // "Add new item" footer in Edit. This list has no food, so no food row can
  // serve as the anchor. The section HEADER is not usable either - the
  // picker aside groups by category too, so "Collapse Uncategorized" matches
  // twice. The footer control exists only on the document side.
  if (path.endsWith('/pack')) {
    await screen.findByLabelText('New packing location')
  } else {
    await screen.findByRole('button', { name: 'Add new item' })
  }
}

const addGear = () => screen.queryByRole('button', { name: 'Add gear' })

// The gear editor is a Modal, which jsdom cannot open without the shim.
beforeAll(shimDialog)

beforeEach(() => {
  h.fetchLists.mockResolvedValue([list])
  h.fetchListItems.mockResolvedValue([listItem])
  h.fetchGearItems.mockResolvedValue([gear])
  h.fetchCategories.mockResolvedValue([] as Category[])
  h.fetchPackingLocations.mockResolvedValue([] as PackingLocation[])
  h.fetchListFood.mockResolvedValue(emptyFood)
  h.deleteListItem.mockResolvedValue(undefined)
  h.quickAddListItem.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  h.collisionDetections.clear()
})

describe('adding gear from Pack view', () => {
  // The band between lg and xl is the one width where Pack has neither the
  // aside (xl and up) nor the mobile action bar's Add (below lg). Remove this
  // button and that band has no path to the picker at all.
  it('offers Add gear between lg and xl, where Pack has no aside', async () => {
    stubViewport(1100)
    await renderDetail(`/lists/${listId}/pack`)
    expect(addGear()).toBeTruthy()
  })

  it('opens the gear library from that button', async () => {
    stubViewport(1100)
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(addGear() as HTMLElement)

    // The drawer is lazy-loaded, so this also proves the chunk resolves.
    expect(await screen.findByText('Add from gear')).toBeTruthy()
  })

  // The bottom action bar already carries Add below lg. A second button would
  // be two controls for one action on the surface with the least room.
  it('omits the button below lg, where the action bar already has Add', async () => {
    stubViewport(500)
    await renderDetail(`/lists/${listId}/pack`)
    expect(addGear()).toBeNull()
  })

  // At xl the picker is on screen permanently, so a button that opens the
  // same panel in a drawer is a second control for a visible surface.
  it('omits the button at xl, where the picker aside is already there', async () => {
    stubViewport(1280)
    await renderDetail(`/lists/${listId}/pack`)
    expect(addGear()).toBeNull()
  })

  // List view keeps the aside, so the library is already on screen.
  it('omits the button in desktop List view, which shows the aside', async () => {
    stubViewport(1280)
    await renderDetail(`/lists/${listId}`)
    expect(addGear()).toBeNull()
  })
})

// Every list starts with no packing locations, so Pack falls back to category
// grouping - which is the state a new user meets this view in. Removal has to
// be there, not only once a bag exists.
describe('removing gear from Pack view', () => {
  it('offers removal on a pack row when the list has no locations yet', async () => {
    stubViewport(1280)
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(
      screen.getByRole('button', { name: 'Open Cooking pot packing options' }),
    )
    await user.click(screen.getByRole('button', { name: 'Remove from list' }))

    expect(h.deleteListItem).toHaveBeenCalledWith(listId, 'li-1')
  })

  // Adjusting a weight mid-pack was one of the jobs that forced a three-view
  // shuffle. Pack now reaches the gear editor, which deliberately overturns
  // the "authoring belongs to the library, not to a packing checklist" rule
  // this menu was written under.
  it('opens the gear editor from an ordinary pack row', async () => {
    stubViewport(1280)
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(
      screen.getByRole('button', { name: 'Open Cooking pot packing options' }),
    )
    await user.click(screen.getByRole('button', { name: 'Edit item' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  // A container's own row lives in the section HEADER, with a separately
  // constructed menu - so it is reachable by neither the row kebab nor the
  // worn button. Without this the bag itself would be the one item you cannot
  // edit from Pack.
  it('opens the gear editor from a container section header', async () => {
    stubViewport(1280)
    h.fetchPackingLocations.mockResolvedValue([{
      id: 'loc-1',
      name: 'Cooking pot',
      sortOrder: 0,
      parentLocationId: null,
      containerListItemId: 'li-1',
    }] as unknown as PackingLocation[])
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(
      await screen.findByRole('button', { name: 'Open Cooking pot packing options' }),
    )
    await user.click(screen.getByRole('button', { name: 'Edit item' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  // Worn rows have no packing kebab at all, so the menu entry above cannot
  // reach them - they need their own control or "you can edit from Pack" is
  // false for a whole section.
  it('opens the gear editor from a worn pack row, which has no kebab', async () => {
    stubViewport(1280)
    h.fetchListItems.mockResolvedValue([listItem, wornItem])
    // The editor resolves the row's gear out of the gear query, so the worn
    // item's gear has to be in the library for the dialog to open at all.
    h.fetchGearItems.mockResolvedValue([gear, wornItem.gearItem])
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(screen.getByRole('button', { name: 'Edit Sun hoody' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  // Worn rows sit outside the packing tree, so they never receive the packing
  // kebab. Without their own affordance the Worn section is the one place in
  // Pack you cannot drop an item from.
  it('offers removal on a worn row, which has no packing kebab', async () => {
    stubViewport(1280)
    h.fetchListItems.mockResolvedValue([listItem, wornItem])
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(
      screen.getByRole('button', { name: 'Remove Sun hoody from list' }),
    )

    expect(h.deleteListItem).toHaveBeenCalledWith(listId, 'li-worn')
  })

  // The category-grouped sections are shared with List view, so the binding
  // that adds the packing kebab is mode-gated.
  //
  // Scope, stated because it is narrower than the title suggests: ItemRow
  // renders rowAction only inside its pack branch, so List view would look
  // like this even if the gate were removed. What this pins is the
  // USER-VISIBLE contract - List rows keep exactly one kebab, and the worn
  // removal button is a pack affordance. The gate itself earns its keep
  // elsewhere (it keeps List view from building menus and placement bindings
  // it will not render), and that is not observable from the DOM.
  it('shows no packing affordances on List view rows', async () => {
    stubViewport(1280)
    h.fetchListItems.mockResolvedValue([listItem, wornItem])
    await renderDetail(`/lists/${listId}`)

    expect(
      screen.queryByRole('button', { name: 'Open Cooking pot packing options' }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Remove Sun hoody from list' }),
    ).toBeNull()
  })
})

// Creating a brand-new item mid-pack was impossible: CategoryGroup gates its
// "+ Add new item" footer on !packMode, so the only path was Gear view ->
// List view picker -> back to Pack to place it. The picker now carries the
// control, in both arrangements.
describe('creating a new item while packing', () => {
  it('creates from Pack with a null category, never a location id', async () => {
    stubViewport(1280)
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(screen.getByRole('button', { name: 'New item' }))
    await user.type(screen.getByLabelText(/^Name/), 'Titanium spork')
    await user.click(screen.getByRole('button', { name: 'Add item' }))

    await waitFor(() => expect(h.quickAddListItem).toHaveBeenCalledWith(
      listId,
      expect.objectContaining({ name: 'Titanium spork', categoryId: null }),
    ))
  })
})

// Pack used to hide the gear picker so packing got the focus. A real trip
// showed that costs more than it buys: adding or reweighing one item meant
// leaving the view. The picker now sits beside Pack too - but at xl, not lg,
// because at 1024px a 320px aside leaves 656px for a row dense enough to
// truncate item names to ~113px rather than overflow.
describe('the gear picker beside Pack', () => {
  const listsPanel = () =>
    screen.queryByRole('button', { name: 'New list or import CSV' })

  // The document column is shaped differently per mode (aside from lg in
  // Gear, from xl in Pack, a centered 3xl cap in Pack). A toolbar inside it
  // moved the view switcher sideways on every switch, so it sits above the
  // columns, at full width, in every mode.
  it.each([
    ['Gear', `/lists/${listId}`],
    ['Pack', `/lists/${listId}/pack`],
  ])('renders the view switcher outside the document column in %s', async (_mode, path) => {
    stubViewport(1280)
    await renderDetail(path)

    const nav = screen.getByRole('navigation', { name: 'List views' })
    expect(screen.getByTestId('list-document-column').contains(nav)).toBe(false)
  })

  it('renders the picker aside in Pack, gated at xl rather than lg', async () => {
    stubViewport(1280)
    await renderDetail(`/lists/${listId}/pack`)

    const aside = screen.getByTestId('list-side-panel')
    expect(aside.className).toContain('xl:flex')
    expect(aside.className).not.toContain('lg:flex')
  })

  it('keeps Gear view on the lg gate it already had', async () => {
    stubViewport(1280)
    await renderDetail(`/lists/${listId}`)

    const aside = screen.getByTestId('list-side-panel')
    expect(aside.className).toContain('lg:flex')
    expect(aside.className).not.toContain('xl:flex')
  })

  // Pack reads at the Food view's measure: the unprefixed max-w-3xl caps the
  // document on screen (the full shell width made pack rows read as a
  // ribbon). Paper lifts the cap and splits the sections into two columns.
  it('constrains the Pack document on screen, and lifts the cap for two print columns', async () => {
    stubViewport(1280)
    await renderDetail(`/lists/${listId}/pack`)

    const column = screen.getByTestId('list-document-column')
    expect(column.className).toMatch(/(^|\s)max-w-3xl(\s|$)/)
    expect(column.className).toContain('print:max-w-none')
  })

  // Nobody switches lists mid-pack, and the switcher's max-h-72 is height the
  // picker wants back.
  it('drops the lists switcher in Pack but keeps it in Gear', async () => {
    stubViewport(1280)
    await renderDetail(`/lists/${listId}/pack`)
    expect(listsPanel()).toBeNull()

    cleanup()
    await renderDetail(`/lists/${listId}`)
    expect(listsPanel()).toBeTruthy()
  })
})

// Retired URL spellings the router still resolves. The page must rewrite the
// address bar, not only render Pack: a page with its own exact-match check
// would render Pack under /lists/<id>/organize/ (trailing slash) and leave the
// retired address in place. The probe reports the navigation type as well as
// the path, so "left alone" is distinguishable from "replaced with itself".
describe('rewriting retired list URLs', () => {
  function LocationProbe() {
    const location = useLocation()
    const navigationType = useNavigationType()
    return (
      <div data-testid="location">
        {location.pathname}{location.search}{location.hash}|{navigationType}
      </div>
    )
  }

  async function renderAtRetiredRoute(path: string) {
    stubViewport(1024)
    await renderListDetailPage(
      path,
      ['/lists/:id', '/lists/:id/pack', '/lists/:id/organize', '/lists/:id/pack/organize'],
      { beside: <LocationProbe /> },
    )
    // Every entry this describe uses derives to Pack, so Pack's loaded anchor
    // is the gate (renderDetail picks its anchor by path suffix and would wait
    // for Category's on a retired URL).
    await screen.findByLabelText('New packing location')
  }

  it.each([
    `/lists/${listId}/organize/`,
    `/lists/${listId}/ORGANIZE`,
    `/lists/${listId}/pack/organize/`,
  ])('replaces %s with the canonical /pack URL', async (path) => {
    await renderAtRetiredRoute(path)
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`/lists/${listId}/pack|REPLACE`),
    )
  })

  it('carries the query and fragment of a retired URL to /pack', async () => {
    await renderAtRetiredRoute(`/lists/${listId}/organize/?keep=1#row-3`)
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        `/lists/${listId}/pack?keep=1#row-3|REPLACE`,
      ),
    )
  })

  it.each([
    `/lists/${listId}/pack`,
    `/lists/${listId}/pack?keep=1#row-3`,
  ])('leaves the canonical %s untouched', async (path) => {
    await renderAtRetiredRoute(path)
    // A rewrite would have flipped the navigation type to REPLACE during the
    // first effect flush, long before the loaded anchor above appeared - and
    // the URL, query and fragment are exactly what was entered.
    expect(screen.getByTestId('location')).toHaveTextContent(`${path}|POP`)
  })
})

describe('pack collision wiring', () => {
  // Location drags may land only on a sibling location: plain closestCenter
  // would let a section drop onto a cousin, which reparents it. Category
  // grouping has one kind of target and keeps plain closestCenter.
  it('selects the packing collision filter for location grouping', async () => {
    // Two root locations, and a third nested in the first through a
    // container item that sits there.
    h.fetchListItems.mockResolvedValue([{ ...listItem, packingLocationId: 'loc-a' }])
    h.fetchPackingLocations.mockResolvedValue([
      { id: 'loc-a', name: 'Pack', sortOrder: 0, containerListItemId: null },
      { id: 'loc-b', name: 'Duffel', sortOrder: 1, containerListItemId: null },
      { id: 'loc-c', name: 'Pot', sortOrder: 0, containerListItemId: 'li-1' },
    ] as PackingLocation[])
    stubViewport(1280)
    await renderDetail(`/lists/${listId}/pack`)

    const filters = [...h.collisionDetections.values()].filter((d) => d !== closestCenter)
    expect(filters).toHaveLength(1)
    const [detect] = filters
    if (!detect) throw new Error('unreachable: length checked above')
    const rect = { top: 0, left: 0, width: 10, height: 10, bottom: 10, right: 10 }
    const target = (id: string) => ({
      id, key: id, data: { current: undefined }, disabled: false,
      node: { current: null }, rect: { current: rect },
    })
    const hits = detect({
      active: { id: 'packing-location:loc-a', data: { current: undefined }, rect: { current: { initial: rect, translated: rect } } },
      collisionRect: rect,
      droppableRects: new Map([['packing-location:loc-b', rect], ['packing-location:loc-c', rect]]),
      droppableContainers: [target('packing-location:loc-b'), target('packing-location:loc-c')],
      pointerCoordinates: null,
    })
    expect(hits.map((hit) => hit.id)).toEqual(['packing-location:loc-b'])

    cleanup()
    await renderDetail(`/lists/${listId}`)
    expect(h.collisionDetections.size).toBeGreaterThan(0)
    expect(new Set(h.collisionDetections.values())).toEqual(new Set([closestCenter]))
  })
})
