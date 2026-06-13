// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import CreateFoodPlanDialog from './CreateFoodPlanDialog'

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '')
    }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    }
  }
})

describe('CreateFoodPlanDialog', () => {
  it('keeps omitted cells aligned when the day count changes', () => {
    const onCreate = vi.fn()
    render(<CreateFoodPlanDialog onCreate={onCreate} onClose={vi.fn()} />)

    expect(screen.queryByLabelText(/Nights/i)).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Day 1 Breakfast' }))
    fireEvent.change(screen.getByLabelText('Days'), { target: { value: '2' } })

    expect((screen.getByRole('checkbox', { name: 'Day 1 Breakfast' }) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText('5 planned meals')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Start food plan' }))

    expect(onCreate).toHaveBeenCalledOnce()
    const [structure] = onCreate.mock.calls[0]!
    expect(structure.days).toHaveLength(2)
    expect(structure.dayMeals).toHaveLength(5)
  })
})
