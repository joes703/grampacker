// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import FoodPlanEntryRow from './FoodPlanEntryRow'
import { setWeightUnit } from '../lib/weight'
import type { FoodItem, FoodPlanEntry } from '../lib/types'

afterEach(cleanup)
afterEach(() => setWeightUnit('g'))

function makeFood(p: Partial<FoodItem> = {}): FoodItem {
  return {
    id: 'f1', user_id: 'u', name: 'Oats', brand: null, serving_description: null,
    serving_weight_grams: 50, calories_per_serving: 100, servings_per_package: null,
    fat_grams: null, saturated_fat_grams: null, carbs_grams: null, fiber_grams: null,
    sugar_grams: null, protein_grams: null, sodium_mg: null, potassium_mg: null,
    notes: null, sort_order: 0, created_at: '', updated_at: '', ...p,
  }
}

function makeEntry(p: Partial<FoodPlanEntry> = {}): FoodPlanEntry {
  return {
    id: 'e1', user_id: 'u', food_plan_id: 'p', day_meal_id: 'dm1', is_extra: false,
    food_item_id: 'f1', basis: 'servings', amount: 2, sort_order: 0, created_at: '', updated_at: '', ...p,
  }
}

// A < B in document order.
function precedes(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
}

describe('FoodPlanEntryRow', () => {
  it('renders Food | Quantity | Calories | Weight with weight anchored before the actions', () => {
    render(<FoodPlanEntryRow entry={makeEntry({ basis: 'servings', amount: 2 })} food={makeFood()} onEdit={vi.fn()} />)

    expect(screen.getByText('Oats')).toBeInTheDocument()
    // 2 servings; per-entry calories 2 x 100 = 200 kcal; weight 2 x 50 = 100 g.
    expect(screen.getByTestId('entry-quantity')).toHaveTextContent('2 servings')
    expect(screen.getByTestId('entry-calories')).toHaveTextContent('200 kcal')
    expect(screen.getByTestId('entry-weight')).toHaveTextContent('100 g')

    const qty = screen.getByTestId('entry-quantity')
    const cal = screen.getByTestId('entry-calories')
    const weight = screen.getByTestId('entry-weight')
    const kebab = screen.getByRole('button', { name: 'Entry options' })
    expect(precedes(qty, cal)).toBe(true)
    expect(precedes(cal, weight)).toBe(true)
    expect(precedes(weight, kebab)).toBe(true)
  })

  it('formats quantity by basis: servings, package -> servings, and grams', () => {
    const { rerender } = render(<FoodPlanEntryRow entry={makeEntry({ basis: 'servings', amount: 1 })} food={makeFood()} />)
    expect(screen.getByTestId('entry-quantity')).toHaveTextContent('1 serving')

    rerender(<FoodPlanEntryRow entry={makeEntry({ basis: 'packages', amount: 1 })} food={makeFood({ servings_per_package: 8 })} />)
    expect(screen.getByTestId('entry-quantity')).toHaveTextContent('1 package (8 serv)')

    rerender(<FoodPlanEntryRow entry={makeEntry({ basis: 'weight', amount: 30 })} food={makeFood()} />)
    expect(screen.getByTestId('entry-quantity')).toHaveTextContent('30 g')
  })

  it('renders weight in the selected unit', () => {
    setWeightUnit('oz')
    render(<FoodPlanEntryRow entry={makeEntry({ basis: 'servings', amount: 2 })} food={makeFood()} />)
    expect(screen.getByTestId('entry-weight')).toHaveTextContent(/oz/)
  })

  it('shows incomplete markers (never a fake zero) when the food definition is missing', () => {
    render(<FoodPlanEntryRow entry={makeEntry()} food={undefined} />)

    expect(screen.getByText('Missing food definition')).toBeInTheDocument()
    const cal = screen.getByTestId('entry-calories')
    expect(within(cal).queryByText(/kcal/)).not.toBeInTheDocument()
    expect(within(cal).getByRole('button', { name: /missing this nutrient/i })).toBeInTheDocument()
    const weight = screen.getByTestId('entry-weight')
    expect(within(weight).queryByText(/\bg\b/)).not.toBeInTheDocument()
    expect(within(weight).getByRole('button', { name: /missing definition/i })).toBeInTheDocument()
  })

  it('fires the kebab edit / move / copy / remove actions', () => {
    const onEdit = vi.fn(); const onMove = vi.fn(); const onCopy = vi.fn(); const onRemove = vi.fn()
    render(
      <FoodPlanEntryRow entry={makeEntry()} food={makeFood()} onEdit={onEdit} onMove={onMove} onCopy={onCopy} onRemove={onRemove} />,
    )

    const open = () => fireEvent.click(screen.getByRole('button', { name: 'Entry options' }))
    open(); fireEvent.click(screen.getByRole('menuitem', { name: 'Edit quantity' }))
    open(); fireEvent.click(screen.getByRole('menuitem', { name: 'Move to...' }))
    open(); fireEvent.click(screen.getByRole('menuitem', { name: 'Copy to...' }))
    open(); fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onMove).toHaveBeenCalledTimes(1)
    expect(onCopy).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('exposes Edit food item and fires onEditFood (withheld when the food is unknown)', () => {
    const onEditFood = vi.fn()
    const { rerender } = render(
      <FoodPlanEntryRow entry={makeEntry()} food={makeFood()} onEdit={vi.fn()} onEditFood={onEditFood} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Entry options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit food item' }))
    expect(onEditFood).toHaveBeenCalledTimes(1)

    // No resolved food definition -> the library-edit action is hidden so we
    // never open an empty dialog. Other actions still render.
    rerender(<FoodPlanEntryRow entry={makeEntry()} food={undefined} onEdit={vi.fn()} onEditFood={onEditFood} />)
    fireEvent.click(screen.getByRole('button', { name: 'Entry options' }))
    expect(screen.queryByRole('menuitem', { name: 'Edit food item' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Edit quantity' })).toBeInTheDocument()
  })

  it('renders no kebab in the read-only (no-callback) case', () => {
    render(<FoodPlanEntryRow entry={makeEntry()} food={makeFood()} />)
    expect(screen.queryByRole('button', { name: 'Entry options' })).not.toBeInTheDocument()
  })
})
