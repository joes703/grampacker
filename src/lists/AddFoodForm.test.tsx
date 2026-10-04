// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddFoodForm from './AddFoodForm'
import { foodWeightSchema, type FoodSlotResponse } from '../../shared/food'
import { MAX_ITEM_WEIGHT_GRAMS } from '../lib/caps'

afterEach(cleanup)

const slot = (id: string, dayNumber: number, meal: FoodSlotResponse['meal']): FoodSlotResponse => ({
  id,
  dayNumber,
  meal,
})

const breakfastSlots = [1, 2, 3, 4].map((d) => slot(`b${d}`, d, 'breakfast'))

type HarnessProps = {
  slots?: readonly FoodSlotResponse[]
  busy?: boolean
  weightUnit?: 'g' | 'oz'
  selectedSlotIds?: readonly string[]
  onSelectedSlotIdsChange?: (next: string[]) => void
  onCancel?: () => void
  onSubmit?: (
    input: { name: string; weightGrams: number; quantity: number; slotIds: string[] },
    onSuccess: () => void,
  ) => void
}

// Owns selectedSlotIds itself, mirroring how a real caller (FoodView) will:
// AddFoodForm must stay purely controlled, so exercising FoodSlotPicker
// interactions needs *something* above it holding the state.
function ControlledHarness(props: HarnessProps) {
  const [localSelected, setLocalSelected] = useState<string[]>(
    props.selectedSlotIds ? [...props.selectedSlotIds] : [],
  )
  return (
    <AddFoodForm
      slots={props.slots ?? []}
      busy={props.busy ?? false}
      weightUnit={props.weightUnit ?? 'g'}
      selectedSlotIds={props.selectedSlotIds ?? localSelected}
      onSelectedSlotIdsChange={props.onSelectedSlotIdsChange ?? setLocalSelected}
      onCancel={props.onCancel ?? vi.fn()}
      onSubmit={props.onSubmit ?? vi.fn()}
    />
  )
}

describe('AddFoodForm submit payload', () => {
  it('defaults quantity to 1 even when every breakfast is selected', async () => {
    // The bug this feature keeps trying to grow back: defaulting quantity to
    // the slot count would make one shared bag weigh four times too much.
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ControlledHarness slots={breakfastSlots} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.type(screen.getByLabelText('Weight'), '80')
    await user.click(screen.getByRole('button', { name: 'Every breakfast' }))

    expect(screen.getByLabelText('Qty')).toHaveValue(1)

    await user.click(screen.getByRole('button', { name: 'Add food' }))
    expect(onSubmit).toHaveBeenCalledWith(
      {
        name: 'Oatmeal',
        weightGrams: 80,
        quantity: 1,
        slotIds: ['b1', 'b2', 'b3', 'b4'],
      },
      // The form stays open until the write succeeds, so the caller hands
      // back a close/reset callback rather than the form closing on submit.
      expect.any(Function),
    )
  })

  it('submits the exact payload shape, reading slotIds from props', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <AddFoodForm
        slots={breakfastSlots}
        busy={false}
        weightUnit="g"
        selectedSlotIds={['b1', 'b3']}
        onSelectedSlotIdsChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText('Name'), '  Trail mix  ')
    await user.type(screen.getByLabelText('Weight'), '250')
    await user.clear(screen.getByLabelText('Qty'))
    await user.type(screen.getByLabelText('Qty'), '3')
    await user.click(screen.getByRole('button', { name: 'Add food' }))

    expect(onSubmit).toHaveBeenCalledWith(
      { name: 'Trail mix', weightGrams: 250, quantity: 3, slotIds: ['b1', 'b3'] },
      expect.any(Function),
    )
  })
})

describe('AddFoodForm validation bounds', () => {
  // Mirrors shared/food.ts. Weight is deliberately not tested here: WeightInput
  // clamps to MAX_ITEM_WEIGHT_GRAMS (100000) internally, which equals the
  // server's foodWeightSchema max, so a weight this form can even produce is
  // always in range - there is no way to drive it out of bounds through the UI.
  it('disables submit when the name is blank', () => {
    render(<ControlledHarness slots={breakfastSlots} />)
    expect(screen.getByRole('button', { name: 'Add food' })).toBeDisabled()
  })

  it('disables submit when the name exceeds 128 characters', () => {
    render(<ControlledHarness slots={breakfastSlots} />)
    // fireEvent.change bypasses the input's maxLength (a browser-typing-only
    // guard) so this exercises the JS validation itself, not the HTML attribute.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'a'.repeat(129) } })
    expect(screen.getByRole('button', { name: 'Add food' })).toBeDisabled()
  })

  it('disables submit when quantity is 0', () => {
    render(<ControlledHarness slots={breakfastSlots} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Oatmeal' } })
    fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '0' } })
    expect(screen.getByRole('button', { name: 'Add food' })).toBeDisabled()
  })

  it('disables submit when quantity exceeds 9999', () => {
    render(<ControlledHarness slots={breakfastSlots} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Oatmeal' } })
    fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '10000' } })
    expect(screen.getByRole('button', { name: 'Add food' })).toBeDisabled()
  })
})

describe('AddFoodForm busy state', () => {
  it('disables submit while busy, even with otherwise valid input', async () => {
    const user = userEvent.setup()
    render(<ControlledHarness slots={breakfastSlots} busy={true} />)
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    expect(screen.getByRole('button', { name: 'Add food' })).toBeDisabled()
  })
})

describe('AddFoodForm rejected submit', () => {
  it('keeps typed values when onSubmit never signals success', async () => {
    const user = userEvent.setup()
    // Simulates a rejected write (e.g. hitting the item cap): the caller
    // never invokes the success callback.
    const onSubmit = vi.fn()
    render(<ControlledHarness slots={breakfastSlots} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.type(screen.getByLabelText('Weight'), '80')
    await user.clear(screen.getByLabelText('Qty'))
    await user.type(screen.getByLabelText('Qty'), '3')
    await user.click(screen.getByRole('button', { name: 'Add food' }))

    expect(onSubmit).toHaveBeenCalled()
    expect(screen.getByLabelText('Name')).toHaveValue('Oatmeal')
    expect(screen.getByLabelText('Weight')).toHaveValue(80)
    expect(screen.getByLabelText('Qty')).toHaveValue(3)
  })
})

describe('AddFoodForm labels and preview', () => {
  it('labels every field and shows the unit toggle', () => {
    render(<ControlledHarness slots={breakfastSlots} />)
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Weight')).toBeInTheDocument()
    expect(screen.getByLabelText('Qty')).toBeInTheDocument()
    // WeightInput's unit toggle: "Entering grams, switch to ounces"
    expect(screen.getByRole('button', { name: /entering grams/i })).toBeInTheDocument()
  })

  it('assembles the live preview as fields fill', async () => {
    const user = userEvent.setup()
    render(<ControlledHarness slots={breakfastSlots} />)
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.type(screen.getByLabelText('Weight'), '80')
    expect(screen.getByText(/Adding: Oatmeal/)).toBeInTheDocument()
  })
})

describe('AddFoodForm controlled slot selection', () => {
  it('reflects the controlled slot selection', () => {
    render(<ControlledHarness slots={breakfastSlots} selectedSlotIds={['b2']} />)
    expect(screen.getByRole('button', { name: 'Breakfast day 2' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('reports selection changes instead of owning them', async () => {
    const user = userEvent.setup()
    const onSelectedSlotIdsChange = vi.fn()
    render(
      <ControlledHarness
        slots={breakfastSlots}
        selectedSlotIds={[]}
        onSelectedSlotIdsChange={onSelectedSlotIdsChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Breakfast day 2' }))
    expect(onSelectedSlotIdsChange).toHaveBeenCalledWith(['b2'])
  })
})

describe('AddFoodForm weight clamp coupling', () => {
  // The comment above (line 46-47) claims WeightInput's client clamp equals
  // the server's foodWeightSchema max. Nothing enforces that but a comment -
  // pin it so a change to either constant fails a test instead of silently
  // drifting.
  it('pins MAX_ITEM_WEIGHT_GRAMS to the foodWeightSchema max', () => {
    expect(foodWeightSchema.safeParse(MAX_ITEM_WEIGHT_GRAMS).success).toBe(true)
    expect(foodWeightSchema.safeParse(MAX_ITEM_WEIGHT_GRAMS + 1).success).toBe(false)
  })
})
