// @vitest-environment jsdom
import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import TargetsDialog from './TargetsDialog'
import type { FoodPlan, Meal, FoodPlanDailyTarget, MealTarget } from '../lib/types'

const { unitRef } = vi.hoisted(() => ({ unitRef: { current: 'g' as 'g' | 'oz' } }))
vi.mock('../lib/use-weight-unit', () => ({ useWeightUnit: () => ({ weightUnit: unitRef.current }) }))

beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.open = true }; HTMLDialogElement.prototype.close = function () { this.open = false } })
afterEach(() => { cleanup(); unitRef.current = 'g' })
const plan = { id: 'p', user_id: 'u' } as FoodPlan
const noMeals: Meal[] = []
const meal = (over: Partial<Meal> & { id: string; name: string }): Meal => ({
  user_id: 'u', food_plan_id: 'p', anchor_role: null, is_default: false, sort_order: 0, created_at: '', updated_at: '', ...over,
})
const dailyTarget = (over: Partial<FoodPlanDailyTarget> & Pick<FoodPlanDailyTarget, 'metric' | 'mode'>): FoodPlanDailyTarget =>
  ({ id: 'd', user_id: 'u', food_plan_id: 'p', target_min: null, target_max: null, ...over })
const mealTarget = (over: Partial<MealTarget> & Pick<MealTarget, 'meal_id' | 'metric' | 'mode'>): MealTarget =>
  ({ id: 't', user_id: 'u', food_plan_id: 'p', target_min: null, target_max: null, ...over })
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save targets' }))

describe('TargetsDialog', () => {
  it('emits a dirty daily upsert', () => {
    const onSave = vi.fn()
    render(<TargetsDialog plan={plan} meals={noMeals} dailyTargets={[]} mealTargets={[]} onSave={onSave} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Calories mode'), { target: { value: 'max' } })
    fireEvent.change(screen.getByLabelText('Calories maximum'), { target: { value: '2500' } })
    save()
    expect(onSave.mock.calls[0]![0].dailyUpserts).toEqual([{ metric: 'calories', mode: 'max', target_min: null, target_max: 2500 }])
  })
  it('emits a delete when an existing metric is switched to Off', () => {
    const onSave = vi.fn()
    render(<TargetsDialog plan={plan} meals={noMeals} dailyTargets={[dailyTarget({ metric: 'protein', mode: 'min', target_min: 100 })]} mealTargets={[]} onSave={onSave} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Protein (g) mode'), { target: { value: 'off' } })
    save()
    expect(onSave.mock.calls[0]![0].dailyDeletes).toContain('protein')
    expect(onSave.mock.calls[0]![0].dailyUpserts).toEqual([])
  })
  it('does NOT re-send an untouched calorie-density row (whole-row drift guard)', () => {
    const onSave = vi.fn()
    render(<TargetsDialog plan={plan} meals={noMeals} dailyTargets={[dailyTarget({ metric: 'calorie_density', mode: 'min', target_min: 4.5 })]} mealTargets={[]} onSave={onSave} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Protein (g) mode'), { target: { value: 'min' } })
    fireEvent.change(screen.getByLabelText('Protein (g) minimum'), { target: { value: '100' } })
    save()
    const p = onSave.mock.calls[0]![0]
    expect(p.dailyUpserts.some((u: { metric: string }) => u.metric === 'calorie_density')).toBe(false)
    expect(p.dailyDeletes).not.toContain('calorie_density')
  })
  it('preserves the untouched density bound canonically when only one bound changes (oz)', () => {
    unitRef.current = 'oz'
    const onSave = vi.fn()
    // Stored canonical kcal/g range 4.0 - 5.0; in oz the display strings are lossy.
    render(<TargetsDialog plan={plan} meals={noMeals} dailyTargets={[dailyTarget({ metric: 'calorie_density', mode: 'range', target_min: 4.0, target_max: 5.0 })]} mealTargets={[]} onSave={onSave} onClose={() => {}} />)
    // Edit ONLY the min field; leave max untouched.
    fireEvent.change(screen.getByLabelText('Calorie density (kcal/oz) minimum'), { target: { value: '120' } })
    save()
    const upsert = onSave.mock.calls[0]![0].dailyUpserts.find((u: { metric: string }) => u.metric === 'calorie_density')
    expect(upsert.target_max).toBe(5.0) // exact canonical, NOT the round-tripped display value
  })
  it('freezes the opening unit: a unit change while open does not dirty or corrupt untouched rows', () => {
    const onSave = vi.fn()
    // Open in g (default) with a stored density target.
    render(<TargetsDialog plan={plan} meals={noMeals} dailyTargets={[dailyTarget({ metric: 'calorie_density', mode: 'min', target_min: 4.5 })]} mealTargets={[]} onSave={onSave} onClose={() => {}} />)
    unitRef.current = 'oz' // simulate a unit toggle / query refetch WHILE the modal is open
    // Edit a DIFFERENT metric, which re-renders the component under the new unit.
    fireEvent.change(screen.getByLabelText('Protein (g) mode'), { target: { value: 'min' } })
    fireEvent.change(screen.getByLabelText('Protein (g) minimum'), { target: { value: '100' } })
    save()
    const p = onSave.mock.calls[0]![0]
    // The frozen snapshot means the untouched density row is neither re-sent nor corrupted.
    expect(p.dailyUpserts.some((u: { metric: string }) => u.metric === 'calorie_density')).toBe(false)
    expect(p.dailyDeletes).not.toContain('calorie_density')
  })
  it('blocks Save on a reversed range with an inline error', () => {
    render(<TargetsDialog plan={plan} meals={noMeals} dailyTargets={[]} mealTargets={[]} onSave={() => {}} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Calories mode'), { target: { value: 'range' } })
    fireEvent.change(screen.getByLabelText('Calories minimum'), { target: { value: '3000' } })
    fireEvent.change(screen.getByLabelText('Calories maximum'), { target: { value: '2000' } })
    expect(screen.getByText('Min must be <= max')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save targets' })).toBeDisabled()
  })
  it('blocks Save on a percent over 100', () => {
    const m = meal({ id: 'm1', name: 'Lunch' })
    render(<TargetsDialog plan={plan} meals={[m]} dailyTargets={[]} mealTargets={[]} onSave={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Lunch targets/ })) // expand the meal section
    fireEvent.change(screen.getByLabelText('Fat % mode'), { target: { value: 'max' } })
    fireEvent.change(screen.getByLabelText('Fat % maximum'), { target: { value: '150' } })
    expect(screen.getByText('Percent must be <= 100')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save targets' })).toBeDisabled()
  })
  it('emits a mealUpsert when a meal target is edited', () => {
    const onSave = vi.fn()
    const m = meal({ id: 'm1', name: 'Lunch' })
    render(<TargetsDialog plan={plan} meals={[m]} dailyTargets={[]} mealTargets={[]} onSave={onSave} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Lunch targets/ })) // expand
    fireEvent.change(screen.getByLabelText('Fat % mode'), { target: { value: 'max' } })
    fireEvent.change(screen.getByLabelText('Fat % maximum'), { target: { value: '30' } })
    save()
    expect(onSave.mock.calls[0]![0].mealUpserts).toEqual([
      { meal_id: 'm1', metric: 'fat_pct', mode: 'max', target_min: null, target_max: 30 },
    ])
  })
  it('emits a mealDelete when an existing meal target is switched to Off', () => {
    const onSave = vi.fn()
    const m = meal({ id: 'm1', name: 'Lunch' })
    render(<TargetsDialog plan={plan} meals={[m]} dailyTargets={[]} mealTargets={[mealTarget({ meal_id: 'm1', metric: 'fat_pct', mode: 'max', target_max: 30 })]} onSave={onSave} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Lunch targets/ })) // expand
    fireEvent.change(screen.getByLabelText('Fat % mode'), { target: { value: 'off' } })
    save()
    expect(onSave.mock.calls[0]![0].mealDeletes).toEqual([{ meal_id: 'm1', metric: 'fat_pct' }])
    expect(onSave.mock.calls[0]![0].mealUpserts).toEqual([])
  })
  it('blocks Save on a negative bound', () => {
    render(<TargetsDialog plan={plan} meals={noMeals} dailyTargets={[]} mealTargets={[]} onSave={() => {}} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Protein (g) mode'), { target: { value: 'min' } })
    fireEvent.change(screen.getByLabelText('Protein (g) minimum'), { target: { value: '-5' } })
    expect(screen.getByText('Must be 0 or more')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save targets' })).toBeDisabled()
  })
  it('blocks Save on a range missing a bound', () => {
    render(<TargetsDialog plan={plan} meals={noMeals} dailyTargets={[]} mealTargets={[]} onSave={() => {}} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Calories mode'), { target: { value: 'range' } })
    fireEvent.change(screen.getByLabelText('Calories minimum'), { target: { value: '2000' } })
    expect(screen.getByText('Enter both bounds')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save targets' })).toBeDisabled()
  })
  it('does not validate non-finite input', () => {
    render(<TargetsDialog plan={plan} meals={noMeals} dailyTargets={[]} mealTargets={[]} onSave={() => {}} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Calories mode'), { target: { value: 'max' } })
    fireEvent.change(screen.getByLabelText('Calories maximum'), { target: { value: 'Infinity' } })
    expect(screen.getByRole('button', { name: 'Save targets' })).toBeDisabled()
  })
})
