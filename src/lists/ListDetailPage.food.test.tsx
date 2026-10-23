// @vitest-environment jsdom
import { makeList } from '../test/fixtures'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import type { Category, GearItem, List, ListItemWithGear, PackingLocation } from '../lib/types'
import type { ListFoodResponse } from '../../shared/food'
import { renderListDetailPage, stubViewport } from './test/list-detail-harness'

// The first page-level test for ListDetailPage. It exists for invariants that
// unit tests structurally cannot reach: WHERE in the page food is mounted,
// and which of List/Pack/Food's query gates a given failure surfaces behind.
//
// Food has been misplaced three times now. It first shipped gated to
// `mode === 'edit'`, which made it unreachable for anyone working in Pack -
// they concluded the feature did not exist. Removing that gate then exposed a
// second fault that had been hiding in List view: the section sat outside the
// detail loading/error branch, so it rendered its controls over a fabricated
// zero-day snapshot while the real food was still in flight, and a day change
// typed into that snapshot writes against real rows. Food then got its own
// route (/lists/:id/food, see FoodView) - the third fault this file guards
// against is the route sharing ListDetailPage's detail-data gate: a
// gear/categories/items failure has nothing to do with food and must not
// block it, while a food failure must surface FoodView's OWN retry rather
// than the page's generic "Couldn't load list details".
//
// None of these faults are visible from FoodView's own component-level unit
// tests - each component is correct in isolation. Only mounting the page
// catches where it is wired.

const listId = 'list-1'

const list: List = makeList({
  id: listId,
  name: 'Sierra High Route',
  isShared: false,
  updatedAt: '2026-07-01T00:00:00.000Z',
})

const food: ListFoodResponse = {
  dayCount: 3,
  slots: [{ id: 'slot-1', dayNumber: 1, meal: 'breakfast' }],
  // At least one item, because the Category arrangement renders a Food
  // SECTION and a section with no rows is noise - so an empty food fixture
  // would prove nothing about where food is mounted.
  items: [
    {
      id: 'food-1',
      name: 'Oatmeal',
      weightGrams: 90,
      quantity: 3, isPerMeal: false, unitCount: 3,
      sortOrder: 0,
      isPacked: false,
      isReady: false,
      packingLocationId: null,
      packSortOrder: 0,
      slotIds: ['slot-1'],
    },
  ],
} satisfies ListFoodResponse

const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
}))

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
  await renderListDetailPage(path, ['/lists/:id', '/lists/:id/pack', '/lists/:id/food'])
}

// FoodView's planning header carries no "Food" heading since the 2026-10
// redesign (the toolbar's Food tab already names the view), so its
// trip-length control is the marker that the editor rendered.
const foodEditorControl = () => screen.queryByLabelText('Trip length in days')
// The Category arrangement's Food section, identified by its COLLAPSE
// control rather than by a link named "Food": the ListViewNav Food tab (part
// of ListDocumentToolbar, rendered in every mode and OUTSIDE the detail-data
// gate) is also a link to /lists/:id/food, so a link query would be ambiguous
// between the two - and worse, would resolve before the gate opens and let a
// negative assertion pass vacuously. The chevron exists only on the section.
const foodSection = () => screen.queryByRole('button', { name: 'Collapse Food' })
const foodRow = () => screen.queryByText('Oatmeal')

beforeEach(() => {
  stubViewport(1280)
  h.fetchLists.mockResolvedValue([list] as List[])
  h.fetchListItems.mockResolvedValue([] as ListItemWithGear[])
  h.fetchGearItems.mockResolvedValue([] as GearItem[])
  h.fetchCategories.mockResolvedValue([] as Category[])
  h.fetchPackingLocations.mockResolvedValue([] as PackingLocation[])
  h.fetchListFood.mockResolvedValue(food)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('food is reachable at its own route, and traced from List view', () => {
  it('renders the food editor at /lists/<id>/food', async () => {
    await renderDetail(`/lists/${listId}/food`)
    expect(await screen.findByLabelText('Trip length in days')).toBeTruthy()
    expect(await screen.findByRole('button', { name: '+ Add food' })).toBeTruthy()
  })

  // Food used to appear here as a single summary line - one number and a
  // link - while Pack showed the items. Category shows the items now too.
  it('shows food as read-only rows, with no Edit link in the section header', async () => {
    await renderDetail(`/lists/${listId}`)
    const chevron = await screen.findByRole('button', { name: 'Collapse Food' })
    expect(foodRow()).toBeTruthy()
    // No "Edit" in the header: this table is a read-out, and the Food tab in
    // ListViewNav is the one route to authoring. A header link here was a
    // second affordance for the same route, and it was the only control the
    // other section headers do not carry. Scoped to the card so the nav tab
    // (same destination) cannot satisfy the query.
    const card = chevron.closest('.overflow-hidden')!
    expect(within(card as HTMLElement).queryByRole('link', { name: 'Edit food' })).toBeNull()
  })

  it('does not render the food editor inline on the list view', async () => {
    await renderDetail(`/lists/${listId}`)
    // Something the list view always shows once loaded, so the wait settles
    // past the detail-data gate before the negative assertion below.
    await screen.findByRole('button', { name: 'Collapse Food' })
    expect(foodEditorControl()).toBeNull()
  })

  // Pack shows food too, but as part of each bag's union cohort - so the
  // CATEGORY section must not also render there, or every food row would
  // appear twice. Neither does the editor: the Food tab in ListViewNav is
  // Pack's route to authoring food.
  it('renders neither the food editor nor the Category food section in Pack view', async () => {
    await renderDetail(`/lists/${listId}/pack`)
    // ListViewNav (and its "List views" nav landmark) lives in
    // ListDocumentToolbar, ABOVE the mode ternary and outside the
    // detail-data gate - it resolves as soon as the lists query settles, so
    // it would let the negative assertions below pass vacuously, before the
    // loaded branch has even rendered. The packing-location create form is
    // unconditional in Pack mode but sits INSIDE the loaded branch
    // (ListDetailPage.tsx), so waiting on it actually proves the gate opened.
    await screen.findByLabelText('New packing location')
    expect(foodEditorControl()).toBeNull()
    expect(foodSection()).toBeNull()
    // Exactly once, not zero: Pack renders the row through the union cohort.
    // Asserting only the section's absence would stay green if the row had
    // vanished from Pack entirely.
    expect(screen.getAllByText('Oatmeal')).toHaveLength(1)
  })
})

describe('the Food route owns its own query gates, separate from the detail-data composite', () => {
  // A pending food query must not fall through to the empty-food fallback
  // with live controls: the day input would read 0 for a 3-day trip, and
  // committing that value deletes every slot on the list. FoodView's own
  // pending gate is what prevents that now that food has its own route.
  it('shows FoodView\'s own loading state, not the page\'s generic detail loader', async () => {
    let release: (value: ListFoodResponse) => void = () => {}
    h.fetchListFood.mockReturnValue(
      new Promise<ListFoodResponse>((resolve) => {
        release = resolve
      }),
    )

    await renderDetail(`/lists/${listId}/food`)
    expect(await screen.findByText('Loading food…')).toBeTruthy()
    expect(screen.queryByText('Loading list details...')).toBeNull()
    expect(screen.queryByLabelText('Trip length in days')).not.toBeInTheDocument()

    release(food)
    expect(await screen.findByLabelText('Trip length in days')).toBeTruthy()
  })

  // INVERTED from the pre-Task-5 behavior: a gear/categories/items failure
  // has nothing to do with food, and food is reachable from the same trip
  // whether or not gear ever loaded. Before FoodView had its own route this
  // sibling failure blocked food outright (it shared the composite gate) -
  // that coupling is exactly what this test now forbids.
  it('food editor stays reachable when a sibling detail query fails', async () => {
    h.fetchListItems.mockRejectedValue(new Error('offline'))

    await renderDetail(`/lists/${listId}/food`)
    expect(await screen.findByLabelText('Trip length in days')).toBeTruthy()
    expect(screen.queryByText("Couldn't load list details")).toBeNull()
  })

  // The List view keeps the OLD behavior: the Food section sits inside the
  // composite gate along with everything else the page renders, so a sibling
  // failure withholds it too. Not because food depends on gear - it does not
  // - but because the page has one document, and half a document under a
  // "couldn't load" banner is worse than none.
  it('on the List view, the food section stays behind the composite detail-data gate', async () => {
    h.fetchListItems.mockRejectedValue(new Error('offline'))

    await renderDetail(`/lists/${listId}`)
    expect(await screen.findByText("Couldn't load list details")).toBeTruthy()
    expect(foodSection()).toBeNull()
    expect(foodRow()).toBeNull()
  })

  // A food-query failure is now FoodView's own retry state, not the page's
  // generic detail error - the two used to be the same message because food
  // shared the composite gate; now they diverge on purpose so a food-only
  // outage doesn't imply a gear/categories/items outage.
  it('shows FoodView\'s own retry state when the food query itself fails', async () => {
    h.fetchListFood.mockRejectedValue(new Error('offline'))

    await renderDetail(`/lists/${listId}/food`)
    expect(await screen.findByText("Couldn't load the food plan.")).toBeTruthy()
    expect(screen.queryByText("Couldn't load list details")).toBeNull()
    expect(screen.queryByLabelText('Trip length in days')).not.toBeInTheDocument()
  })
})
