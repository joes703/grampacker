// @vitest-environment jsdom
import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import DefaultTargetsDialog from './DefaultTargetsDialog'
import type { TargetDefault } from '../lib/types'

const { unitRef } = vi.hoisted(() => ({ unitRef: { current: 'g' as 'g' | 'oz' } }))
vi.mock('../lib/use-weight-unit', () => ({ useWeightUnit: () => ({ weightUnit: unitRef.current }) }))
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.open = true }; HTMLDialogElement.prototype.close = function () { this.open = false } })
afterEach(() => { cleanup(); unitRef.current = 'g' })

const def = (over: Partial<TargetDefault> & Pick<TargetDefault, 'metric' | 'mode'>): TargetDefault =>
  ({ id: 'd', user_id: 'u', target_min: null, target_max: null, ...over })
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save defaults' }))

describe('DefaultTargetsDialog', () => {
  it('renders only daily metrics (no meal sections)', () => {
    render(<DefaultTargetsDialog defaults={[]} onSave={() => {}} onClose={() => {}} />)
    expect(screen.getByLabelText('Calories mode')).toBeInTheDocument()
    // Meal-only metrics and the per-meal "<Meal> targets" expand toggles must not
    // appear. (Do NOT assert on text /targets$/ - the "Daily targets" legend ends
    // in "targets" and would false-match.)
    expect(screen.queryByLabelText('Fat % mode')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sugar % mode')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /targets$/i })).not.toBeInTheDocument()
  })
  it('emits a dirty upsert', () => {
    const onSave = vi.fn()
    render(<DefaultTargetsDialog defaults={[]} onSave={onSave} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Calories mode'), { target: { value: 'max' } })
    fireEvent.change(screen.getByLabelText('Calories maximum'), { target: { value: '2500' } })
    save()
    expect(onSave.mock.calls[0]![0]).toEqual({
      upserts: [{ metric: 'calories', mode: 'max', target_min: null, target_max: 2500 }], deletes: [],
    })
  })
  it('emits a delete when an existing metric is switched to Off', () => {
    const onSave = vi.fn()
    render(<DefaultTargetsDialog defaults={[def({ metric: 'protein', mode: 'min', target_min: 100 })]} onSave={onSave} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Protein (g) mode'), { target: { value: 'off' } })
    save()
    expect(onSave.mock.calls[0]![0]).toEqual({ upserts: [], deletes: ['protein'] })
  })
  it('preserves the untouched density bound canonically when only one bound changes (oz)', () => {
    unitRef.current = 'oz'
    const onSave = vi.fn()
    render(<DefaultTargetsDialog defaults={[def({ metric: 'calorie_density', mode: 'range', target_min: 4.0, target_max: 5.0 })]} onSave={onSave} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Calorie density (kcal/oz) minimum'), { target: { value: '120' } })
    save()
    const u = onSave.mock.calls[0]![0].upserts.find((x: { metric: string }) => x.metric === 'calorie_density')
    expect(u.target_max).toBe(5.0)
  })
  it('freezes the opening unit: a later unit change does not corrupt untouched rows', () => {
    const onSave = vi.fn()
    render(<DefaultTargetsDialog defaults={[def({ metric: 'calorie_density', mode: 'min', target_min: 4.5 })]} onSave={onSave} onClose={() => {}} />)
    unitRef.current = 'oz'
    fireEvent.change(screen.getByLabelText('Protein (g) mode'), { target: { value: 'min' } })
    fireEvent.change(screen.getByLabelText('Protein (g) minimum'), { target: { value: '100' } })
    save()
    const p = onSave.mock.calls[0]![0]
    expect(p.upserts.some((x: { metric: string }) => x.metric === 'calorie_density')).toBe(false)
    expect(p.deletes).not.toContain('calorie_density')
  })
  it('blocks Save on a reversed range', () => {
    render(<DefaultTargetsDialog defaults={[]} onSave={() => {}} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Calories mode'), { target: { value: 'range' } })
    fireEvent.change(screen.getByLabelText('Calories minimum'), { target: { value: '3000' } })
    fireEvent.change(screen.getByLabelText('Calories maximum'), { target: { value: '2000' } })
    expect(screen.getByText('Min must be <= max')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save defaults' })).toBeDisabled()
  })
})
