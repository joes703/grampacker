// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EntryAmountDialog from './EntryAmountDialog'
import type { FoodItem } from '../lib/types'

afterEach(cleanup)

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})

function food(overrides: Partial<FoodItem> = {}): FoodItem {
  return {
    id: 'food-1',
    user_id: 'user-1',
    name: 'Energy bar',
    brand: null,
    serving_description: null,
    serving_weight_grams: 50,
    calories_per_serving: 100,
    servings_per_package: 4,
    fat_grams: null,
    saturated_fat_grams: null,
    carbs_grams: null,
    fiber_grams: null,
    sugar_grams: null,
    protein_grams: null,
    sodium_mg: null,
    potassium_mg: null,
    notes: null,
    sort_order: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('EntryAmountDialog', () => {
  it('shows derived servings, weight, and calories for a valid amount', async () => {
    const user = userEvent.setup()
    render(<EntryAmountDialog food={food()} onSave={vi.fn()} onClose={vi.fn()} />)

    await user.selectOptions(screen.getByLabelText('Measure by'), 'packages')
    const amount = screen.getByLabelText('Amount')
    await user.clear(amount)
    await user.type(amount, '2')

    expect(screen.getByText('= 8 servings - 400 g - 800 kcal')).toBeInTheDocument()
    expect(screen.getByText('Entered as packages - that basis is kept; the rest is derived from the library item.')).toBeInTheDocument()
  })

  it('hides derived values when the selected basis needs missing metadata', async () => {
    const user = userEvent.setup()
    render(<EntryAmountDialog food={food({ servings_per_package: null })} initial={{ basis: 'packages', amount: 2 }} onSave={vi.fn()} onClose={vi.fn()} />)

    await user.clear(screen.getByLabelText('Amount'))
    await user.type(screen.getByLabelText('Amount'), '2')

    expect(screen.queryByText(/servings - .* g - .* kcal/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Entered as packages/)).not.toBeInTheDocument()
  })

  it('hides derived values for an invalid amount', async () => {
    const user = userEvent.setup()
    render(<EntryAmountDialog food={food()} onSave={vi.fn()} onClose={vi.fn()} />)

    const amount = screen.getByLabelText('Amount')
    await user.clear(amount)
    await user.type(amount, '0')

    expect(screen.queryByText(/servings - .* g - .* kcal/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Entered as/)).not.toBeInTheDocument()
  })

  it('selects and clears all also-add days', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <EntryAmountDialog
        food={food()}
        alsoDays={[
          { id: 'dm-1', dayMealId: 'dm-1', label: 'Day 1' },
          { id: 'dm-2', dayMealId: 'dm-2', label: 'Day 2' },
          { id: 'dm-3', dayMealId: 'dm-3', label: 'Day 3' },
        ]}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'All days' }))
    expect(screen.getByLabelText('Day 1')).toBeChecked()
    expect(screen.getByLabelText('Day 2')).toBeChecked()
    expect(screen.getByLabelText('Day 3')).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByLabelText('Day 1')).not.toBeChecked()
    expect(screen.getByLabelText('Day 2')).not.toBeChecked()
    expect(screen.getByLabelText('Day 3')).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'All days' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      alsoDayMealIds: ['dm-1', 'dm-2', 'dm-3'],
    }))
  })

  it('shows the compatible-merge note only with also-add days', () => {
    const { rerender } = render(
      <EntryAmountDialog
        food={food()}
        alsoDays={[{ id: 'dm-1', dayMealId: 'dm-1', label: 'Day 1' }]}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Where the food already exists, compatible quantities merge.')).toBeInTheDocument()

    rerender(<EntryAmountDialog food={food()} onSave={vi.fn()} onClose={vi.fn()} />)

    expect(screen.queryByText('Where the food already exists, compatible quantities merge.')).not.toBeInTheDocument()
  })

  it('shows omitted also-add days as disabled with inline copy and excludes them from all-days selection', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <EntryAmountDialog
        food={food()}
        alsoDays={[
          { id: 'dm-1', dayMealId: 'dm-1', label: 'Day 1' },
          { id: 'day-2:meal-1', dayMealId: null, label: 'Day 2', omitted: true },
          { id: 'dm-3', dayMealId: 'dm-3', label: 'Day 3' },
        ]}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    )

    const omittedCheckbox = screen.getByRole('checkbox', { name: /Day 2/ })
    expect(omittedCheckbox).toBeDisabled()
    expect(omittedCheckbox).not.toHaveAttribute('title')
    expect(screen.getByText('omitted from this day')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All days' }))
    expect(screen.getByLabelText('Day 1')).toBeChecked()
    expect(omittedCheckbox).not.toBeChecked()
    expect(screen.getByLabelText('Day 3')).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      alsoDayMealIds: ['dm-1', 'dm-3'],
    }))
  })
})
