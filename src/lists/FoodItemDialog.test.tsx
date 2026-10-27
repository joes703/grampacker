// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FoodItemDialog from './FoodItemDialog'
import { shimDialog } from './test/list-detail-harness'
import type { FoodItemResponse, FoodSlotResponse } from '../../shared/food'

beforeAll(shimDialog)
afterEach(cleanup)

const slot = (id: string, dayNumber: number, meal: FoodSlotResponse['meal']): FoodSlotResponse => ({
  id,
  dayNumber,
  meal,
})

// Two full days, breakfast/lunch/dinner each.
const twoDays = [
  slot('d1b', 1, 'breakfast'),
  slot('d1l', 1, 'lunch'),
  slot('d1d', 1, 'dinner'),
  slot('d2b', 2, 'breakfast'),
  slot('d2l', 2, 'lunch'),
  slot('d2d', 2, 'dinner'),
]

function makeItem(overrides: Partial<FoodItemResponse> = {}): FoodItemResponse {
  return {
    id: 'food-1',
    name: 'Fruit bar',
    weightGrams: 30,
    quantity: 2,
    isPerMeal: true,
    unitCount: 4,
    sortOrder: 0,
    isPacked: false,
    isReady: false,
    packingLocationId: null,
    packSortOrder: 0,
    slotIds: ['d1l', 'd2l'],
    ...overrides,
  }
}

type Overrides = Partial<Parameters<typeof FoodItemDialog>[0]>

function renderAdd(overrides: Overrides = {}) {
  const props = {
    mode: { kind: 'add' as const, initialSlotIds: [] as string[] },
    slots: twoDays,
    weightUnit: 'g' as const,
    busy: false,
    saveError: null,
    onClose: vi.fn(),
    onCreate: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  const view = render(<FoodItemDialog {...props} />)
  return { props, view }
}

function renderEdit(item = makeItem(), overrides: Overrides = {}) {
  return renderAdd({ mode: { kind: 'edit', item }, ...overrides })
}

describe('add mode', () => {
  it('submits the exact payload: trimmed name, per-meal default, picked slots', async () => {
    const user = userEvent.setup()
    const { props } = renderAdd()

    await user.type(screen.getByLabelText('Name'), '  Oatmeal  ')
    await user.type(screen.getByLabelText('Weight (one item)'), '80')
    await user.click(screen.getByRole('checkbox', { name: 'Breakfast day 1' }))
    await user.click(screen.getByRole('checkbox', { name: 'Breakfast day 2' }))
    await user.click(screen.getByRole('button', { name: 'Add food' }))

    expect(props.onCreate).toHaveBeenCalledWith({
      name: 'Oatmeal',
      weightGrams: 80,
      quantity: 1,
      isPerMeal: true,
      slotIds: ['d1b', 'd2b'],
    })
    // The dialog never closes itself on submit; the caller closes on success.
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('the "Every day" checkbox selects and clears a whole meal column', async () => {
    const user = userEvent.setup()
    const { props } = renderAdd()

    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.click(screen.getByRole('checkbox', { name: 'Every lunch' }))
    expect(screen.getByRole('checkbox', { name: 'Lunch day 1' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Lunch day 2' })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Add food' }))
    expect(props.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ slotIds: ['d1l', 'd2l'] }),
    )

    await user.click(screen.getByRole('checkbox', { name: 'Every lunch' }))
    expect(screen.getByRole('checkbox', { name: 'Lunch day 1' })).not.toBeChecked()
  })

  it('"one container" flips the mode, the quantity suffix, and the summary', async () => {
    const user = userEvent.setup()
    const { props } = renderAdd()

    await user.type(screen.getByLabelText('Name'), 'Peanut butter')
    await user.click(screen.getByRole('checkbox', { name: 'Every lunch' }))
    expect(screen.getByText('per meal')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'One container for the whole trip' }))
    expect(screen.getByText('total')).toBeInTheDocument()
    expect(screen.getByText(/one container across 2 meals/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add food' }))
    expect(props.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ isPerMeal: false, quantity: 1 }),
    )
  })

  it('typed fields survive changing the meal selection', async () => {
    // Replaces the retired slot-union regression test: the hazard is the same
    // (selection churn must never eat the typed name and weight).
    const user = userEvent.setup()
    renderAdd()
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.type(screen.getByLabelText('Weight (one item)'), '80')
    await user.click(screen.getByRole('checkbox', { name: 'Every breakfast' }))
    await user.click(screen.getByRole('checkbox', { name: 'Dinner day 2' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Oatmeal')
    expect(screen.getByLabelText('Weight (one item)')).toHaveValue(80)
  })

  it('a slot pruned while the dialog is open leaves the summary and payload', async () => {
    const user = userEvent.setup()
    const { props, view } = renderAdd({
      mode: { kind: 'add', initialSlotIds: ['d1l', 'd2l'] },
    })
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    expect(screen.getByText(/1 per meal × 2 meals/)).toBeInTheDocument()

    // A focus refetch after the trip was shortened to one day elsewhere.
    const oneDay = twoDays.filter((s) => s.dayNumber === 1)
    view.rerender(<FoodItemDialog {...props} slots={oneDay} />)

    expect(screen.getByText(/1 per meal × 1 meal\b/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add food' }))
    expect(props.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ slotIds: ['d1l'] }),
    )
  })
})

describe('validation and busy', () => {
  it('disables submit for blank name, overlong name, and out-of-range quantity', () => {
    renderAdd()
    const submit = () => screen.getByRole('button', { name: 'Add food' })
    expect(submit()).toBeDisabled()
    // fireEvent.change bypasses maxLength so the JS bound itself is exercised.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'a'.repeat(129) } })
    expect(submit()).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Oatmeal' } })
    expect(submit()).toBeEnabled()
    fireEvent.change(screen.getByLabelText('How many'), { target: { value: '0' } })
    expect(submit()).toBeDisabled()
    fireEvent.change(screen.getByLabelText('How many'), { target: { value: '10000' } })
    expect(submit()).toBeDisabled()
  })

  it('freezes the fields and submit while busy, but never the way out', () => {
    renderEdit(makeItem(), { busy: true })
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove from plan' })).toBeDisabled()
    expect(screen.getByLabelText('Name')).toBeDisabled()
    // A hung request must not wall the user in: Cancel and Close stay live
    // (the "never gate the way out" rule).
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled()
  })

  it('clearing the name never changes the carried count', async () => {
    // The summary once read quantity through whole-form validity, so an
    // empty NAME mid-rename collapsed "You'll carry 4" to 2.
    const user = userEvent.setup()
    renderEdit() // quantity 2 across 2 lunches = 4 carried
    expect(screen.getByText(/2 per meal × 2 meals/)).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Name'))
    expect(screen.getByText(/2 per meal × 2 meals/)).toBeInTheDocument()
  })

  it('an out-of-range count swaps the summary for a hint instead of lying', () => {
    renderEdit()
    fireEvent.change(screen.getByLabelText('How many'), { target: { value: '0' } })
    expect(screen.queryByText(/You'll carry/)).not.toBeInTheDocument()
    expect(screen.getByText(/Enter how many/)).toBeInTheDocument()
  })
})

describe('edit mode', () => {
  it('seeds the form from the item and submits only the changed fields', async () => {
    const user = userEvent.setup()
    const { props } = renderEdit()

    expect(screen.getByLabelText('Name')).toHaveValue('Fruit bar')
    expect(screen.getByLabelText('How many')).toHaveValue(2)
    expect(screen.getByRole('checkbox', { name: 'Lunch day 1' })).toBeChecked()

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Fig bar')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(props.onSave).toHaveBeenCalledWith('food-1', { name: 'Fig bar' })
  })

  it('diffs against the item as the dialog OPENED, not the current props', async () => {
    // Another client changed the quantity mid-edit; a refetch updated props.
    // A name-only edit must not write the stale quantity back over it.
    const user = userEvent.setup()
    const { props, view } = renderEdit()

    view.rerender(
      <FoodItemDialog {...props} mode={{ kind: 'edit', item: makeItem({ quantity: 5 }) }} />,
    )
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Fig bar')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(props.onSave).toHaveBeenCalledWith('food-1', { name: 'Fig bar' })
  })

  it('an unchanged draft closes without writing', async () => {
    const user = userEvent.setup()
    const { props } = renderEdit()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(props.onSave).not.toHaveBeenCalled()
    expect(props.onClose).toHaveBeenCalled()
  })

  it('clearing every meal submits slotIds: [] - unschedule, not an omission', async () => {
    const user = userEvent.setup()
    const { props } = renderEdit()
    await user.click(screen.getByRole('checkbox', { name: 'Lunch day 1' }))
    await user.click(screen.getByRole('checkbox', { name: 'Lunch day 2' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(props.onSave).toHaveBeenCalledWith('food-1', { slotIds: [] })
  })

  it('Remove from plan calls onDelete and never onSave', async () => {
    const user = userEvent.setup()
    const { props } = renderEdit()
    await user.click(screen.getByRole('button', { name: 'Remove from plan' }))
    expect(props.onDelete).toHaveBeenCalledWith('food-1')
    expect(props.onSave).not.toHaveBeenCalled()
  })
})

describe('failure reporting', () => {
  it('renders the parent-owned save error as an alert and keeps the draft', async () => {
    const user = userEvent.setup()
    const { props, view } = renderEdit()
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Fig bar')

    view.rerender(
      <FoodItemDialog
        {...props}
        saveError="Couldn't confirm that change saved. Check the plan before trying again."
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Check the plan before trying again')
    expect(screen.getByLabelText('Name')).toHaveValue('Fig bar')
  })
})
