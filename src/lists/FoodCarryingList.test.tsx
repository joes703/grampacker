// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FoodCarryingList from './FoodCarryingList'
import type { FoodItemResponse } from '../../shared/food'

afterEach(cleanup)

function item(over: Partial<FoodItemResponse> & { id: string; name: string }): FoodItemResponse {
  return {
    weightGrams: 100,
    quantity: 1,
    sortOrder: 0,
    slotIds: [],
    ...over,
  }
}

// One scheduled item (Ramen, 85 g), one unscheduled item (Trail mix, 240 g).
// 85 + 240 = 325 g, used by the totals-row test below.
const DEFAULT_ITEMS: FoodItemResponse[] = [
  item({ id: 'r1', name: 'Ramen', weightGrams: 85, quantity: 1, slotIds: ['s1'] }),
  item({ id: 't1', name: 'Trail mix', weightGrams: 240, quantity: 1, slotIds: [] }),
]

function renderList(overrides: {
  items?: readonly FoodItemResponse[]
  busy?: boolean
  onReschedule?: (itemId: string) => void
  onDelete?: (itemId: string) => void
} = {}) {
  const props = {
    items: overrides.items ?? DEFAULT_ITEMS,
    weightUnit: 'g' as const,
    busy: overrides.busy ?? false,
    onReschedule: overrides.onReschedule ?? vi.fn(),
    onDelete: overrides.onDelete ?? vi.fn(),
  }
  render(<FoodCarryingList {...props} />)
  return props
}

describe('FoodCarryingList schedule affordance', () => {
  it('labels Reschedule for a scheduled item and Schedule for an unscheduled one', () => {
    renderList()
    const ramenRow = screen.getByText('Ramen').closest('div')!
    const trailMixRow = screen.getByText('Trail mix').closest('div')!
    expect(within(ramenRow).getByRole('button', { name: 'Reschedule' })).toBeInTheDocument()
    expect(within(trailMixRow).getByRole('button', { name: 'Schedule' })).toBeInTheDocument()
  })

  it('calls onReschedule with the item id', async () => {
    const user = userEvent.setup()
    const props = renderList()
    const trailMixRow = screen.getByText('Trail mix').closest('div')!
    await user.click(within(trailMixRow).getByRole('button', { name: 'Schedule' }))
    expect(props.onReschedule).toHaveBeenCalledWith('t1')
  })
})

describe('FoodCarryingList delete', () => {
  it('wires the Remove <name> aria-label to onDelete with the item id', async () => {
    const user = userEvent.setup()
    const props = renderList()
    await user.click(screen.getByRole('button', { name: 'Remove Ramen' }))
    expect(props.onDelete).toHaveBeenCalledWith('r1')
  })
})

describe('FoodCarryingList quantity display', () => {
  it('shows the multiplier when carrying more than one unit', () => {
    renderList({
      items: [item({ id: 'i1', name: 'Jerky', weightGrams: 90, quantity: 2, slotIds: [] })],
    })
    const row = screen.getByText('Jerky').closest('div')!
    expect(within(row).getByText(/^2 ×/)).toBeInTheDocument()
  })

  it('omits the multiplier for a single carried unit', () => {
    renderList({
      items: [item({ id: 'i1', name: 'Jerky', weightGrams: 90, quantity: 1, slotIds: [] })],
    })
    const row = screen.getByText('Jerky').closest('div')!
    expect(within(row).queryByText(/^1 ×/)).not.toBeInTheDocument()
  })
})

describe('FoodCarryingList single list with badge', () => {
  it('renders one list with an Unscheduled badge instead of a duplicate section', () => {
    renderList() // one scheduled, one unscheduled item
    expect(screen.getAllByText('Ramen')).toHaveLength(1)
    const unscheduledRow = screen.getByText('Trail mix').closest('div')!
    expect(within(unscheduledRow).getByText('Unscheduled')).toBeInTheDocument()
    expect(screen.queryByText('Any time')).not.toBeInTheDocument()
  })
})

describe('FoodCarryingList totals row', () => {
  it('closes with an item count and total weight', () => {
    renderList() // 85 g + 240 g
    expect(screen.getByText('2 items')).toBeInTheDocument()
    expect(screen.getByLabelText('325 g')).toBeInTheDocument()
  })

  it('uses the singular for exactly one item', () => {
    renderList({ items: [item({ id: 'i1', name: 'Jerky', weightGrams: 90 })] })
    expect(screen.getByText('1 item')).toBeInTheDocument()
  })
})

describe('FoodCarryingList busy', () => {
  it('disables reschedule and delete controls while busy', () => {
    renderList({ busy: true })
    expect(screen.getByRole('button', { name: 'Reschedule' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Schedule' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove Ramen' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove Trail mix' })).toBeDisabled()
  })
})
