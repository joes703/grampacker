// @vitest-environment jsdom
import { makeGearItem, makeListItem } from '../test/fixtures'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Category, PackingLocation } from '../lib/types'
import {
  emptyFood,
  list,
  listId,
  renderListDetailPage,
  shimDialog,
  stubViewport,
} from './test/list-detail-harness'

// Printing a pack list.
//
// The assertion that earns this file is the FILTER one. Pack's row filters
// drop items from the rendered array rather than hiding them with CSS, so a
// sheet printed with a filter on is silently short of gear - and because the
// filter switches themselves do not print, the paper carries no clue that
// anything is missing. No print stylesheet can fix that; it has to be fixed
// in what gets rendered, which means it has to be tested here rather than
// asserted as a class name.
//
// The class-name assertions below are deliberately thin. They pin the few
// places where print behavior is decided in a component rather than in the
// shared tokens, so a later edit cannot quietly drop them. What none of this
// can prove is that the sheet LOOKS right - jsdom paginates nothing. That
// check is a human in a print preview.

const gear = makeGearItem({
  id: 'gear-1',
  name: 'Cooking pot',
  weightGrams: 210,
  categoryId: null,
})

const unpackedItem = makeListItem({
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

// The row a filtered print would lose.
const packedItem = makeListItem({
  ...unpackedItem,
  id: 'li-2',
  gearItemId: 'gear-2',
  gearItem: { ...gear, id: 'gear-2', name: 'Titanium spork' },
  isPacked: true,
  sortOrder: 1,
})

const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
}))

// Keeps better-auth's nanostores session atom from outliving this file's
// jsdom environment (test/list-detail-harness.tsx explains why).
vi.mock('../lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'owner-1' } }, isPending: false }) },
}))

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, ...h }
})

async function renderPack() {
  await renderListDetailPage(`/lists/${listId}/pack`, ['/lists/:id/pack'])
  await screen.findByLabelText('New packing location')
}

// What the browser does immediately before it snapshots the page. The hook
// under test listens for exactly this.
function firePrint() {
  act(() => {
    window.dispatchEvent(new Event('beforeprint'))
  })
}

function fireAfterPrint() {
  act(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
}

beforeAll(shimDialog)

beforeEach(() => {
  h.fetchLists.mockResolvedValue([list])
  h.fetchListItems.mockResolvedValue([unpackedItem, packedItem])
  h.fetchGearItems.mockResolvedValue([gear])
  h.fetchCategories.mockResolvedValue([] as Category[])
  h.fetchPackingLocations.mockResolvedValue([] as PackingLocation[])
  h.fetchListFood.mockResolvedValue(emptyFood)
  stubViewport(1400)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('printing renders the full list regardless of the pack filters', () => {
  it('restores rows a filter removed, for the duration of the print', async () => {
    const user = userEvent.setup()
    await renderPack()

    // Baseline: both rows on screen.
    expect(screen.queryByText('Titanium spork')).toBeTruthy()

    await user.click(screen.getByLabelText('Show unpacked only'))
    // The packed row is GONE from the DOM, not merely hidden - which is the
    // whole reason print CSS cannot rescue it.
    expect(screen.queryByText('Titanium spork')).toBeNull()

    firePrint()
    expect(screen.queryByText('Titanium spork')).toBeTruthy()
  })

  it('puts the filter back after printing, so the screen is unchanged', async () => {
    const user = userEvent.setup()
    await renderPack()

    await user.click(screen.getByLabelText('Show unpacked only'))
    firePrint()
    fireAfterPrint()

    expect(screen.queryByText('Titanium spork')).toBeNull()
    // The switch still reads as on: printing overrides what is RENDERED, it
    // does not silently reset the user's setting.
    expect(screen.getByLabelText('Show unpacked only')).toBeChecked()
  })

  it('does the same for the ready filter', async () => {
    const user = userEvent.setup()
    h.fetchListItems.mockResolvedValue([
      unpackedItem,
      makeListItem({ ...packedItem, isPacked: false, isReady: true }),
    ])
    await renderPack()

    await user.click(screen.getByLabelText('Show un-ready only'))
    expect(screen.queryByText('Titanium spork')).toBeNull()

    firePrint()
    expect(screen.queryByText('Titanium spork')).toBeTruthy()
  })
})

describe('printing renders collapsed sections too', () => {
  // Same class of defect as the filters: a collapsed section removes its body
  // from the DOM, so print CSS cannot recover it. Worse in pack, which renders
  // no collapse control - a section collapsed in List view and carried into
  // Pack cannot be reopened, and the sheet is short of gear with nothing on
  // the paper to say why.
  it('restores a section collapsed in List view', async () => {
    const user = userEvent.setup()
    await renderListDetailPage(`/lists/${listId}`, ['/lists/:id'])
    await screen.findByRole('button', { name: 'Add new item' })

    // Scoped to the document column: the desktop gear picker aside groups by
    // category too, so an unscoped "Collapse ..." matches twice.
    const doc = () => within(screen.getByTestId('list-document-column'))
    await user.click(doc().getByRole('button', { name: /^Collapse / }))
    // Body gone from the DOM, not hidden.
    expect(doc().queryByText('Titanium spork')).toBeNull()

    firePrint()
    expect(doc().queryByText('Titanium spork')).toBeTruthy()
  })

  it('leaves the section collapsed again afterwards', async () => {
    const user = userEvent.setup()
    await renderListDetailPage(`/lists/${listId}`, ['/lists/:id'])
    await screen.findByRole('button', { name: 'Add new item' })

    const doc = () => within(screen.getByTestId('list-document-column'))
    await user.click(doc().getByRole('button', { name: /^Collapse / }))
    firePrint()
    fireAfterPrint()

    // The override is on the derived value, so the stored collapse survives.
    expect(doc().queryByText('Titanium spork')).toBeNull()
  })
})

describe('the printed sheet identifies itself', () => {
  it('carries the list name, which no screen chrome provides on paper', async () => {
    await renderPack()

    // Scoped to the print header by testid on purpose: the screen toolbar
    // renders the list name in an h1 too, and that one is print:hidden. A
    // page-wide query would match it and pass even if this header vanished.
    const header = screen.getByTestId('print-list-header')
    expect(header.className).toContain('print:block')
    expect(header.textContent).toContain('Sierra High Route')
  })

  it('names the two checkbox squares once, in row order, since blank squares are identical', async () => {
    await renderPack()
    const header = screen.getByTestId('print-list-header')
    expect(within(header).getByText('Ready')).toBeTruthy()
    expect(within(header).getByText('Packed')).toBeTruthy()
    // The legend reads in the same order as the squares in every row.
    expect(header.textContent?.indexOf('Ready')).toBeLessThan(header.textContent?.indexOf('Packed') ?? -1)
  })

  it('dates the sheet in ISO format with the time', async () => {
    await renderPack()
    const header = screen.getByTestId('print-list-header')
    expect(header.textContent).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
  })

  it('prints no item count: a checklist is read by its rows, not a total', async () => {
    await renderPack()
    const header = screen.getByTestId('print-list-header')
    expect(header.textContent).not.toMatch(/\bitems?\b/)
  })

  it('lays the sections out in two columns on paper, so a long list fits fewer sheets', async () => {
    await renderPack()
    const sections = screen.getByTestId('pack-print-columns')
    expect(sections.className).toContain('print:columns-2')
    // The column is the full printable width; a cap would squeeze both columns.
    expect(screen.getByTestId('list-document-column').className).not.toContain('print:max-w-xl')
  })
})

describe('printed checkboxes reflect what is already marked', () => {
  // The print squares mirror the on-screen state: a sheet printed mid-pack
  // shows what is already in the bag instead of pretending nothing is. A
  // fresh list still prints blank because nothing is checked yet. The check
  // glyph is an inline stroke SVG, so it prints without background colors.
  function squareStates(variant: 'ready' | 'packed'): boolean[] {
    return screen
      .getAllByTestId(`print-square-${variant}`)
      .map((el) => el.querySelector('svg') !== null)
  }

  it('fills exactly the squares that are checked, for gear and food rows', async () => {
    h.fetchListItems.mockResolvedValue([
      makeListItem({ ...unpackedItem, isReady: true }),
      packedItem,
    ])
    h.fetchListFood.mockResolvedValue({
      ...emptyFood,
      items: [{ id: 'food-1', name: 'Tortillas', weightGrams: 300, quantity: 1, isPerMeal: false, unitCount: 1, sortOrder: 0, isPacked: true, isReady: true, packingLocationId: null, packSortOrder: 0, slotIds: [] }],
    })
    await renderPack()

    // Rows render gear sections first (ready-only pot, packed-only spork),
    // then the food fallback section (tortillas, both checked).
    expect(squareStates('ready')).toEqual([true, false, true])
    expect(squareStates('packed')).toEqual([false, true, true])
  })

  it('fills a container header square too', async () => {
    const bagGear = makeGearItem({ id: 'gear-bag', name: 'Big bag', weightGrams: 900, categoryId: null })
    const bagItem = makeListItem({
      ...unpackedItem,
      id: 'li-bag',
      gearItemId: 'gear-bag',
      gearItem: bagGear,
      isPacked: true,
      sortOrder: 2,
    })
    h.fetchListItems.mockResolvedValue([unpackedItem, bagItem])
    h.fetchPackingLocations.mockResolvedValue([
      { id: 'loc-1', name: 'Big bag', sortOrder: 0, containerListItemId: 'li-bag' },
    ] as PackingLocation[])
    await renderPack()
    await screen.findAllByText('Big bag')

    // One header pair (the container, packed but not ready) plus one row pair
    // (the unassigned pot, neither).
    expect(squareStates('packed')).toContain(true)
    expect(squareStates('ready')).not.toContain(true)
  })
})

describe('print affordance', () => {
  it('offers Print in pack mode', async () => {
    await renderPack()
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy()
  })
})
