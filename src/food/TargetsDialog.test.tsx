// @vitest-environment jsdom
import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import TargetsDialog from './TargetsDialog'
import type {
  FoodPlanDailyTarget,
  Meal,
  MealTarget,
  SaveTargetsRequest,
} from '../../shared/food-plans'
import { ozToGrams } from '../lib/weight'

const { unitRef } = vi.hoisted(() => ({ unitRef: { current: 'g' as 'g' | 'oz' } }))
vi.mock('../lib/use-weight-unit', () => ({
  useWeightUnit: () => ({ weightUnit: unitRef.current }),
}))

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
})
afterEach(() => {
  cleanup()
  unitRef.current = 'g'
})

const noMeals: Meal[] = []
const meal = (over: Partial<Meal> & { id: string; name: string }): Meal => ({
  anchorRole: null,
  isDefault: false,
  sortOrder: 0,
  ...over,
})
const dailyTarget = (
  over: Partial<FoodPlanDailyTarget> &
    Pick<FoodPlanDailyTarget, 'metric' | 'mode'>,
): FoodPlanDailyTarget => ({ id: 'd', targetMin: null, targetMax: null, ...over })
const mealTarget = (
  over: Partial<MealTarget> & Pick<MealTarget, 'mealId' | 'metric' | 'mode'>,
): MealTarget => ({ id: 't', targetMin: null, targetMax: null, ...over })
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save targets' }))
const payloadOf = (onSave: ReturnType<typeof vi.fn>): SaveTargetsRequest =>
  onSave.mock.calls[0]![0] as SaveTargetsRequest

describe('TargetsDialog', () => {
  it('submits the FULL daily array: an edit plus every untouched stored row', () => {
    const onSave = vi.fn()
    render(
      <TargetsDialog
        meals={noMeals}
        dailyTargets={[dailyTarget({ metric: 'protein', mode: 'min', targetMin: 100 })]}
        mealTargets={[]}
        saveError={null}
        onSave={onSave}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Calories mode'), { target: { value: 'max' } })
    fireEvent.change(screen.getByLabelText('Calories maximum'), { target: { value: '2500' } })
    save()
    const p = payloadOf(onSave)
    expect(p.daily).toEqual([
      { metric: 'calories', mode: 'max', targetMin: null, targetMax: 2500 },
      { metric: 'protein', mode: 'min', targetMin: 100, targetMax: null },
    ])
    expect(p.meals).toEqual([])
  })

  it('omits a stored metric switched to Off (full replace deletes it)', () => {
    const onSave = vi.fn()
    render(
      <TargetsDialog
        meals={noMeals}
        dailyTargets={[
          dailyTarget({ metric: 'protein', mode: 'min', targetMin: 100 }),
          dailyTarget({ id: 'd2', metric: 'calories', mode: 'max', targetMax: 3000 }),
        ]}
        mealTargets={[]}
        saveError={null}
        onSave={onSave}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Protein (g) mode'), { target: { value: 'off' } })
    save()
    const p = payloadOf(onSave)
    expect(p.daily).toEqual([
      { metric: 'calories', mode: 'max', targetMin: null, targetMax: 3000 },
    ])
  })

  it('resubmits an untouched calorie-density row with the EXACT canonical value', () => {
    const onSave = vi.fn()
    render(
      <TargetsDialog
        meals={noMeals}
        dailyTargets={[dailyTarget({ metric: 'calorie_density', mode: 'min', targetMin: 4.5 })]}
        mealTargets={[]}
        saveError={null}
        onSave={onSave}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Protein (g) mode'), { target: { value: 'min' } })
    fireEvent.change(screen.getByLabelText('Protein (g) minimum'), { target: { value: '100' } })
    save()
    const density = payloadOf(onSave).daily.find((u) => u.metric === 'calorie_density')
    expect(density).toEqual({ metric: 'calorie_density', mode: 'min', targetMin: 4.5, targetMax: null })
  })

  it('preserves the untouched density bound canonically when only one bound changes (oz)', () => {
    unitRef.current = 'oz'
    const onSave = vi.fn()
    // Stored canonical kcal/g range 4.0 - 5.0; the oz display strings are lossy.
    render(
      <TargetsDialog
        meals={noMeals}
        dailyTargets={[dailyTarget({ metric: 'calorie_density', mode: 'range', targetMin: 4.0, targetMax: 5.0 })]}
        mealTargets={[]}
        saveError={null}
        onSave={onSave}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Calorie density (kcal/oz) minimum'), { target: { value: '120' } })
    save()
    const density = payloadOf(onSave).daily.find((u) => u.metric === 'calorie_density')!
    expect(density.targetMax).toBe(5.0) // exact canonical, NOT a round-tripped display value
    expect(density.targetMin).toBeCloseTo(120 / ozToGrams(1), 6)
  })

  it('freezes the opening unit: a unit change while open does not corrupt untouched rows', () => {
    const onSave = vi.fn()
    render(
      <TargetsDialog
        meals={noMeals}
        dailyTargets={[dailyTarget({ metric: 'calorie_density', mode: 'min', targetMin: 4.5 })]}
        mealTargets={[]}
        saveError={null}
        onSave={onSave}
        onClose={() => {}}
      />,
    )
    unitRef.current = 'oz' // unit toggle WHILE the modal is open
    fireEvent.change(screen.getByLabelText('Protein (g) mode'), { target: { value: 'min' } })
    fireEvent.change(screen.getByLabelText('Protein (g) minimum'), { target: { value: '100' } })
    save()
    const density = payloadOf(onSave).daily.find((u) => u.metric === 'calorie_density')
    expect(density).toEqual({ metric: 'calorie_density', mode: 'min', targetMin: 4.5, targetMax: null })
  })

  it('submits the full meal array and omits meal rows switched to Off', () => {
    const onSave = vi.fn()
    const m = meal({ id: 'm1', name: 'Lunch' })
    render(
      <TargetsDialog
        meals={[m]}
        dailyTargets={[]}
        mealTargets={[mealTarget({ mealId: 'm1', metric: 'calories', mode: 'max', targetMax: 800 })]}
        saveError={null}
        onSave={onSave}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Lunch targets/ })) // expand
    const lunch = screen.getByRole('group', { name: /Lunch targets/ })
    fireEvent.change(within(lunch).getByLabelText('Fat % mode'), { target: { value: 'max' } })
    fireEvent.change(within(lunch).getByLabelText('Fat % maximum'), { target: { value: '30' } })
    fireEvent.change(within(lunch).getByLabelText('Calories mode'), { target: { value: 'off' } })
    save()
    expect(payloadOf(onSave).meals).toEqual([
      { mealId: 'm1', metric: 'fat_pct', mode: 'max', targetMin: null, targetMax: 30 },
    ])
  })

  it('mode drives which bound inputs are enabled', () => {
    render(
      <TargetsDialog meals={noMeals} dailyTargets={[]} mealTargets={[]} saveError={null} onSave={() => {}} onClose={() => {}} />,
    )
    const min = screen.getByLabelText('Calories minimum') as HTMLInputElement
    const max = screen.getByLabelText('Calories maximum') as HTMLInputElement
    expect(min.disabled).toBe(true) // off
    expect(max.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Calories mode'), { target: { value: 'min' } })
    expect((screen.getByLabelText('Calories minimum') as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByLabelText('Calories maximum') as HTMLInputElement).disabled).toBe(true)
  })

  it('blocks Save on a reversed range with an inline error', () => {
    render(
      <TargetsDialog meals={noMeals} dailyTargets={[]} mealTargets={[]} saveError={null} onSave={() => {}} onClose={() => {}} />,
    )
    fireEvent.change(screen.getByLabelText('Calories mode'), { target: { value: 'range' } })
    fireEvent.change(screen.getByLabelText('Calories minimum'), { target: { value: '3000' } })
    fireEvent.change(screen.getByLabelText('Calories maximum'), { target: { value: '2000' } })
    expect(screen.getByText('Min must be <= max')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save targets' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('blocks Save on a percent over 100', () => {
    const m = meal({ id: 'm1', name: 'Lunch' })
    render(
      <TargetsDialog meals={[m]} dailyTargets={[]} mealTargets={[]} saveError={null} onSave={() => {}} onClose={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Lunch targets/ }))
    fireEvent.change(screen.getByLabelText('Fat % mode'), { target: { value: 'max' } })
    fireEvent.change(screen.getByLabelText('Fat % maximum'), { target: { value: '150' } })
    expect(screen.getByText('Percent must be <= 100')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save targets' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('blocks Save on a negative bound and a missing range bound', () => {
    render(
      <TargetsDialog meals={noMeals} dailyTargets={[]} mealTargets={[]} saveError={null} onSave={() => {}} onClose={() => {}} />,
    )
    fireEvent.change(screen.getByLabelText('Protein (g) mode'), { target: { value: 'min' } })
    fireEvent.change(screen.getByLabelText('Protein (g) minimum'), { target: { value: '-5' } })
    expect(screen.getByText('Must be 0 or more')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Calories mode'), { target: { value: 'range' } })
    fireEvent.change(screen.getByLabelText('Calories minimum'), { target: { value: '2000' } })
    expect(screen.getByText('Enter both bounds')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save targets' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('rejects non-finite input', () => {
    render(
      <TargetsDialog meals={noMeals} dailyTargets={[]} mealTargets={[]} saveError={null} onSave={() => {}} onClose={() => {}} />,
    )
    fireEvent.change(screen.getByLabelText('Calories mode'), { target: { value: 'max' } })
    fireEvent.change(screen.getByLabelText('Calories maximum'), { target: { value: 'Infinity' } })
    expect((screen.getByRole('button', { name: 'Save targets' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the save error from the mutation', () => {
    render(
      <TargetsDialog
        meals={noMeals}
        dailyTargets={[]}
        mealTargets={[]}
        saveError="That didn't save."
        onSave={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText("That didn't save.")).toBeTruthy()
  })
})
