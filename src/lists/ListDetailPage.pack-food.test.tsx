// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Category, GearItem, ListItemWithGear, PackingLocation } from '../lib/types'
import type { FoodItemResponse, ListFoodResponse } from '../../shared/food'
import { PACK_ROW_WEIGHT_CELL } from '../components/flat-table-styles'
import { list, listId, renderListDetailPage, stubViewport } from './test/list-detail-harness'

// Food as a full peer of gear in Pack mode. What these tests pin:
// food rows render as checkable pack rows, the checkbox PATCHes the food
// item, the progress header counts the union, and none of it leaks into the
// List (edit) view - food's editing surface stays the Food view.

const gear = {
  id: 'gear-1',
  name: 'Cooking pot',
  weightGrams: 210,
  categoryId: null,
} as unknown as GearItem

const listItem = {
  id: 'li-1',
  gearItemId: 'gear-1',
  gearItem: gear,
  quantity: 1, isPerMeal: false, unitCount: 1,
  isWorn: false,
  isConsumable: false,
  isPacked: true,
  isReady: false,
  packingLocationId: null,
  sortOrder: 0,
  packSortOrder: 0,
} as unknown as ListItemWithGear

const tortillas: FoodItemResponse = {
  id: 'food-1',
  name: 'Tortillas',
  weightGrams: 300,
  quantity: 2, isPerMeal: false, unitCount: 2,
  sortOrder: 0,
  isPacked: false,
  isReady: false,
  packingLocationId: null,
  packSortOrder: 0,
  slotIds: [],
}

const foodWithTortillas: ListFoodResponse = {
  dayCount: 2,
  slots: [],
  items: [tortillas],
}

const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
  updateFoodItem: vi.fn(),
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

// The page imports the food PATCH from its own module rather than the
// queries barrel, so it needs its own mock edge.
vi.mock('../lib/queries/food', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries/food')>()
  return { ...actual, updateFoodItem: h.updateFoodItem }
})

async function renderDetail(path: string) {
  await renderListDetailPage(path, ['/lists/:id', '/lists/:id/pack'])
  // Same anchors as ListDetailPage.pack.test.tsx: strictly inside the loaded
  // branch of each mode.
  if (path.endsWith('/pack')) {
    await screen.findByLabelText('New packing location')
  } else {
    await screen.findByRole('button', { name: 'Collapse Food' })
  }
}

beforeEach(() => {
  stubViewport(1280)
  h.fetchLists.mockResolvedValue([list])
  h.fetchListItems.mockResolvedValue([listItem])
  h.fetchGearItems.mockResolvedValue([gear])
  h.fetchCategories.mockResolvedValue([] as Category[])
  h.fetchPackingLocations.mockResolvedValue([] as PackingLocation[])
  h.fetchListFood.mockResolvedValue(foodWithTortillas)
  h.updateFoodItem.mockResolvedValue({ ...tortillas, isPacked: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('food rows in Pack mode', () => {
  it('renders the food row in the fallback Food section with a packed checkbox', async () => {
    await renderDetail(`/lists/${listId}/pack`)

    const row = (await screen.findByText('Tortillas')).closest('div[class*="flex"]')
    expect(row).not.toBeNull()
    // The wrapping label makes the food name the checkbox's accessible name.
    expect(screen.getByRole('checkbox', { name: 'Tortillas' })).not.toBeChecked()
    // Ready checkbox parity with gear rows.
    expect(screen.getByRole('checkbox', { name: 'Mark Tortillas ready' })).not.toBeChecked()
  })

  it('ticking the checkbox PATCHes the food item packed', async () => {
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(await screen.findByRole('checkbox', { name: 'Tortillas' }))
    await waitFor(() => expect(h.updateFoodItem).toHaveBeenCalledWith(
      listId,
      'food-1',
      { isPacked: true },
    ))
  })

  // A bag is one cohort of gear and food rows. A weight cell on one and not
  // the other pushes every column to its right out of alignment in a mixed
  // section, so the two rows carry the identical cell.
  it('gives food rows the same weight cell as the gear rows beside them', async () => {
    await renderDetail(`/lists/${listId}/pack`)

    // The gear cell is a button (its weight is editable in place) and the
    // food cell is a span (food weight is authored in the Food view), so
    // their affordance styling differs. The column geometry is the shared
    // token. The gear weight also shows in the picker aside, so look for the
    // token among every cell that shows the weight.
    const cellClasses = (label: string) =>
      screen.getAllByLabelText(label).map((el) => el.parentElement?.className ?? '')

    await screen.findByLabelText('300 g')
    expect(cellClasses('300 g')).toContainEqual(expect.stringContaining(PACK_ROW_WEIGHT_CELL))
    expect(cellClasses('210 g')).toContainEqual(expect.stringContaining(PACK_ROW_WEIGHT_CELL))
  })

  // Gear rows reach the gear editor from this menu. Food does not: food is
  // authored in the Food view, which is the same reason food rows carry no
  // "Remove from list" either.
  it('offers no Edit item on a food row', async () => {
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(
      await screen.findByRole('button', { name: 'Open Tortillas packing options' }),
    )

    expect(screen.queryByRole('button', { name: 'Edit item' })).toBeNull()
  })

  it('counts food in the packing progress header', async () => {
    await renderDetail(`/lists/${listId}/pack`)

    // One packed gear item + one unpacked food item = 1 / 2.
    expect(screen.getByText('1 / 2 packed')).toBeInTheDocument()
  })

  // Category shows the same food items, but as READ rows: no packed
  // checkbox, no ready checkbox, no drag handle. The row is the same fact;
  // the arrangement decides what you can do to it, and packing state belongs
  // to Pack.
  it('renders food in the List (edit) view as plain rows, not checklist rows', async () => {
    await renderDetail(`/lists/${listId}`)

    expect(screen.getByText('Tortillas')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Tortillas' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Reorder or move Tortillas' }),
    ).not.toBeInTheDocument()
  })
})
