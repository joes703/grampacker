// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import GearItemDialog from './GearItemDialog'
import { shimDialog } from '../../lists/test/list-detail-harness'

beforeAll(shimDialog)
afterEach(cleanup)

function renderNew() {
  const onSave = vi.fn()
  render(<GearItemDialog categories={[]} onSave={onSave} onClose={() => {}} />)
  fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Tent' } })
  return onSave
}

// The server refuses a cost above its maximum. The form says so before
// saving, instead of the user meeting a failed save.
describe('GearItemDialog cost', () => {
  it('refuses a cost above the maximum, without saving', () => {
    const onSave = renderNew()
    fireEvent.change(screen.getByLabelText(/Cost/), { target: { value: '100000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Cost must be $99,999,999.99 or less.')
  })

  it('saves a cost at the maximum, and an empty cost as unknown', () => {
    const onSave = renderNew()
    fireEvent.change(screen.getByLabelText(/Cost/), { target: { value: '99999999.99' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ cost: 99999999.99 })

    fireEvent.change(screen.getByLabelText(/Cost/), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(onSave.mock.calls[1]?.[0]).toMatchObject({ cost: null })
  })

  it('clears the cost error once the cost is corrected', () => {
    renderNew()
    fireEvent.change(screen.getByLabelText(/Cost/), { target: { value: '100000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Cost/), { target: { value: '10' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
