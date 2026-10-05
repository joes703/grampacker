// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DndContext } from '@dnd-kit/core'
import { memo, useRef, useState } from 'react'
import type { ListItemWithGear } from '../lib/types'
import { PlacementProvider, PlacementSlot, usePlacement } from './placement-context'
import type { PackRow } from './pack-rows'
import { packingSortableRows, sortableRows } from './SortableCategoryRows'

afterEach(cleanup)

function item(id: string, name: string, sortOrder: number): ListItemWithGear {
  return {
    id,
    listId: 'list-1',
    gearItemId: `gear-${id}`,
    quantity: 1,
    isWorn: false,
    isConsumable: false,
    isPacked: false,
    isReady: false,
    packingLocationId: 'loc-1',
    sortOrder,
    packSortOrder: sortOrder,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    gearItem: {
      id: `gear-${id}`,
      categoryId: null,
      name,
      description: null,
      weightGrams: 100,
      cost: null,
      purchaseDate: null,
      status: 'active',
      sortOrder,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  }
}

const gearItems = [item('a', 'Tarp', 0), item('b', 'Stove', 10), item('c', 'Pot', 20)]
const asRow = (i: ListItemWithGear): PackRow => ({ kind: 'gear', gear: i })
const rows = gearItems.map(asRow)

// regionKey is what CategoryGroup passes: a packing location id, or a sentinel
// for the Unassigned and Worn buckets.
const mainPack = { key: 'loc-1', name: 'Main pack' }
const sidePocket = { key: 'loc-2', name: 'Side pocket' }

const rowProps = (i: ListItemWithGear) => ({
  item: i,
  weightUnit: 'g' as const,
  isBelowLg: false,
})

// Drives the hook the way the page does: a start button stands in for the row
// menu's "Reorder in this bag" action, and hands itself over as the origin the
// way MoveToLocationMenu hands over its kebab.
function Harness({
  onCommit,
  items = gearItems,
  startId = 'b',
  render: renderRows = packingSortableRows,
}: {
  onCommit: (rowId: string, insertIndex: number, rows: readonly PackRow[]) => void
  items?: ListItemWithGear[]
  startId?: string
  render?: typeof packingSortableRows
}) {
  const { placement, actions } = usePlacement(onCommit)
  const startRef = useRef<HTMLButtonElement>(null)
  const subject = items.find((i) => i.id === startId)!
  return (
    <PlacementProvider placement={placement} actions={actions}>
      <button
        type="button"
        ref={startRef}
        onClick={() => actions.start(asRow(subject), mainPack, startRef.current)}
      >
        start
      </button>
      <DndContext>{renderRows(items, rowProps, mainPack)}</DndContext>
    </PlacementProvider>
  )
}

const slots = () => screen.queryAllByRole('button', { name: /^Place / })
const startButton = () => screen.getByRole('button', { name: 'start' })

describe('click-to-place slots', () => {
  it('renders nothing until placement opens', () => {
    render(<Harness onCommit={vi.fn()} />)
    expect(slots()).toHaveLength(0)
  })

  it('offers every position except the two that mean "leave it here"', async () => {
    // Stove is the middle of three rows, so four visual slots exist and the
    // two touching it are suppressed. What remains is "to the top" and "to
    // the bottom" - the only two moves that change anything.
    //
    // This also proves the mode survives the render that opens it. The
    // auto-cancel guard is a TRANSITION to zero rows, not a zero LEVEL,
    // because the count is still 0 on that commit; a level test would close
    // the mode at once. The trailing slot names the bag so its label stands
    // alone.
    const user = userEvent.setup()
    render(<Harness onCommit={vi.fn()} />)
    await user.click(startButton())

    expect(slots().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Place Stove before Tarp',
      'Place Stove at the end of Main pack',
    ])
  })

  it('hands the planner its own rendered array and the mapped index', async () => {
    // The index is in REDUCED coordinates (moving row removed). Slot 3 for a
    // row at index 1 maps to insert index 2 - the off-by-one this mapping
    // exists to prevent would send it to 3.
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(<Harness onCommit={onCommit} />)
    await user.click(startButton())
    await user.click(screen.getByRole('button', { name: 'Place Stove at the end of Main pack' }))

    expect(onCommit).toHaveBeenCalledTimes(1)
    const [itemId, insertIndex, passedItems] = onCommit.mock.calls[0]!
    expect(itemId).toBe('b')
    expect(insertIndex).toBe(2)
    // Structural rather than identity: the union renderer builds the PackRow
    // wrappers itself, so the CONTRACT is "the rows this section rendered, in
    // the order it rendered them" - which the ids pin exactly.
    expect((passedItems as PackRow[]).map((row) => row.kind === 'gear' ? row.gear.id : row.food.id))
      .toEqual(['a', 'b', 'c'])
  })

  it('closes the mode once a slot is used', async () => {
    const user = userEvent.setup()
    render(<Harness onCommit={vi.fn()} />)
    await user.click(startButton())
    await user.click(slots()[0]!)
    expect(slots()).toHaveLength(0)
  })

  it('offers nothing in a bag holding one row', async () => {
    // Both slots touch the only row, so the mode opens with nothing in it.
    // The MENU is what prevents reaching this state (see the cohort test in
    // CategoryGroup.test.tsx); this proves the slots agree rather than
    // leaving the guarantee resting on the caller alone.
    const user = userEvent.setup()
    const single = [item('a', 'Tarp', 0)]
    render(<Harness onCommit={vi.fn()} items={single} startId="a" />)
    await user.click(startButton())
    expect(slots()).toHaveLength(0)
  })

  it('stays out of category rows entirely', async () => {
    // sortableRows builds the category path, which has no row menu to start
    // placement from. Slots there would be unreachable chrome.
    const user = userEvent.setup()
    render(<Harness onCommit={vi.fn()} render={sortableRows} />)
    await user.click(startButton())
    expect(slots()).toHaveLength(0)
  })

  it('marks the row it is moving, and only that row', async () => {
    // Without this the slots appear with nothing saying WHICH row they move.
    // A background tint rather than the 0.4 opacity dragging uses: a placing
    // row stays interactive and readable, so fading it would drop its lightest
    // text under its contrast floor while the user is still using it.
    const user = userEvent.setup()
    render(<Harness onCommit={vi.fn()} />)

    expect(document.querySelectorAll('[style*="background-color"]')).toHaveLength(0)
    await user.click(startButton())

    const marked = document.querySelectorAll('[style*="background-color"]')
    expect(marked).toHaveLength(1)
    expect(marked[0]!.textContent).toContain('Stove')
    // Nothing is faded - the checkboxes and menu on that row stay legible.
    expect(document.querySelectorAll('[style*="opacity: 0.4"]')).toHaveLength(0)
  })

  it('offers a pointer-reachable way out of the mode', async () => {
    // Escape is the keyboard exit. A touch user has no Escape key, and this
    // feature exists FOR pointer users (WCAG 2.5.7) - without a Cancel control
    // a phone user who opened the mode by accident could only reorder
    // something or leave the page.
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(<Harness onCommit={onCommit} />)
    await user.click(startButton())
    expect(screen.getByText(/Moving/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(slots()).toHaveLength(0)
    expect(onCommit).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(startButton())
  })
})

describe('section membership', () => {
  // Both sections are mounted together, which is the only arrangement that can
  // actually catch slots leaking across sections. Membership is two conditions:
  // the row is in THIS section's rendered array, and this is the section the
  // mode started in.
  const otherBag = [item('x', 'Fuel', 0), item('y', 'Lighter', 10)]

  function TwoSections() {
    const { placement, actions } = usePlacement(vi.fn())
    return (
      <PlacementProvider placement={placement} actions={actions}>
        <button type="button" onClick={() => actions.start(rows[1]!, mainPack, null)}>start</button>
        <DndContext>
          <div data-testid="main">{packingSortableRows(gearItems, rowProps, mainPack)}</div>
          <div data-testid="side">{packingSortableRows(otherBag, rowProps, sidePocket)}</div>
        </DndContext>
      </PlacementProvider>
    )
  }

  it('shows slots only in the section that rendered the row', async () => {
    const user = userEvent.setup()
    render(<TwoSections />)
    await user.click(startButton())

    // Every slot on the page belongs to Main pack, and there are exactly the
    // two that Stove-in-the-middle should produce.
    expect(slots().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Place Stove before Tarp',
      'Place Stove at the end of Main pack',
    ])
    const side = screen.getByTestId('side')
    expect(side.querySelectorAll('button[aria-label^="Place "]')).toHaveLength(0)
  })
})

describe('focus', () => {
  it('returns focus to the control that opened the mode, on commit', async () => {
    // The slot holding focus unmounts on commit. Without an explicit return,
    // focus falls to the document and a keyboard user loses their place in a
    // list that can run to hundreds of rows.
    const user = userEvent.setup()
    render(<Harness onCommit={vi.fn()} />)
    const origin = startButton()
    await user.click(origin)
    await user.click(slots()[0]!)
    expect(document.activeElement).toBe(origin)
  })

  it('returns focus to the same control when the mode is abandoned', async () => {
    const user = userEvent.setup()
    function EscapableHarness() {
      const { placement, actions } = usePlacement(vi.fn())
      const startRef = useRef<HTMLButtonElement>(null)
      return (
        <PlacementProvider placement={placement} actions={actions}>
          <button
            type="button"
            ref={startRef}
            onClick={() => actions.start(rows[1]!, mainPack, startRef.current)}
          >
            start
          </button>
          <button type="button" onClick={() => actions.cancel()}>abandon</button>
          <DndContext>{packingSortableRows(gearItems, rowProps, mainPack)}</DndContext>
        </PlacementProvider>
      )
    }
    render(<EscapableHarness />)
    const origin = startButton()
    await user.click(origin)
    await user.click(screen.getByRole('button', { name: 'abandon' }))
    expect(document.activeElement).toBe(origin)
  })

  it('leaves focus alone for a caller that asks it to', async () => {
    // Drag start closes placement mid-gesture. A keyboard drag reads its keys
    // from the focused handle, so returning focus to the kebab there would
    // strand the drag that just started.
    const user = userEvent.setup()
    function DragLikeHarness() {
      const { placement, actions } = usePlacement(vi.fn())
      const startRef = useRef<HTMLButtonElement>(null)
      return (
        <PlacementProvider placement={placement} actions={actions}>
          <button
            type="button"
            ref={startRef}
            onClick={() => actions.start(rows[1]!, mainPack, startRef.current)}
          >
            start
          </button>
          <button
            type="button"
            onClick={() => actions.cancel({ returnFocus: false })}
          >
            drag
          </button>
          <DndContext>{packingSortableRows(gearItems, rowProps, mainPack)}</DndContext>
        </PlacementProvider>
      )
    }
    render(<DragLikeHarness />)
    await user.click(startButton())
    const dragButton = screen.getByRole('button', { name: 'drag' })
    await user.click(dragButton)

    expect(slots()).toHaveLength(0)
    expect(document.activeElement).not.toBe(startButton())
  })

  it('focuses the first slot that is not adjacent to the moving row', async () => {
    // Tarp is at index 0, so slots 0 and 1 are both no-ops and entry focus has
    // to skip to slot 2 rather than landing on nothing. Slot 2 sits between
    // Stove and Pot, which is why the label names Pot.
    const user = userEvent.setup()
    render(<Harness onCommit={vi.fn()} startId="a" />)
    await user.click(startButton())
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Place Tarp before Pot' }),
    )
  })
})

describe('the mode closes when its slots go away', () => {
  it('cancels when the section holding the row stops rendering', async () => {
    // Collapsing a section unmounts its rows, so the mode would otherwise sit
    // open and invisible - live, but with no control anywhere on the page.
    // The same shape covers the row being promoted to a container, a remote
    // move into a collapsed bag, and an optimistically deleted location: all
    // of them end with no usable slot mounted.
    const user = userEvent.setup()
    function CollapsibleHarness() {
      const { placement, actions } = usePlacement(vi.fn())
      const [collapsed, setCollapsed] = useState(false)
      return (
        <PlacementProvider placement={placement} actions={actions}>
          <button type="button" onClick={() => actions.start(rows[1]!, mainPack, null)}>start</button>
          <button type="button" onClick={() => setCollapsed(true)}>collapse</button>
          <span data-testid="state">{placement ? 'placing' : 'idle'}</span>
          <DndContext>
            {collapsed ? null : packingSortableRows(gearItems, rowProps, mainPack)}
          </DndContext>
        </PlacementProvider>
      )
    }
    render(<CollapsibleHarness />)

    await user.click(startButton())
    expect(screen.getByTestId('state')).toHaveTextContent('placing')

    await user.click(screen.getByRole('button', { name: 'collapse' }))
    expect(screen.getByTestId('state')).toHaveTextContent('idle')
  })

  it('cancels when the row is rehomed into another bag mid-placement', async () => {
    // The counter alone cannot catch this: the old section's slots unregister
    // and the new section's register in the SAME commit, so the count never
    // transitions to zero. Binding the mode to the section it started in is
    // what ends it - otherwise the next click would reorder a cohort the user
    // never chose, in a bag they were not looking at.
    const user = userEvent.setup()
    const moved = item('b', 'Stove', 10)
    function RehomingHarness() {
      const { placement, actions } = usePlacement(vi.fn())
      const [rehomed, setRehomed] = useState(false)
      const here = rehomed ? [gearItems[0]!, gearItems[2]!] : gearItems
      const there = rehomed ? [item('x', 'Fuel', 0), moved] : [item('x', 'Fuel', 0)]
      return (
        <PlacementProvider placement={placement} actions={actions}>
          <button type="button" onClick={() => actions.start(rows[1]!, mainPack, null)}>start</button>
          <button type="button" onClick={() => setRehomed(true)}>rehome</button>
          <span data-testid="state">{placement ? 'placing' : 'idle'}</span>
          <DndContext>
            {packingSortableRows(here, rowProps, mainPack)}
            {packingSortableRows(there, rowProps, sidePocket)}
          </DndContext>
        </PlacementProvider>
      )
    }
    render(<RehomingHarness />)

    await user.click(startButton())
    expect(screen.getByTestId('state')).toHaveTextContent('placing')

    // Another tab moved Stove into Side pocket. Both sections stay mounted.
    await user.click(screen.getByRole('button', { name: 'rehome' }))
    expect(screen.getByTestId('state')).toHaveTextContent('idle')
    expect(slots()).toHaveLength(0)
  })
})

describe('placement reaches slots through a memo bailout', () => {
  it('updates a slot under a memoized parent that does not re-render', async () => {
    // This is the whole reason placement travels by context. In an isolated
    // fixture with stable props the parent genuinely bails out; the slot still
    // has to appear. (In the real page renderPackRowAction is rebuilt every
    // render and already defeats every pack section's memo, so this could not
    // be asserted against production render behavior.)
    const user = userEvent.setup()
    const parentRenders = vi.fn()
    // Hoisted: an inline rows.slice() would be a fresh array every render and
    // would defeat the memo by itself, which is the very failure being tested.
    const stableItems = rows.slice(0, 2)
    const Section = memo(function Section({ items }: { items: PackRow[] }) {
      parentRenders()
      return (
        <>
          <PlacementSlot slot={0} rows={items} section={mainPack} />
          <PlacementSlot slot={1} rows={items} section={mainPack} />
          <PlacementSlot slot={2} rows={items} section={mainPack} />
        </>
      )
    })
    function Fixture() {
      const { placement, actions } = usePlacement(vi.fn())
      return (
        <PlacementProvider placement={placement} actions={actions}>
          <button type="button" onClick={() => actions.start(rows[0]!, mainPack, null)}>start</button>
          <Section items={stableItems} />
        </PlacementProvider>
      )
    }
    render(<Fixture />)
    expect(parentRenders).toHaveBeenCalledTimes(1)

    await user.click(startButton())

    expect(screen.getByRole('button', { name: 'Place Tarp at the end of Main pack' }))
      .toBeInTheDocument()
    // The section itself never re-rendered - only the slots did.
    expect(parentRenders).toHaveBeenCalledTimes(1)
  })
})
