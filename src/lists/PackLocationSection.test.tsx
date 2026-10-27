// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DndContext, type DragStartEvent } from '@dnd-kit/core'
import type { ComponentProps } from 'react'
import type { ListItemWithGear, PackingLocation } from '../lib/types'
import PackSection from './PackSection'
import type { SharedPackSectionProps } from './section-parts'
import { PackLocationSection } from './PackLocationSection'
import { packingSortableRows, sortableRows } from './SortableCategoryRows'
import type { PackingTreeLocation } from './packing-tree'

afterEach(cleanup)

// A packing-location section is the pack checklist section, and it also
// carries the drag, drop and admin chrome. These tests cover that wiring -
// the parts that silently do nothing if a seam is only half-connected.

function item(id: string, name: string, overrides: Partial<ListItemWithGear> = {}): ListItemWithGear {
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
    sortOrder: 0,
    packSortOrder: 0,
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
      sortOrder: 0,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    ...overrides,
  }
}

function location(id: string, name: string, containerListItemId: string | null = null): PackingLocation {
  return { id, name, sortOrder: 0, containerListItemId }
}

function node(
  loc: PackingLocation,
  items: ListItemWithGear[],
  containerItem: ListItemWithGear | null = null,
): PackingTreeLocation {
  return {
    location: loc,
    containerItem,
    items,
    children: [],
    packProgressItems: containerItem ? [containerItem, ...items] : items,
  }
}

const groupProps: SharedPackSectionProps = {
  weightUnit: 'g',
  isBelowLg: false,
  renderRows: packingSortableRows,
}

function renderSection(overrides: Partial<ComponentProps<typeof PackLocationSection>> = {}) {
  const props: ComponentProps<typeof PackLocationSection> = {
    node: node(location('loc-1', 'Main pack'), [item('a', 'Tarp')]),
    depth: 0,
    groupProps,
    itemReorderPending: false,
    locationReorderPending: false,
    movePending: false,
    renaming: false,
    onStartRename: vi.fn(),
    onCancelRename: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  return {
    props,
    ...render(
      <DndContext>
        <PackLocationSection {...props} />
      </DndContext>,
    ),
  }
}

describe('PackLocationSection', () => {
  it('gives a plain location a reorder grip and an options menu', () => {
    renderSection()
    expect(screen.getByRole('button', { name: 'Drag Main pack to reorder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Main pack options' })).toBeInTheDocument()
  })

  it('still renders the checklist rows it wraps', () => {
    // The wrapper must not swallow the section: it IS the pack checklist now,
    // not a separate organizer surface.
    renderSection()
    expect(screen.getByText('Tarp')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Mark Tarp ready' })).toBeInTheDocument()
  })

  it('offers rename and delete from the options menu', async () => {
    const user = userEvent.setup()
    const onStartRename = vi.fn()
    const onDelete = vi.fn()
    renderSection({ onStartRename, onDelete })

    await user.click(screen.getByRole('button', { name: 'Main pack options' }))
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    expect(onStartRename).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Main pack options' }))
    await user.click(screen.getByRole('button', { name: 'Delete location' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('renames in place, replacing the title but keeping the section labeled', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    renderSection({ renaming: true, onRename })

    const input = screen.getByLabelText('Packing location name')
    await user.clear(input)
    await user.type(input, 'Top lid{Enter}')
    expect(onRename).toHaveBeenCalledWith('Top lid')
    // The collapse control still announces the section while it is being
    // renamed - `name` keeps supplying accessible labels even though the
    // rendered title is an input.
    // Pack headers have no collapse control - see PackSection. The section
    // still announces its name through the rename input's label.
  })

  it('does not write a rename that changes nothing', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    const onCancelRename = vi.fn()
    renderSection({ renaming: true, onRename, onCancelRename })

    await user.type(screen.getByLabelText('Packing location name'), '{Enter}')
    expect(onRename).not.toHaveBeenCalled()
    expect(onCancelRename).toHaveBeenCalled()
  })

  // Enter or Escape can be followed by a blur before the input goes away (the
  // parent re-renders later, or focus moves in the same task). The blur must
  // not save a second time, or turn a cancel into a save.
  it('saves once on Enter followed by blur', () => {
    const onRename = vi.fn()
    renderSection({ renaming: true, onRename })
    const input = screen.getByLabelText('Packing location name')
    fireEvent.change(input, { target: { value: 'Top lid' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(onRename).toHaveBeenCalledTimes(1)
  })

  it('does not save on Escape followed by blur', () => {
    const onRename = vi.fn()
    renderSection({ renaming: true, onRename })
    const input = screen.getByLabelText('Packing location name')
    fireEvent.change(input, { target: { value: 'Top lid' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)
    expect(onRename).not.toHaveBeenCalled()
  })

  it('withholds admin chrome from an unconfirmed optimistic location', () => {
    // A temp- id has no server row yet, so rename and delete have nothing to
    // address and dragging it would name a location that does not exist.
    renderSection({ node: node(location('temp-123', 'Pending'), []) })
    expect(screen.queryByRole('button', { name: 'Pending options' })).toBeNull()
  })

  describe('item-backed container', () => {
    const containerItem = item('canister', 'Bear canister', { packingLocationId: null })
    const containerNode = node(
      location('loc-2', 'Bear canister', 'canister'),
      [item('food', 'Food bag', { packingLocationId: 'loc-2' })],
      containerItem,
    )

    it('keeps BOTH identities: reorder the section and nest the backing item', () => {
      // The whole point of the dual identity. A wrapper that only registered
      // the section would silently remove container nesting - the backing item
      // would stop being a drag source and there would be no way to put one
      // container inside another.
      renderSection({ node: containerNode })
      expect(
        screen.getByRole('button', { name: 'Reorder Bear canister' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Move Bear canister into another container' }),
      ).toBeInTheDocument()
    })

    it('renders the backing item as the section header checklist row', () => {
      // The header IS the container's checklist row: its Packed checkbox is the
      // one that marks the container itself. Anchored on the drag grip rather
      // than a collapse chevron, because pack headers have none: a chevron
      // would sit in the rows' leading control column and push the header's
      // checkboxes out of line with the rows they label.
      renderSection({ node: containerNode })
      const header = screen
        .getByRole('button', { name: 'Reorder Bear canister' })
        .parentElement!
      expect(within(header).getByRole('checkbox', { name: 'Bear canister' })).toBeInTheDocument()
    })

    it('carries the injected container action for keyboard and touch', () => {
      // Drag is not reachable by keyboard for the nest handle, so the same
      // moves must exist as a menu.
      renderSection({
        node: containerNode,
        containerAction: <button type="button">container menu</button>,
      })
      expect(screen.getByRole('button', { name: 'container menu' })).toBeInTheDocument()
    })

    it('stays item-backed when its backing row is filtered out of the tree', async () => {
      // A WORN container item is extracted into the Worn section, so
      // buildPackingTree resolves containerItem to null (packing-tree.ts's
      // includeItem branch) and the plain component renders instead. The
      // LOCATION is still item-backed: its name belongs to the gear item and
      // the server rejects a rename. Offering Rename here sends the user into
      // a guaranteed failure, so the menu must read the location's
      // containerListItemId rather than whether the row happens to be shown.
      const user = userEvent.setup()
      const onDelete = vi.fn()
      renderSection({
        node: node(location('loc-2', 'Bear canister', 'canister'), [], null),
        onDelete,
      })

      await user.click(screen.getByRole('button', { name: 'Bear canister options' }))
      expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Delete location' })).toBeNull()

      await user.click(screen.getByRole('button', { name: 'Stop using as container' }))
      expect(onDelete).toHaveBeenCalledTimes(1)
    })
  })
})

describe('renderRows seams', () => {
  // The SortableContext registers one set of ids and each row's useSortable
  // registers its own. If they disagree, dnd-kit cannot find the dragged row in
  // its context: the drag starts, but the row has no index there, so no row
  // shifts and the planner gets an id from the wrong namespace. Nothing in the
  // UI shows this until a drag does nothing. So start a real keyboard drag and
  // check the id the row drags under and its place in the context.
  function startKeyboardDrag(renderRows: typeof sortableRows, grip: string) {
    const onDragStart = vi.fn<(event: DragStartEvent) => void>()
    render(
      <DndContext onDragStart={onDragStart}>
        <PackSection name="Main pack" items={[item('a', 'Tarp')]} weightUnit="g" isBelowLg={false} renderRows={renderRows} />
      </DndContext>,
    )
    const handle = screen.getByRole('button', { name: grip })
    handle.focus()
    fireEvent.keyDown(handle, { code: 'Space' })
    expect(onDragStart).toHaveBeenCalledTimes(1)
    const { active } = onDragStart.mock.calls[0]![0]
    return { id: active.id, index: active.data.current?.sortable?.index }
  }

  it('registers category rows under the item namespace', () => {
    expect(startKeyboardDrag(sortableRows, 'Reorder Tarp')).toEqual({ id: 'item:a', index: 0 })
  })

  it('registers pack rows under the packing-item namespace', () => {
    // Location grouping needs packing-item ids: that is the id space the
    // packing planner understands, and the one it shares with the
    // packing-location drop targets. Registering them as `item:` would leave
    // cross-location drags planning nothing.
    expect(startKeyboardDrag(packingSortableRows, 'Reorder or move Tarp')).toEqual({
      id: 'packing-item:a',
      index: 0,
    })
  })
})
