// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ListItemWithGear } from '../lib/types'
import { makeGearItem, makeListItem } from '../test/fixtures'
import CategoryTable from './CategoryTable'

afterEach(() => {
  cleanup()
})

// Every row weighs 100 g.
function itemNamed(id: string, name: string): ListItemWithGear {
  return makeListItem({ id, gearItem: makeGearItem({ id: `gear-${id}`, name, weightGrams: 100 }) })
}

describe('CategoryTable region id', () => {
  // The Food section renders beside the real Uncategorized section and has no
  // categoryId. Without its regionKey both would derive
  // id="cat-region-uncategorized", and both chevrons would point
  // aria-controls at whichever element won.
  it('gives a categoryId-less section a distinct region id from Uncategorized', () => {
    render(
      <>
        <CategoryTable
          name="Uncategorized"
          categoryId={null}
          items={[itemNamed('item-1', 'Stove')]}
          weightUnit="g"
          isBelowLg={false}
        />
        <CategoryTable
          name="Food"
          regionKey="food"
          items={[]}
          foodRows={[{ id: 'f1', name: 'Oatmeal', unitCount: 1, weightGrams: 90 }]}
          weightUnit="g"
          isBelowLg={false}
        />
      </>,
    )

    const targets = screen
      .getAllByRole('button', { name: /Collapse|Expand/ })
      .map((button) => button.getAttribute('aria-controls'))

    expect(targets).toHaveLength(2)
    expect(new Set(targets).size).toBe(2)
    for (const id of targets) {
      expect(id).not.toBeNull()
      expect(document.querySelectorAll(`#${id}`)).toHaveLength(1)
    }
  })

  // The share view passes collapsible={false} and no categoryId for every
  // section, so every section would derive the same id. Nothing references
  // those ids there, since no chevron renders, so they are emitted only with
  // the chevron.
  it('emits no region id when the section is not collapsible', () => {
    const { container } = render(
      <>
        <CategoryTable
          name="Uncategorized"
          items={[itemNamed('item-1', 'Stove')]}
          weightUnit="g"
          isBelowLg={false}
          collapsible={false}
        />
        <CategoryTable
          name="Clothing"
          items={[itemNamed('item-2', 'Sun hat')]}
          weightUnit="g"
          isBelowLg={false}
          collapsible={false}
        />
      </>,
    )

    expect(container.querySelectorAll('[id^="cat-region-"]')).toHaveLength(0)
  })
})

describe('CategoryTable worn rows', () => {
  // Outside Pack, worn is a weight flag rather than an organizing principle,
  // so the row stays in its category (section-rows.ts owns the rule).
  it('keeps worn rows inside their category', () => {
    render(
      <CategoryTable
        name="Clothing"
        items={[itemNamed('shell', 'Wind shell'), { ...itemNamed('jacket', 'Rain jacket'), isWorn: true }]}
        weightUnit="g"
        isBelowLg={false}
      />,
    )
    expect(screen.getByText('Wind shell')).toBeInTheDocument()
    expect(screen.getByText('Rain jacket')).toBeInTheDocument()
  })
})

// The per-section footer subtotal. Summed from the section's own rows, it
// would count consumables and worn items, so the subtotals would not reconcile
// with the summary panel's Base weight. So the parent, which holds the
// canonical computeListWeightBreakdown result, passes it down. These tests pin
// that the section RENDERS what it is handed and never re-derives it.
describe('CategoryTable footer subtotal', () => {
  function consumable(id: string, name: string): ListItemWithGear {
    return { ...itemNamed(id, name), isConsumable: true }
  }

  // Every fixture row weighs 100 g, so the subtotals asserted below are
  // values NO row can produce. An assertion satisfiable by row text would
  // still pass if the footer went back to summing rows.
  it('renders supplied Base and Consumable totals, not the sum of its own rows', () => {
    render(
      <CategoryTable
        name="Shelter"
        categoryId="cat-1"
        items={[itemNamed('a', 'Tarp'), consumable('b', 'Gas')]}
        weightUnit="g"
        isBelowLg={false}
        baseSubtotalGrams={777.4}
        consumableSubtotalGrams={333.6}
      />,
    )
    expect(screen.getAllByLabelText('777 g').length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('334 g').length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('777.4 g')).toBeNull()
    expect(screen.queryByLabelText('333.6 g')).toBeNull()
    // 200 g is what summing the two rows would produce.
    expect(screen.queryByLabelText('200 g')).toBeNull()
  })

  it('labels both kinds of category weight', () => {
    render(
      <CategoryTable
        name="Shelter"
        categoryId="cat-1"
        items={[itemNamed('a', 'Tarp')]}
        weightUnit="g"
        isBelowLg={false}
        baseSubtotalGrams={777}
        consumableSubtotalGrams={333}
      />,
    )
    expect(screen.getAllByText(/Base/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Consumable/).length).toBeGreaterThan(0)
  })

  it('keeps full gram precision when converting category footers to ounces', () => {
    render(
      <CategoryTable
        name="Shelter"
        categoryId="cat-1"
        items={[itemNamed('a', 'Tarp')]}
        weightUnit="oz"
        isBelowLg={false}
        baseSubtotalGrams={4.3}
      />,
    )
    // 4.3 g displays as 0.2 oz. Rounding the source to 4 g first would show
    // 0.1 oz, so this pins the rounding to gram presentation only.
    expect(screen.getAllByLabelText('0.2 oz')).toHaveLength(2)
    expect(screen.queryByLabelText('0.1 oz')).toBeNull()
  })

  it('omits Base when the category is consumable-only', () => {
    render(
      <CategoryTable
        name="Food"
        categoryId="cat-food"
        items={[consumable('b', 'Gas')]}
        weightUnit="g"
        isBelowLg={false}
        baseSubtotalGrams={0}
        consumableSubtotalGrams={100}
      />,
    )
    expect(screen.queryByText(/Base/)).toBeNull()
    expect(screen.getAllByText(/Consumable/).length).toBeGreaterThan(0)
  })

  it('omits Consumable when the category is base-only', () => {
    render(
      <CategoryTable
        name="Shelter"
        categoryId="cat-1"
        items={[itemNamed('a', 'Tarp')]}
        weightUnit="g"
        isBelowLg={false}
        baseSubtotalGrams={100}
        consumableSubtotalGrams={0}
      />,
    )
    expect(screen.getAllByText(/Base/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Consumable/)).toBeNull()
  })

  it('renders a labeled Worn bucket beside Base, rounded, leftmost', () => {
    // Worn rows render inside their category, so the footer must say where
    // their weight went: a visible row whose weight counts nowhere is the
    // trust bug the labels exist to prevent.
    const worn = { ...itemNamed('a', 'Jacket'), isWorn: true }
    render(
      <CategoryTable
        name="Clothing"
        categoryId="cat-1"
        items={[worn, itemNamed('b', 'Shell')]}
        weightUnit="g"
        isBelowLg={false}
        baseSubtotalGrams={100}
        wornSubtotalGrams={777.4}
      />,
    )
    const footer = document.querySelector<HTMLElement>('.print\\:flex')
    expect(footer).not.toBeNull()
    expect(within(footer!).getAllByText('Worn')).toHaveLength(2)
    expect(within(footer!).getAllByLabelText('777 g')).toHaveLength(2)
    expect(screen.queryByLabelText('777.4 g')).toBeNull()
    // Worn sits left of Base so Base stays rightmost down the page.
    expect(footer!.textContent!.indexOf('Worn')).toBeLessThan(footer!.textContent!.indexOf('Base'))
  })

  it('omits Worn when the category has no worn weight', () => {
    render(
      <CategoryTable
        name="Shelter"
        categoryId="cat-1"
        items={[itemNamed('a', 'Tarp')]}
        weightUnit="g"
        isBelowLg={false}
        baseSubtotalGrams={100}
        wornSubtotalGrams={0}
      />,
    )
    const footer = document.querySelector<HTMLElement>('.print\\:flex')
    expect(within(footer!).queryByText('Worn')).toBeNull()
  })

  it('renders no subtotal when the parent supplies none', () => {
    render(
      <CategoryTable
        name="Shelter"
        categoryId="cat-1"
        items={[itemNamed('a', 'Tarp')]}
        weightUnit="g"
        isBelowLg={false}
      />,
    )
    expect(screen.queryByText(/Base/)).toBeNull()
    // The footer ROW still renders; what must be absent is any weight in it.
    // The rows show their own 100 g, so scope the assertion to the footer.
    const footer = document.querySelector('.print\\:flex')
    expect(footer).not.toBeNull()
    expect(footer!.textContent).not.toMatch(/\d+(\.\d+)?\s*g/)
  })

  // The plain "(N)" category count is gone: the rows are right there to be
  // counted. Pack's completion mark is a different metric and stays (see
  // PackSection.test.tsx).
  it('renders no membership count', () => {
    render(
      <CategoryTable
        name="Shelter"
        categoryId="cat-1"
        items={[itemNamed('a', 'Tarp'), itemNamed('b', 'Stakes')]}
        weightUnit="g"
        isBelowLg={false}
      />,
    )
    // Scoped to the header, and asserting it carries no digit at all.
    const header = screen.getByText('Shelter').closest('div')!
    expect(within(header).queryByText('(2)')).toBeNull()
    expect(header.textContent).not.toMatch(/\d/)
  })

  it('leaves an empty category without empty-state copy', () => {
    // An empty category in List view is self-evident from the add-item row
    // beneath it; only pack sections explain themselves.
    render(
      <CategoryTable name="Shelter" categoryId="cat-1" items={[]} weightUnit="g" isBelowLg={false} />,
    )
    expect(screen.queryByText(/No items in this/)).toBeNull()
  })
})

// List view and the public share read food as items. Pack packs it as part of
// each bag's union cohort instead, through PackSection.
describe('CategoryTable food rows', () => {
  const oats = { id: 'f1', name: 'Oatmeal', unitCount: 3, weightGrams: 90 }

  it('renders food rows after the gear rows, read-only', () => {
    render(
      <CategoryTable
        name="Food"
        items={[itemNamed('a', 'Tarp')]}
        foodRows={[oats]}
        weightUnit="g"
        isBelowLg={false}
      />,
    )
    expect(screen.getByText('Oatmeal')).toBeTruthy()
    // The packing checkbox and drag handle a Pack food row carries are what
    // make it a checklist entry, and neither belongs here.
    expect(screen.queryByRole('checkbox', { name: /Oatmeal/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Oatmeal/ })).toBeNull()
  })

  // The quantity is a multiplier, not a count of rows: "Oatmeal" scheduled
  // for three breakfasts is one row showing 3.
  it('renders one row per food item regardless of quantity', () => {
    render(
      <CategoryTable name="Food" items={[]} foodRows={[oats]} weightUnit="g" isBelowLg={false} />,
    )
    expect(screen.getAllByText('Oatmeal')).toHaveLength(1)
    expect(screen.getByText('3')).toBeTruthy()
  })

  // On the owner's page every gear row starts with a drag grip and ends in a
  // kebab. Food rows have neither, so without reserving both boxes the Food
  // table sits off the gear tables' rails. The share page omits it.
  it('reserveControlColumns pads each food row with empty grip and kebab boxes', () => {
    render(
      <CategoryTable
        name="Food"
        items={[]}
        foodRows={[oats]}
        weightUnit="g"
        isBelowLg={false}
        reserveControlColumns
      />,
    )
    const row = screen.getByText('Oatmeal').closest('.group')!
    expect(row.firstElementChild!.textContent).toBe('')
    expect(row.lastElementChild!.textContent).toBe('')
    // The weight moved one cell in from the edge, onto the gear rows' rail.
    expect(row.querySelector('[aria-label="90 g"]')).not.toBeNull()
  })

  it('without reserveControlColumns the name and weight cells stay outermost', () => {
    render(
      <CategoryTable name="Food" items={[]} foodRows={[oats]} weightUnit="g" isBelowLg={false} />,
    )
    const row = screen.getByText('Oatmeal').closest('.group')!
    expect(row.firstElementChild!.textContent).toContain('Oatmeal')
    expect(row.lastElementChild!.querySelector('[aria-label="90 g"]')).not.toBeNull()
  })
})
