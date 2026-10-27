// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ListItemWithGear } from '../lib/types'
import { makeGearItem, makeListItem } from '../test/fixtures'
import PackSection from './PackSection'

afterEach(() => {
  cleanup()
})

function itemNamed(id: string, name: string): ListItemWithGear {
  return makeListItem({ id, gearItem: makeGearItem({ id: `gear-${id}`, name, weightGrams: 100 }) })
}

describe('PackSection header', () => {
  // A chevron would occupy the rows' leading column and push the header's
  // checkboxes off the ones they label, so pack sections cannot collapse -
  // and with no chevron there is no aria-controls target to emit.
  it('renders no collapse control and no region id', () => {
    const { container } = render(
      <>
        <PackSection name="Main pack" items={[itemNamed('item-1', 'Tarp')]} weightUnit="g" isBelowLg={false} />
        <PackSection name="Unassigned" items={[itemNamed('item-2', 'Cup')]} weightUnit="g" isBelowLg={false} />
      </>,
    )
    expect(screen.queryByRole('button', { name: /Collapse|Expand/ })).toBeNull()
    expect(container.querySelectorAll('[id^="cat-region-"]')).toHaveLength(0)
  })

  it('marks a section complete only when every row is packed', () => {
    // The header shows no packed/total count (the progress bars carry it);
    // the packed tally drives the "All packed" mark, so that pins it.
    const packed = { ...itemNamed('a', 'Tarp'), isPacked: true }
    const { rerender } = render(
      <PackSection name="Shelter" items={[packed, itemNamed('b', 'Stakes')]} weightUnit="g" isBelowLg={false} />,
    )
    expect(screen.queryByLabelText('All packed')).toBeNull()

    rerender(
      <PackSection
        name="Shelter"
        items={[packed, { ...itemNamed('b', 'Stakes'), isPacked: true }]}
        weightUnit="g"
        isBelowLg={false}
      />,
    )
    expect(screen.getByLabelText('All packed')).toBeInTheDocument()
  })

  it('renders an item-backed location as the checklist header, not a duplicate row', () => {
    const containerItem = itemNamed('pack', 'Backpack')
    const onUpdate = vi.fn()
    render(
      <PackSection
        name="Backpack"
        containerItem={containerItem}
        items={[itemNamed('bag', 'Sleeping bag')]}
        weightUnit="g"
        isBelowLg={false}
        onUpdate={onUpdate}
      />,
    )

    expect(screen.getAllByText('Backpack')).toHaveLength(1)
    expect(screen.getByRole('checkbox', { name: 'Mark Backpack ready' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Backpack' }))
    expect(onUpdate).toHaveBeenCalledWith('pack', { isPacked: true })
  })

  it('includes nested container contents in the parent progress', () => {
    const backpack = { ...itemNamed('pack', 'Backpack'), isPacked: true }
    const canister = itemNamed('canister', 'Bear canister')
    const food = itemNamed('food', 'Food bag')

    render(
      <PackSection
        name="Backpack"
        containerItem={backpack}
        items={[]}
        weightUnit="g"
        isBelowLg={false}
        packProgressItems={[backpack, canister, food]}
      >
        <PackSection name="Bear canister" containerItem={canister} items={[food]} weightUnit="g" isBelowLg={false} />
      </PackSection>,
    )

    // packProgressItems is what makes a parent account for rows that render
    // inside a NESTED section. Only 1 of the 3 is packed, so the parent must
    // not claim completion.
    expect(screen.queryByLabelText('All packed')).toBeNull()

    // ...and it does once all three are. packProgressItems only type-checks
    // alongside nested children, so the nested section comes along.
    cleanup()
    const packedCanister = { ...canister, isPacked: true }
    const packedFood = { ...food, isPacked: true }
    render(
      <PackSection
        name="Backpack"
        containerItem={backpack}
        items={[]}
        weightUnit="g"
        isBelowLg={false}
        packProgressItems={[backpack, packedCanister, packedFood]}
      >
        <PackSection
          name="Bear canister"
          containerItem={packedCanister}
          items={[packedFood]}
          weightUnit="g"
          isBelowLg={false}
        />
      </PackSection>,
    )
    // Both sections are complete; the parent can only know from
    // packProgressItems.
    expect(screen.getAllByLabelText('All packed')).toHaveLength(2)
  })
})

describe('PackSection worn rows', () => {
  // An ordinary pack section hides its worn row - the reorder planner assumes
  // exactly this (section-rows.ts) - while the Worn section shows every row
  // it is handed.
  const jacket = { ...itemNamed('jacket', 'Rain jacket'), isWorn: true }
  const shell = itemNamed('shell', 'Wind shell')

  it('keeps worn rows out of ordinary sections and renders them in Worn', () => {
    const { rerender } = render(
      <PackSection name="Clothing" items={[shell, jacket]} weightUnit="g" isBelowLg={false} />,
    )
    expect(screen.getByText('Wind shell')).toBeInTheDocument()
    expect(screen.queryByText('Rain jacket')).not.toBeInTheDocument()

    rerender(<PackSection name="Worn" items={[jacket]} weightUnit="g" isBelowLg={false} wornSection />)
    expect(screen.getByText('Rain jacket')).toBeInTheDocument()
  })
})

// Two independent filters, ANDed: with both on, a row survives only if it is
// neither packed nor ready. ORing them would make a second filter show MORE
// rows, and no assertion on a single filter alone can catch it.
describe('PackSection filters', () => {
  const plain = itemNamed('plain', 'Stakes')
  const packed = { ...itemNamed('packed', 'Tarp'), isPacked: true }
  const ready = { ...itemNamed('ready', 'Stove'), isReady: true }
  const both = { ...itemNamed('both', 'Pot'), isPacked: true, isReady: true }
  const all = [plain, packed, ready, both]

  function renderFiltered(filters: { showUnpackedOnly?: boolean; showUnreadyOnly?: boolean }) {
    render(<PackSection name="Kitchen" items={all} weightUnit="g" isBelowLg={false} {...filters} />)
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

  it('judges completeness on the unfiltered set', () => {
    // If completeness followed the filter, a filter that hides unpacked rows
    // would let the section report itself complete with work left in it.
    // Here the un-ready filter leaves only the packed Tarp on screen, while
    // the hidden Stove is still unpacked.
    render(
      <PackSection name="Kitchen" items={[packed, ready]} weightUnit="g" isBelowLg={false} showUnreadyOnly />,
    )
    expect(screen.getByText('Tarp')).toBeInTheDocument()
    expect(screen.queryByText('Stove')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('All packed')).toBeNull()
  })

  it('says a section is empty because of the filters, not just blank', () => {
    // A bare header reads the same whether the location is empty or a filter
    // hides everything in it; a packer would read the second as "done here".
    render(
      <PackSection
        name="Kitchen"
        items={[packed, ready, both]}
        weightUnit="g"
        isBelowLg={false}
        showUnpackedOnly
        showUnreadyOnly
      />,
    )
    expect(screen.getByText('All 3 items here are hidden by the filters above.')).toBeInTheDocument()
  })

  it('names a genuinely empty location by default', () => {
    render(<PackSection name="Top lid" items={[]} weightUnit="g" isBelowLg={false} />)
    expect(screen.getByText('No items in this location.')).toBeInTheDocument()
  })

  it('uses the caller\'s empty copy when it is given', () => {
    // The category fallback and Unassigned pass their own wording.
    render(
      <PackSection
        name="Clothing"
        emptyLabel="No items in this category."
        items={[{ ...itemNamed('hat', 'Sun hat'), isWorn: true }]}
        weightUnit="g"
        isBelowLg={false}
      />,
    )
    expect(screen.getByText('No items in this category.')).toBeInTheDocument()
    expect(screen.queryByText('No items in this location.')).toBeNull()
  })

  it('never filters away the container header row', () => {
    // The container item is the section's HEADER, not a member of it. Hiding
    // it would take the location, its contents, its actions and its droppable
    // surface with it.
    const container = { ...itemNamed('pack', 'Backpack'), isPacked: true, isReady: true }
    const packedChild = { ...itemNamed('bag', 'Sleeping bag'), isPacked: true }
    render(
      <PackSection
        name="Backpack"
        containerItem={container}
        items={[packedChild]}
        weightUnit="g"
        isBelowLg={false}
        showUnpackedOnly
        showUnreadyOnly
      />,
    )

    expect(screen.getByText('Backpack')).toBeInTheDocument()
    expect(screen.queryByText('Sleeping bag')).toBeNull()
  })
})

describe('PackSection header columns', () => {
  // A pack row ends Qty, Weight (lg+), then its row controls: one menu, or
  // Edit + Remove in Worn. The header must end with the same columns or its
  // Qty label sits over the rows' Weight. jsdom has no layout, so the proof
  // is the column sequence after Qty.
  function trailingAfterQty(): Element[] {
    const qty = screen.getByText('Qty')
    const header = qty.parentElement as HTMLElement
    const children = [...header.children]
    return children.slice(children.indexOf(qty) + 1)
  }

  it.each([
    ['an ordinary section', false, 1],
    ['the Worn section (Edit + Remove)', true, 2],
  ])('ends %s with a Weight label and one slot per row control', (_label, wornSection, slots) => {
    render(
      <PackSection
        name={wornSection ? 'Worn' : 'Shelter'}
        items={[{ ...itemNamed('a', 'Tarp'), isWorn: wornSection }]}
        weightUnit="g"
        isBelowLg={false}
        wornSection={wornSection}
      />,
    )
    const [weight, ...rest] = trailingAfterQty()
    expect(weight?.textContent).toBe('Weight')
    expect(rest).toHaveLength(slots)
    for (const slot of rest) expect(slot.getAttribute('aria-hidden')).toBe('true')
  })

  it('lets a section menu fill the control slot, and keeps other header controls in the title region', () => {
    render(
      <PackSection
        name="Main pack"
        items={[itemNamed('a', 'Tarp')]}
        weightUnit="g"
        isBelowLg={false}
        titleAction={<button type="button">Nest</button>}
        headerAction={<button type="button">Menu</button>}
      />,
    )
    const [weight, ...rest] = trailingAfterQty()
    expect(weight?.textContent).toBe('Weight')
    expect(rest.map((el) => el.textContent)).toEqual(['Menu'])
    // The nest handle is before Qty, inside the flex-1 title region.
    const nest = screen.getByRole('button', { name: 'Nest' })
    expect(nest.closest('.flex-1')).not.toBeNull()
  })
})
