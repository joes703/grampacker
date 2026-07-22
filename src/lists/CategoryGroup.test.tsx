// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ListItemWithGear } from '../lib/types'
import CategoryGroup from './CategoryGroup'

afterEach(() => {
  cleanup()
})

function itemNamed(id: string, name: string): ListItemWithGear {
  return {
    id,
    listId: 'list-1',
    gearItemId: `gear-${id}`,
    quantity: 1,
    isWorn: false,
    isConsumable: false,
    isPacked: false,
    isReady: false,
    packingLocationId: null,
    sortOrder: 0,
    createdAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:00.000Z',
    gearItem: {
      id: `gear-${id}`,
      categoryId: null,
      name,
      description: null,
      weightGrams: 100,
      cost: null,
      purchaseDate: null,
      status: 'active',
      sortOrder: 0,
      createdAt: '2026-06-06T00:00:00.000Z',
      updatedAt: '2026-06-06T00:00:00.000Z',
    },
  }
}

describe('CategoryGroup region id', () => {
  // The Worn pseudo-section (ListDetailPage) renders alongside the real
  // Uncategorized section and passes no categoryId. Both derived their region
  // id from `categoryId ?? 'uncategorized'`, so both emitted
  // id="cat-region-uncategorized" and both collapse chevrons pointed
  // aria-controls at whichever element won. regionKey disambiguates.
  it('gives a categoryId-less section a distinct region id from Uncategorized', () => {
    render(
      <>
        <CategoryGroup
          name="Uncategorized"
          categoryId={null}
          items={[itemNamed('item-1', 'Stove')]}
          weightUnit="g"
        />
        <CategoryGroup
          name="Worn"
          regionKey="worn"
          items={[itemNamed('item-2', 'Sun hat')]}
          weightUnit="g"
          wornSection
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

  it('gives every packing location and Unassigned a unique region id', () => {
    render(
      <>
        <CategoryGroup name="Main pack" regionKey="loc-main" items={[itemNamed('item-1', 'Tarp')]} weightUnit="g" />
        <CategoryGroup name="Lid" regionKey="loc-lid" items={[itemNamed('item-2', 'Stove')]} weightUnit="g" />
        <CategoryGroup name="Unassigned" regionKey="packing-unassigned" items={[itemNamed('item-3', 'Cup')]} weightUnit="g" />
      </>,
    )

    const targets = screen
      .getAllByRole('button', { name: /Collapse|Expand/ })
      .map((button) => button.getAttribute('aria-controls'))
    expect(new Set(targets).size).toBe(3)
  })

  it('supports controlled collapse for persisted packing-location state', () => {
    const onCollapsedChange = vi.fn()
    render(
      <CategoryGroup
        name="Main pack"
        regionKey="loc-main"
        items={[itemNamed('item-1', 'Tarp')]}
        weightUnit="g"
        collapsed
        onCollapsedChange={onCollapsedChange}
      />,
    )

    expect(screen.queryByText('Tarp')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Main pack' }))
    expect(onCollapsedChange).toHaveBeenCalledWith(false)
  })

  // The share view (SharePage) passes collapsible={false} and NO categoryId
  // for every section, so every section - each category plus the trailing
  // Worn group - derived the same 'cat-region-uncategorized' id. Nothing
  // references those ids there, since the chevron that would point at them
  // isn't rendered, so they are emitted only alongside the chevron.
  it('emits no region id when the section is not collapsible', () => {
    const { container } = render(
      <>
        <CategoryGroup
          name="Uncategorized"
          items={[itemNamed('item-1', 'Stove')]}
          weightUnit="g"
          collapsible={false}
        />
        <CategoryGroup
          name="Worn"
          items={[itemNamed('item-2', 'Sun hat')]}
          weightUnit="g"
          collapsible={false}
          wornSection
        />
      </>,
    )

    expect(container.querySelectorAll('[id^="cat-region-"]')).toHaveLength(0)
  })
})

describe('CategoryGroup worn extraction', () => {
  it('keeps worn rows out of ordinary sections and renders them in Worn', () => {
    const jacket = { ...itemNamed('jacket', 'Rain jacket'), isWorn: true }
    const { rerender } = render(
      <CategoryGroup name="Clothing" items={[jacket]} weightUnit="g" />,
    )
    expect(screen.queryByText('Rain jacket')).not.toBeInTheDocument()

    rerender(
      <CategoryGroup name="Worn" items={[jacket]} weightUnit="g" wornSection />,
    )
    expect(screen.getByText('Rain jacket')).toBeInTheDocument()
  })
})

// The per-section footer subtotal. This used to be summed inside CategoryGroup
// from its own rows, which counted consumables and worn items into it, so the subtotals never
// reconciled with the summary panel's Base weight, and an unrelated display
// toggle changed what the number meant.
//
// The section no longer computes it. The parent, which already holds the
// canonical computeWeightBreakdown result, passes it down. These tests pin
// that the section RENDERS what it is handed and never re-derives it.
describe('CategoryGroup footer subtotal', () => {
  function consumable(id: string, name: string): ListItemWithGear {
    const item = itemNamed(id, name)
    return { ...item, isConsumable: true }
  }

  // Every fixture row weighs 100 g, so the subtotals asserted below are
  // deliberately values NO row can produce (777 / 0). An assertion satisfiable
  // by row text would still pass if the footer silently went back to summing
  // rows, which is the exact regression these tests exist to catch.
  it('renders the supplied subtotal, not the sum of its own rows', () => {
    render(
      <CategoryGroup
        name="Shelter"
        categoryId="cat-1"
        items={[itemNamed('a', 'Tarp'), consumable('b', 'Gas')]}
        weightUnit="g"
        subtotalLabel="Base"
        subtotalGrams={777}
      />,
    )
    expect(screen.getAllByText('777 g').length).toBeGreaterThan(0)
    // 200 g is what summing the two rows would produce.
    expect(screen.queryByText('200 g')).toBeNull()
  })

  it('labels the subtotal, because it is not the visible rows added up', () => {
    render(
      <CategoryGroup
        name="Shelter"
        categoryId="cat-1"
        items={[itemNamed('a', 'Tarp')]}
        weightUnit="g"
        subtotalLabel="Base"
        subtotalGrams={777}
      />,
    )
    expect(screen.getAllByText(/Base/).length).toBeGreaterThan(0)
  })

  it('renders an explicit zero for a category whose items are all consumable', () => {
    // The trap: catRows omits zero-base categories entirely, so "absent" must
    // still render 0 rather than blanking or borrowing another section's value.
    render(
      <CategoryGroup
        name="Food"
        categoryId="cat-food"
        items={[consumable('b', 'Gas')]}
        weightUnit="g"
        subtotalLabel="Base"
        subtotalGrams={0}
      />,
    )
    expect(screen.getAllByText('0 g').length).toBeGreaterThan(0)
  })

  it('renders a bare value when given no label, and never mislabels it Base', () => {
    // The Worn pseudo-section. Calling it "Base" would be flatly wrong - worn
    // weight is excluded from base by definition - and repeating "Worn" beside
    // a section already titled Worn is noise.
    render(
      <CategoryGroup
        name="Worn"
        regionKey="worn"
        items={[itemNamed('a', 'Jacket')]}
        weightUnit="g"
        subtotalGrams={777}
        wornSection
      />,
    )
    expect(screen.getAllByText('777 g').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Base/)).toBeNull()
    // The section title must remain the only "Worn" in the subtree, so callers
    // asserting on it are not made ambiguous by a duplicate label.
    expect(screen.getAllByText('Worn')).toHaveLength(1)
  })

  it('renders no subtotal when the parent supplies none', () => {
    render(
      <CategoryGroup
        name="Shelter"
        categoryId="cat-1"
        items={[itemNamed('a', 'Tarp')]}
        weightUnit="g"
      />,
    )
    expect(screen.queryByText(/Base/)).toBeNull()
    // The footer ROW still renders (it carries "Add new item"); what must be
    // absent is any weight in it. The item rows legitimately show their own
    // 100 g, so scope the assertion to the footer rather than the document.
    const footer = document.querySelector('.print\\:flex')
    expect(footer).not.toBeNull()
    expect(footer!.textContent).not.toMatch(/\d+(\.\d+)?\s*g/)
  })

  // The plain "(N)" category count was removed everywhere: the rows are right
  // there to be counted and the number added noise to every header. Pack
  // mode's "packed / total" is a different metric - it reports progress, not
  // membership - and deliberately stays. These two pin that boundary, because
  // the tempting "restore header parity" change breaks it in one direction and
  // the tempting "drop all counts" sweep breaks it in the other.
  it('renders no membership count in edit mode', () => {
    render(
      <CategoryGroup
        name="Shelter"
        categoryId="cat-1"
        items={[itemNamed('a', 'Tarp'), itemNamed('b', 'Stakes')]}
        weightUnit="g"
      />,
    )
    // Scoped to the header: an unscoped queryByText('2') would collide with
    // any legitimate future number elsewhere in the section (a quantity, a
    // weight), passing or failing for reasons that have nothing to do with
    // the header count. Asserting the header carries no digit at all is the
    // claim we actually mean.
    const header = screen.getByText('Shelter').closest('div')!
    expect(within(header).queryByText('(2)')).toBeNull()
    expect(header.textContent).not.toMatch(/\d/)
  })

  it('still renders packed / total in pack mode', () => {
    const packed = { ...itemNamed('a', 'Tarp'), isPacked: true }
    render(
      <CategoryGroup
        name="Shelter"
        categoryId="cat-1"
        items={[packed, itemNamed('b', 'Stakes')]}
        weightUnit="g"
        packMode
      />,
    )
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('renders an item-backed location as the checklist header, not a duplicate row', () => {
    const containerItem = itemNamed('pack', 'Backpack')
    const onUpdate = vi.fn()
    render(
      <CategoryGroup
        name="Backpack"
        regionKey="loc-pack"
        containerItem={containerItem}
        items={[itemNamed('bag', 'Sleeping bag')]}
        weightUnit="g"
        packMode
        readyChecksEnabled
        onUpdate={onUpdate}
      />,
    )

    expect(screen.getAllByText('Backpack')).toHaveLength(1)
    expect(screen.getByRole('checkbox', { name: 'Mark Backpack ready' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Backpack' }))
    expect(onUpdate).toHaveBeenCalledWith('pack', { isPacked: true })
    expect(screen.getByText('0 / 2')).toBeInTheDocument()
  })

  it('renders no subtotal in pack mode, not even an unlabelled one', () => {
    // The footer is !packMode-gated. Pack mode deliberately keeps counts on
    // full section membership; a packed/unpacked-dependent weight would be a
    // third definition of the metric. Asserting only on the absent label would
    // miss a leaked bare value, so assert on the unique value itself.
    render(
      <CategoryGroup
        name="Shelter"
        categoryId="cat-1"
        items={[itemNamed('a', 'Tarp')]}
        weightUnit="g"
        packMode
        subtotalLabel="Base"
        subtotalGrams={777}
      />,
    )
    expect(screen.queryByText(/Base/)).toBeNull()
    expect(screen.queryByText('777 g')).toBeNull()
  })

  it('keeps the subtotal out of the rows when an item is both worn and consumable', () => {
    // computeWeightBreakdown buckets the defensive isConsumable+isWorn state as
    // consumable, while the Worn section's grouper selects on isWorn. So such a
    // row can render in Worn while its weight sits in consumableGrams. A DB
    // CHECK forbids the state; this locks in that the SECTION still renders
    // exactly what it was handed rather than quietly re-deriving a total to
    // paper over the mismatch.
    const dual = { ...itemNamed('a', 'Jacket'), isWorn: true, isConsumable: true }
    render(
      <CategoryGroup
        name="Worn"
        regionKey="worn"
        items={[dual]}
        weightUnit="g"
        subtotalGrams={0}
        wornSection
      />,
    )
    expect(screen.getAllByText('0 g').length).toBeGreaterThan(0)
    expect(screen.queryByText('100 g')).toBeNull()
  })
})
