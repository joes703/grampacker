// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FoodPlanPicker from './FoodPlanPicker'
import type { FoodPlanSummary } from '../../shared/food-plans'

afterEach(() => {
  cleanup()
})

function plan(overrides: Partial<FoodPlanSummary> & { id: string; name: string }): FoodPlanSummary {
  return {
    sortOrder: 0,
    dayCount: 3,
    entryCount: 12,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  }
}

const plans = [
  plan({ id: 'p-1', name: 'Summer 3-day', sortOrder: 0 }),
  plan({ id: 'p-2', name: 'Winter traverse', sortOrder: 1, dayCount: 1, entryCount: 1 }),
]

function renderPicker(
  overrides: {
    plans?: FoodPlanSummary[]
    isPending?: boolean
    isError?: boolean
    attachedPlanId?: string | null
    busy?: boolean
  } = {},
) {
  const onAttach = vi.fn()
  const onDetach = vi.fn()
  render(
    <FoodPlanPicker
      plans={overrides.plans ?? plans}
      isPending={overrides.isPending ?? false}
      isError={overrides.isError ?? false}
      attachedPlanId={overrides.attachedPlanId ?? null}
      busy={overrides.busy ?? false}
      onAttach={onAttach}
      onDetach={onDetach}
    />,
  )
  return { onAttach, onDetach }
}

describe('FoodPlanPicker', () => {
  // The Food side is "pick THE one plan for this trip", not gear's "add many".
  it('attaches the picked plan', () => {
    const { onAttach, onDetach } = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: /Summer 3-day/ }))
    expect(onAttach).toHaveBeenCalledWith('p-1')
    expect(onDetach).not.toHaveBeenCalled()
  })

  // Single-select: picking a different plan REPLACES the attached one rather
  // than adding a second. A list has one food_plan_id.
  it('attaches a different plan without detaching first', () => {
    const { onAttach, onDetach } = renderPicker({ attachedPlanId: 'p-1' })
    fireEvent.click(screen.getByRole('button', { name: /Winter traverse/ }))
    expect(onAttach).toHaveBeenCalledWith('p-2')
    expect(onDetach).not.toHaveBeenCalled()
  })

  it('detaches when the attached plan is picked again', () => {
    const { onAttach, onDetach } = renderPicker({ attachedPlanId: 'p-1' })
    fireEvent.click(screen.getByRole('button', { name: /Summer 3-day/ }))
    expect(onDetach).toHaveBeenCalledTimes(1)
    expect(onAttach).not.toHaveBeenCalled()
  })

  it('marks the attached plan as pressed', () => {
    renderPicker({ attachedPlanId: 'p-1' })
    expect(screen.getByRole('button', { name: /Summer 3-day/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /Winter traverse/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  // While a link write is in flight the whole picker is inert: both mutations
  // rewrite the same field of the same row, so a second click could let the
  // loser's response land last.
  it('does not fire while a link write is in flight', () => {
    const { onAttach } = renderPicker({ busy: true })
    fireEvent.click(screen.getByRole('button', { name: /Summer 3-day/ }))
    expect(onAttach).not.toHaveBeenCalled()
  })

  it('points at the Food page when there are no plans yet', () => {
    renderPicker({ plans: [] })
    expect(screen.getByText('No food plans yet.')).toBeInTheDocument()
  })

  it('distinguishes "no plans" from "no matches"', () => {
    renderPicker()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } })
    expect(screen.getByText('No matching plans.')).toBeInTheDocument()
  })

  // An empty list means "you have no plans" only once we have actually asked.
  // The cache is cold the first time the Food side is opened, so this is the
  // ordinary path, not an edge case.
  it('does not claim the user has no plans while the request is in flight', () => {
    renderPicker({ plans: [], isPending: true })
    expect(screen.queryByText('No food plans yet.')).not.toBeInTheDocument()
    expect(screen.getByText('Loading food plans…')).toBeInTheDocument()
  })

  it('says the request failed rather than that there is nothing to pick', () => {
    renderPicker({ plans: [], isError: true })
    expect(screen.queryByText('No food plans yet.')).not.toBeInTheDocument()
    expect(screen.getByText("Couldn't load your food plans.")).toBeInTheDocument()
  })
})
