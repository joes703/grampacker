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
    packSortOrder: 0,
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
// canonical computeListWeightBreakdown result, passes it down. These tests pin
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
  it('renders supplied Base and Consumable totals, not the sum of its own rows', () => {
    render(
      <CategoryGroup
        name="Shelter"
        categoryId="cat-1"
        items={[itemNamed('a', 'Tarp'), consumable('b', 'Gas')]}
        weightUnit="g"
        baseSubtotalGrams={777.4}
        consumableSubtotalGrams={333.6}
      />,
    )
    expect(screen.getAllByText('777 g').length).toBeGreaterThan(0)
    expect(screen.getAllByText('334 g').length).toBeGreaterThan(0)
    expect(screen.queryByText('777.4 g')).toBeNull()
    expect(screen.queryByText('333.6 g')).toBeNull()
    // 200 g is what summing the two rows would produce.
    expect(screen.queryByText('200 g')).toBeNull()
  })

  it('labels both kinds of category weight', () => {
    render(
      <CategoryGroup
        name="Shelter"
        categoryId="cat-1"
        items={[itemNamed('a', 'Tarp')]}
        weightUnit="g"
        baseSubtotalGrams={777}
        consumableSubtotalGrams={333}
      />,
    )
    expect(screen.getAllByText(/Base/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Consumable/).length).toBeGreaterThan(0)
  })

  it('uses one line box and explicit font roles for every footer metric', () => {
    render(
      <CategoryGroup
        name="Kitchen"
        categoryId="cat-kitchen"
        items={[itemNamed('a', 'Pot'), consumable('b', 'Fuel')]}
        weightUnit="g"
        baseSubtotalGrams={1352}
        consumableSubtotalGrams={110}
      />,
    )

    const footer = document.querySelector<HTMLElement>('.print\\:flex')
    if (!footer) throw new Error('expected category footer')
    const totals = footer.querySelector<HTMLElement>('.inline-flex.justify-end')
    if (!totals) throw new Error('expected category footer totals')
    const basePair = within(totals).getByText('Base').parentElement
    const consumablePair = within(totals).getByText('Consumable').parentElement
    if (!basePair || !consumablePair) throw new Error('expected category footer label-value pairs')

    expect(totals).toHaveClass('flex-nowrap', 'items-baseline')
    expect(totals.parentElement).not.toHaveClass('font-mono', 'font-semibold')
    expect(basePair).toHaveClass('text-xs', 'leading-4')
    expect(consumablePair).toHaveClass('text-xs', 'leading-4')
    expect(within(basePair).getByText('Base')).toHaveClass('font-sans')
    expect(within(consumablePair).getByText('Consumable')).toHaveClass('font-sans')
    expect(within(basePair).getByText('1352 g')).toHaveClass('font-mono', 'text-xs', 'leading-4')
    expect(within(consumablePair).getByText('110 g')).toHaveClass('font-mono', 'text-xs', 'leading-4')
  })

  it('keeps full gram precision when converting category footers to ounces', () => {
    render(
      <CategoryGroup
        name="Shelter"
        categoryId="cat-1"
        items={[itemNamed('a', 'Tarp')]}
        weightUnit="oz"
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
      <CategoryGroup
        name="Food"
        categoryId="cat-food"
        items={[consumable('b', 'Gas')]}
        weightUnit="g"
        baseSubtotalGrams={0}
        consumableSubtotalGrams={100}
      />,
    )
    expect(screen.queryByText(/Base/)).toBeNull()
    expect(screen.getAllByText(/Consumable/).length).toBeGreaterThan(0)
  })

  it('omits Consumable when the category is base-only', () => {
    render(
      <CategoryGroup
        name="Shelter"
        categoryId="cat-1"
        items={[itemNamed('a', 'Tarp')]}
        weightUnit="g"
        baseSubtotalGrams={100}
        consumableSubtotalGrams={0}
      />,
    )
    expect(screen.getAllByText(/Base/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Consumable/)).toBeNull()
  })

  it('prepends Worn to its rounded footer weight without mislabeling it Base', () => {
    render(
      <CategoryGroup
        name="Worn"
        regionKey="worn"
        items={[itemNamed('a', 'Jacket')]}
        weightUnit="g"
        subtotalGrams={777.4}
        wornSection
      />,
    )
    const footer = document.querySelector<HTMLElement>('.print\\:flex')
    expect(footer).not.toBeNull()
    expect(within(footer!).getAllByText('Worn')).toHaveLength(2)
    expect(within(footer!).getAllByText('777 g')).toHaveLength(2)
    expect(screen.queryByText('777.4 g')).toBeNull()
    expect(screen.queryByText(/Base/)).toBeNull()
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

  it('marks a pack section complete only when every row is packed', () => {
    // The packed/total count used to live in the header and was removed - it
    // cost mobile width for a number the progress bars already carry. The
    // packed tally still drives the "All packed" mark, so that is what pins it.
    const packed = { ...itemNamed('a', 'Tarp'), isPacked: true }
    const { rerender } = render(
      <CategoryGroup
        name="Shelter"
        categoryId="cat-1"
        items={[packed, itemNamed('b', 'Stakes')]}
        weightUnit="g"
        packMode
      />,
    )
    expect(screen.queryByLabelText('All packed')).toBeNull()

    rerender(
      <CategoryGroup
        name="Shelter"
        categoryId="cat-1"
        items={[packed, { ...itemNamed('b', 'Stakes'), isPacked: true }]}
        weightUnit="g"
        packMode
      />,
    )
    expect(screen.getByLabelText('All packed')).toBeInTheDocument()
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
        onUpdate={onUpdate}
      />,
    )

    expect(screen.getAllByText('Backpack')).toHaveLength(1)
    expect(screen.getByRole('checkbox', { name: 'Mark Backpack ready' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Backpack' }))
    expect(onUpdate).toHaveBeenCalledWith('pack', { isPacked: true })
  })

  it('includes nested container contents in the parent pack progress', () => {
    const backpack = { ...itemNamed('pack', 'Backpack'), isPacked: true }
    const canister = itemNamed('canister', 'Bear canister')
    const food = itemNamed('food', 'Food bag')

    render(
      <CategoryGroup
        name="Backpack"
        regionKey="loc-pack"
        containerItem={backpack}
        items={[]}
        weightUnit="g"
        packMode
        packProgressItems={[backpack, canister, food]}
      >
        <CategoryGroup
          name="Bear canister"
          regionKey="loc-canister"
          containerItem={canister}
          items={[food]}
          weightUnit="g"
          packMode
        />
      </CategoryGroup>,
    )

    // packProgressItems is what makes a parent section account for rows that
    // render inside a NESTED section. Only 1 of the 3 is packed, so the parent
    // must not claim completion - which is the assertion that would break if
    // the parent went back to counting only its own direct rows.
    expect(screen.queryByLabelText('All packed')).toBeNull()

    // ...and it does claim completion once all three are. packProgressItems
    // only type-checks alongside nested children, which is the arrangement it
    // exists for, so the nested section comes along.
    cleanup()
    const packedCanister = { ...canister, isPacked: true }
    const packedFood = { ...food, isPacked: true }
    render(
      <CategoryGroup
        name="Backpack"
        regionKey="loc-pack"
        containerItem={backpack}
        items={[]}
        weightUnit="g"
        packMode
        packProgressItems={[backpack, packedCanister, packedFood]}
      >
        <CategoryGroup
          name="Bear canister"
          regionKey="loc-canister"
          containerItem={packedCanister}
          items={[packedFood]}
          weightUnit="g"
          packMode
        />
      </CategoryGroup>,
    )
    // Both sections are complete, so both mark it - the parent is the one under
    // test and it can only know that from packProgressItems.
    expect(screen.getAllByLabelText('All packed')).toHaveLength(2)
  })

  // Pack mode has two independent filters. They are ANDed: with both on, a row
  // survives only if it is neither packed nor ready. ORing them would make
  // turning on a second filter show MORE rows, which inverts what a filter
  // switch means, and no assertion on a single filter alone can catch it.
  describe('pack filters', () => {
    const plain = itemNamed('plain', 'Stakes')
    const packed = { ...itemNamed('packed', 'Tarp'), isPacked: true }
    const ready = { ...itemNamed('ready', 'Stove'), isReady: true }
    const both = { ...itemNamed('both', 'Pot'), isPacked: true, isReady: true }
    const all = [plain, packed, ready, both]

    function renderFiltered(filters: {
      showUnpackedOnly?: boolean
      showUnreadyOnly?: boolean
    }) {
      render(
        <CategoryGroup
          name="Kitchen"
          categoryId="cat-1"
          items={all}
          weightUnit="g"
          packMode
          {...filters}
        />,
      )
    }

    it('shows every row with both filters off', () => {
      renderFiltered({})
      for (const name of ['Stakes', 'Tarp', 'Stove', 'Pot']) {
        expect(screen.getByText(name)).toBeInTheDocument()
      }
    })

    it('hides packed rows for the unpacked-only filter, regardless of ready', () => {
      renderFiltered({ showUnpackedOnly: true })
      expect(screen.getByText('Stakes')).toBeInTheDocument()
      expect(screen.getByText('Stove')).toBeInTheDocument()
      expect(screen.queryByText('Tarp')).toBeNull()
      expect(screen.queryByText('Pot')).toBeNull()
    })

    it('hides ready rows for the un-ready filter, regardless of packed', () => {
      renderFiltered({ showUnreadyOnly: true })
      expect(screen.getByText('Stakes')).toBeInTheDocument()
      expect(screen.getByText('Tarp')).toBeInTheDocument()
      expect(screen.queryByText('Stove')).toBeNull()
      expect(screen.queryByText('Pot')).toBeNull()
    })

    it('shows only rows that pass BOTH filters when both are on', () => {
      renderFiltered({ showUnpackedOnly: true, showUnreadyOnly: true })
      expect(screen.getByText('Stakes')).toBeInTheDocument()
      expect(screen.queryByText('Tarp')).toBeNull()
      expect(screen.queryByText('Stove')).toBeNull()
      expect(screen.queryByText('Pot')).toBeNull()
    })

    // The row menu decides whether to offer click-to-place from this array.
    // If it were the UNFILTERED set, a bag showing one row would still offer
    // "Reorder in this bag" and open a mode whose every insertion point is a
    // no-op - a live mode with no controls in it.
    it('hands the row action the rows that survived filtering, not all of them', () => {
      const cohorts: number[] = []
      render(
        <CategoryGroup
          name="Kitchen"
          categoryId="cat-1"
          items={all}
          weightUnit="g"
          packMode
          showUnpackedOnly
          showUnreadyOnly
          renderRowAction={(_item, cohort) => {
            cohorts.push(cohort.length)
            return null
          }}
        />,
      )
      // Stakes is the only row left of four, and every call agrees on that.
      expect(cohorts).toEqual([1])
    })

    it('hands the row action every row when nothing is filtered', () => {
      const cohorts: string[][] = []
      render(
        <CategoryGroup
          name="Kitchen"
          categoryId="cat-1"
          items={all}
          weightUnit="g"
          packMode
          renderRowAction={(_item, cohort) => {
            cohorts.push(cohort.map((i) => i.gearItem.name))
            return null
          }}
        />,
      )
      expect(cohorts).toHaveLength(4)
      expect(cohorts[0]).toEqual(['Stakes', 'Tarp', 'Stove', 'Pot'])
    })

    it('judges completeness on the unfiltered set', () => {
      // The filter is a view of the section, not a redefinition of it. If
      // progress followed the filter, "unpacked only" would hide every packed
      // row and the section would report itself complete with work left in it.
      renderFiltered({ showUnpackedOnly: true })
      expect(screen.queryByLabelText('All packed')).toBeNull()
    })

    it('says a section is empty because of the filters, not just blank', () => {
      // The dangerous ambiguity: a bare header with nothing under it reads
      // the same whether the location is genuinely empty or a filter is
      // hiding everything in it. A packer scanning for what is left would
      // read the second as "done here".
      renderFiltered({ showUnpackedOnly: true, showUnreadyOnly: true })
      expect(screen.queryByText('Stakes')).toBeInTheDocument()

      cleanup()
      render(
        <CategoryGroup
          name="Kitchen"
          categoryId="cat-1"
          items={[packed, ready, both]}
          weightUnit="g"
          packMode
          showUnpackedOnly
          showUnreadyOnly
        />,
      )
      expect(screen.getByText('All 3 items here are hidden by the filters above.')).toBeInTheDocument()
    })

    it('distinguishes a genuinely empty location from a filtered-empty one', () => {
      render(
        <CategoryGroup
          name="Top lid"
          regionKey="loc-1"
          items={[]}
          weightUnit="g"
          packMode
        />,
      )
      expect(screen.getByText('No items in this location.')).toBeInTheDocument()
    })

    it('calls an empty CATEGORY a category, not a location', () => {
      // Pack falls back to category grouping while a list has no packing
      // locations, so this copy has to name the right thing. A category can
      // also go empty for a mundane reason - everything in it is worn, and
      // worn rows move to the trailing Worn section.
      render(
        <CategoryGroup
          name="Clothing"
          categoryId="cat-1"
          items={[{ ...itemNamed('hat', 'Sun hat'), isWorn: true }]}
          weightUnit="g"
          packMode
        />,
      )
      expect(screen.getByText('No items in this category.')).toBeInTheDocument()
      expect(screen.queryByText('No items in this location.')).toBeNull()
    })

    it('reads an empty Unassigned bucket as success, not as a gap', () => {
      // "No items here" would frame a fully organized list as a problem.
      render(
        <CategoryGroup
          name="Unassigned"
          categoryId={null}
          regionKey="packing-unassigned"
          items={[]}
          weightUnit="g"
          packMode
        />,
      )
      expect(screen.getByText('Everything has a location.')).toBeInTheDocument()
    })

    it('leaves empty edit-mode categories alone', () => {
      // Only pack sections explain themselves; an empty category in edit mode
      // is self-evident from the add-item row beneath it.
      render(
        <CategoryGroup
          name="Shelter"
          categoryId="cat-1"
          items={[]}
          weightUnit="g"
        />,
      )
      expect(screen.queryByText('No items in this location.')).toBeNull()
    })

    it('never filters away the container header row', () => {
      // The container item is the section's HEADER, not a member of it.
      // Hiding it would take the location, its contents, its actions and its
      // droppable surface with it - so a packed, ready container stays put
      // while its own filtered contents disappear.
      const container = { ...itemNamed('pack', 'Backpack'), isPacked: true, isReady: true }
      const packedChild = { ...itemNamed('bag', 'Sleeping bag'), isPacked: true }
      render(
        <CategoryGroup
          name="Backpack"
          regionKey="loc-pack"
          containerItem={container}
          items={[packedChild]}
          weightUnit="g"
          packMode
          showUnpackedOnly
          showUnreadyOnly
        />,
      )

      expect(screen.getByText('Backpack')).toBeInTheDocument()
      expect(screen.queryByText('Sleeping bag')).toBeNull()
    })
  })

  it('renders no subtotal in pack mode, not even an unlabeled one', () => {
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
        baseSubtotalGrams={777}
      />,
    )
    expect(screen.queryByText(/Base/)).toBeNull()
    expect(screen.queryByText('777 g')).toBeNull()
  })

  it('keeps the subtotal out of the rows when an item is both worn and consumable', () => {
    // The breakdown buckets the defensive isConsumable+isWorn state as
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

// Two arrangements of one list, two renderings of one food row. Category and
// the public share read food as items; Pack packs it as part of each bag's
// union cohort, which arrives through renderRows with the gear. Getting this
// gate wrong in either direction is visible: rendering both shows every food
// row twice, rendering neither loses food from the arrangement that has no
// other place to show it.
describe('plain food rows belong to the non-pack arrangements', () => {
  const oats = { id: 'f1', name: 'Oatmeal', unitCount: 3, weightGrams: 90 }

  it('renders food rows after the gear rows outside pack mode', () => {
    render(
      <CategoryGroup
        name="Food"
        items={[itemNamed('a', 'Tarp')]}
        foodRows={[oats]}
        weightUnit="g"
      />,
    )
    expect(screen.getByText('Oatmeal')).toBeTruthy()
    // Read-only: the packing checkbox and drag handle a Pack food row carries
    // are what make it a checklist entry, and neither belongs here.
    expect(screen.queryByRole('checkbox', { name: /Oatmeal/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Oatmeal/ })).toBeNull()
  })

  it('renders no plain food rows in pack mode, where the union owns them', () => {
    render(
      <CategoryGroup
        name="Food"
        items={[]}
        foodRows={[oats]}
        weightUnit="g"
        packMode
      />,
    )
    expect(screen.queryByText('Oatmeal')).toBeNull()
  })

  // Found in review. subtotalGrams is the WORN section's channel and the
  // footer hardcodes "Worn" as its label, so routing food through it printed
  // "Worn 470 g" under the food rows. Food is consumable by definition, and
  // that is the bucket its grams already land in upstream - so the section
  // has to say so.
  it('labels the food subtotal Consumable, never Worn', () => {
    render(
      <CategoryGroup
        name="Food"
        items={[]}
        foodRows={[oats]}
        weightUnit="g"
        consumableSubtotalGrams={270}
      />,
    )
    // getAll: the footer renders twice, once per breakpoint branch.
    expect(screen.getAllByText(/Consumable/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Worn/)).toBeNull()
  })

  // The quantity is a multiplier, not a count of rows. A section showing
  // "Oatmeal" three times because it is scheduled for three breakfasts is the
  // failure this whole feature has to avoid, and one row per item is where
  // that starts.
  it('renders one row per food item regardless of quantity', () => {
    render(
      <CategoryGroup name="Food" items={[]} foodRows={[oats]} weightUnit="g" />,
    )
    expect(screen.getAllByText('Oatmeal')).toHaveLength(1)
    expect(screen.getByText('3')).toBeTruthy()
  })
})
