// @vitest-environment jsdom
import { makeGearItem, makeListItem } from '../test/fixtures'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Category, GearItem, ListItemWithGear, PackingLocation } from '../lib/types'
import {
  emptyFood,
  list,
  listId,
  renderListDetailPage,
  stubViewport,
} from './test/list-detail-harness'

// What a category footer SHOWS, rendered through the real page. A section
// must not compute its own subtotal (src/lib/weight-breakdown.ts explains
// why: a summed section puts consumables and worn gear in "base"), so the
// page hands every section - categorized and Uncategorized alike - the
// canonical base and consumable figures. This renders the page and reads the
// footers: the consumable and worn rows are the discriminators against a
// section summing its own rows.

const categories = [
  { id: 'cat-a', name: 'Shelter', sortOrder: 0, createdAt: '2026-07-01' },
  { id: 'cat-b', name: 'Cook', sortOrder: 1, createdAt: '2026-07-01' },
] satisfies Category[]

function gear(id: string, name: string, weightGrams: number, categoryId: string | null): GearItem {
  return makeGearItem({ id, name, weightGrams, categoryId })
}

function row(
  id: string,
  g: GearItem,
  sortOrder: number,
  flags: { isWorn?: boolean; isConsumable?: boolean } = {},
): ListItemWithGear {
  return makeListItem({
    id,
    gearItemId: g.id,
    gearItem: g,
    quantity: 1,
    isWorn: flags.isWorn ?? false,
    isConsumable: flags.isConsumable ?? false,
    isPacked: false,
    isReady: false,
    packingLocationId: null,
    sortOrder,
    packSortOrder: sortOrder,
  })
}

// Shelter: 210 g base, 50 g consumable, 400 g worn. Summing the section's own
// rows would give 660 g; base excluding consumable but including worn would
// give 610 g; base + consumable would give 260 g. Only 210 / 50 is canonical.
// Cook: a single 100 g base row, whose row weight equals its subtotal - so the
// assertions read the FOOTER, not any text on the page.
// Uncategorized: 30 g base and 20 g consumable, through the null-category
// lookups.
const tent = gear('g-tent', 'Tent', 210, 'cat-a')
const fuel = gear('g-fuel', 'Fuel', 50, 'cat-a')
const jacket = gear('g-jacket', 'Jacket', 400, 'cat-a')
const pot = gear('g-pot', 'Pot', 100, 'cat-b')
const spoon = gear('g-spoon', 'Spoon', 30, null)
const bars = gear('g-bars', 'Bars', 20, null)
const gearItems = [tent, fuel, jacket, pot, spoon, bars]
const listItems = [
  row('li-1', tent, 0),
  row('li-2', fuel, 1, { isConsumable: true }),
  row('li-3', jacket, 2, { isWorn: true }),
  row('li-4', pot, 3),
  row('li-5', spoon, 4),
  row('li-6', bars, 5, { isConsumable: true }),
]

const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
}))

// The session atom must not mount in jsdom (test/list-detail-harness.tsx
// explains why). dnd-kit cannot be driven here; the contexts are
// pass-throughs because nothing is dragged.
vi.mock('../lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'owner-1' } }, isPending: false }) },
}))

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, ...h }
})

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core')
  return {
    ...actual,
    DndContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

beforeEach(() => {
  stubViewport(1280)
  h.fetchLists.mockResolvedValue([list])
  h.fetchListItems.mockResolvedValue(listItems)
  h.fetchGearItems.mockResolvedValue(gearItems)
  h.fetchCategories.mockResolvedValue(categories)
  h.fetchPackingLocations.mockResolvedValue([] as PackingLocation[])
  h.fetchListFood.mockResolvedValue(emptyFood)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

// The footer renders twice (a desktop and a mobile copy; jsdom applies no
// responsive CSS), so read the whole region's text once and match on it.
function regionText(sectionKey: string): string {
  const region = document.getElementById(`cat-region-${sectionKey}`)
  if (!region) throw new Error(`no rendered region for ${sectionKey}`)
  return region.textContent ?? ''
}

describe('category footers show the canonical per-section figures', () => {
  it('base excludes consumable and worn rows; consumable is its own figure', async () => {
    await renderListDetailPage(`/lists/${listId}`, ['/lists/:id'])
    // Past the detail loading gate: a category section has rendered.
    await screen.findAllByText('Shelter')

    const shelter = regionText('cat-a')
    expect(shelter).toMatch(/Base\s*210 g/)
    expect(shelter).toMatch(/Consumable\s*50 g/)
    for (const wrong of ['660 g', '610 g', '260 g']) {
      expect(shelter).not.toContain(wrong)
    }

    const cook = regionText('cat-b')
    expect(cook).toMatch(/Base\s*100 g/)
    expect(cook).not.toMatch(/Consumable/)

    const uncategorized = regionText('uncategorized')
    expect(uncategorized).toMatch(/Base\s*30 g/)
    expect(uncategorized).toMatch(/Consumable\s*20 g/)
  })
})
