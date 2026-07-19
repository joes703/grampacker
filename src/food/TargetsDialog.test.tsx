// @vitest-environment jsdom
import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import TargetsDialog from './TargetsDialog'
import {
  saveTargetsRequestSchema,
  type FoodPlanDailyTarget,
  type Meal,
  type MealTarget,
  type SaveTargetsRequest,
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
    // The edited bound converts to canonical kcal/g ROUNDED to the 4dp
    // storage scale - the raw conversion (120 / 28.3495 = 4.23288...) would
    // fail the server's targetBoundSchema scale refine.
    expect(density.targetMin).toBe(Math.round((120 / ozToGrams(1)) * 10_000) / 10_000)
  })

  it('validates against the ACTUAL outgoing bounds, not re-parsed display strings', () => {
    unitRef.current = 'oz'
    // Stored canonical density min 4.2333 kcal/g displays as 120.01 kcal/oz,
    // which re-parses to 4.2332 - BELOW the stored value. Switching min ->
    // range (min field untouched) and entering that same display value as the
    // max builds a payload of {min: 4.2333 (preserved), max: 4.2332}, which
    // the server rejects. Validation must see the preserved min and block.
    render(
      <TargetsDialog
        meals={noMeals}
        dailyTargets={[dailyTarget({ metric: 'calorie_density', mode: 'min', targetMin: 4.2333 })]}
        mealTargets={[]}
        saveError={null}
        onSave={() => {}}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Calorie density (kcal/oz) mode'), { target: { value: 'range' } })
    fireEvent.change(screen.getByLabelText('Calorie density (kcal/oz) maximum'), { target: { value: '120.01' } })
    expect(screen.getByText('Min must be <= max')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save targets' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a mode transition keeps the untouched bound canonical and the payload schema-valid', () => {
    unitRef.current = 'oz'
    const onSave = vi.fn()
    render(
      <TargetsDialog
        meals={noMeals}
        dailyTargets={[dailyTarget({ metric: 'calorie_density', mode: 'min', targetMin: 4.2333 })]}
        mealTargets={[]}
        saveError={null}
        onSave={onSave}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Calorie density (kcal/oz) mode'), { target: { value: 'range' } })
    fireEvent.change(screen.getByLabelText('Calorie density (kcal/oz) maximum'), { target: { value: '130' } })
    save()
    const density = payloadOf(onSave).daily.find((u) => u.metric === 'calorie_density')!
    expect(density.mode).toBe('range')
    expect(density.targetMin).toBe(4.2333) // exact stored canonical, min field untouched
    expect(saveTargetsRequestSchema.safeParse(payloadOf(onSave)).success).toBe(true)
  })

  it('blocks a bound at or above the 1e8 magnitude cap', () => {
    render(
      <TargetsDialog meals={noMeals} dailyTargets={[]} mealTargets={[]} saveError={null} onSave={() => {}} onClose={() => {}} />,
    )
    fireEvent.change(screen.getByLabelText('Calories mode'), { target: { value: 'min' } })
    fireEvent.change(screen.getByLabelText('Calories minimum'), { target: { value: '100000000' } })
    expect(screen.getByText('Must be less than 100,000,000')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save targets' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('cannot be dismissed while a save is in flight', () => {
    const onClose = vi.fn()
    render(
      <TargetsDialog meals={noMeals} dailyTargets={[]} mealTargets={[]} saving saveError={null} onSave={() => {}} onClose={onClose} />,
    )
    const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement
    expect(cancel.disabled).toBe(true)
    fireEvent.click(cancel)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('prevents the native Escape cancel while saving and recovers from a force-close', () => {
    const onClose = vi.fn()
    render(
      <TargetsDialog meals={noMeals} dailyTargets={[]} mealTargets={[]} saving saveError={null} onSave={() => {}} onClose={onClose} />,
    )
    const dialog = document.querySelector('dialog')!
    // Escape fires a CANCELABLE `cancel` event BEFORE the dialog closes; the
    // guard must preventDefault it there - a guard on the close side runs
    // after the native dialog is already gone, leaving the parent's open
    // state pointing at a hidden dialog. fireEvent returns false when the
    // event was defaultPrevented.
    expect(fireEvent(dialog, new Event('cancel', { cancelable: true }))).toBe(false)
    expect(dialog.open).toBe(true)
    // A force-dismiss (e.g. a close watcher skipping the second Escape's
    // cancel) can close the native dialog anyway: the modal must reopen and
    // swallow the close instead of desyncing from the parent state.
    dialog.close()
    fireEvent(dialog, new Event('close'))
    expect(dialog.open).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Escape still dismisses when no save is in flight', () => {
    const onClose = vi.fn()
    render(
      <TargetsDialog meals={noMeals} dailyTargets={[]} mealTargets={[]} saveError={null} onSave={() => {}} onClose={onClose} />,
    )
    const dialog = document.querySelector('dialog')!
    expect(fireEvent(dialog, new Event('cancel', { cancelable: true }))).toBe(true)
    dialog.close()
    fireEvent(dialog, new Event('close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('every submitted payload passes the server schema (scale included)', () => {
    unitRef.current = 'oz'
    const onSave = vi.fn()
    render(
      <TargetsDialog meals={noMeals} dailyTargets={[]} mealTargets={[]} saveError={null} onSave={onSave} onClose={() => {}} />,
    )
    // An oz density entry and a long-decimal gram entry: both must land
    // 4dp-clean or the 7a PUT would 400 on targetBoundSchema.
    fireEvent.change(screen.getByLabelText('Calorie density (kcal/oz) mode'), { target: { value: 'min' } })
    fireEvent.change(screen.getByLabelText('Calorie density (kcal/oz) minimum'), { target: { value: '127.3' } })
    fireEvent.change(screen.getByLabelText('Protein (g) mode'), { target: { value: 'min' } })
    fireEvent.change(screen.getByLabelText('Protein (g) minimum'), { target: { value: '100.123456' } })
    save()
    const parsed = saveTargetsRequestSchema.safeParse(payloadOf(onSave))
    expect(parsed.success).toBe(true)
  })

  it('freezes the opening unit: a unit change while open does not corrupt untouched rows', () => {
    const onSave = vi.fn()
    const props = {
      meals: noMeals,
      dailyTargets: [dailyTarget({ metric: 'calorie_density', mode: 'min', targetMin: 4.5 })],
      mealTargets: [],
      saveError: null,
      onSave,
      onClose: () => {},
    }
    const view = render(<TargetsDialog {...props} />)
    unitRef.current = 'oz' // unit toggle WHILE the modal is open
    // Explicit rerender so the component demonstrably sees the new live unit
    // and must IGNORE it: the frozen density label proves the render path
    // reads the snapshot, not useWeightUnit's current value.
    view.rerender(<TargetsDialog {...props} />)
    expect(screen.getByLabelText('Calorie density (kcal/g) mode')).toBeTruthy()
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
