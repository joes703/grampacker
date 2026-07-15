// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import FoodItemDialog, { type FoodPatch } from './FoodItemDialog'

// <dialog>.showModal/close are not implemented in jsdom; Modal.tsx calls them.
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true
    }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      this.open = false
    }
  }
})

afterEach(cleanup)

// Fill the three required fields so a submit is otherwise valid, then let each
// test perturb one optional field. Returns the onSave spy.
function renderDialog() {
  const onSave = vi.fn<(patch: FoodPatch) => void>()
  render(<FoodItemDialog onSave={onSave} onClose={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ramen' } })
  fireEvent.change(screen.getByLabelText(/Serving weight/), {
    target: { value: '85' },
  })
  fireEvent.change(screen.getByLabelText(/Calories/), {
    target: { value: '380' },
  })
  return { onSave }
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Add food' }))
}

describe('FoodItemDialog validation', () => {
  it('blank optional fields submit as null (unknown), not 0', () => {
    const { onSave } = renderDialog()
    submit()
    expect(onSave).toHaveBeenCalledTimes(1)
    const patch = onSave.mock.calls[0]?.[0]
    expect(patch).toMatchObject({
      name: 'Ramen',
      servingWeightGrams: 85,
      caloriesPerServing: 380,
      servingsPerPackage: null,
      proteinGrams: null,
      sodiumMg: null,
    })
  })

  it('a negative optional value is REJECTED, never silently turned into null', () => {
    const { onSave } = renderDialog()
    fireEvent.change(screen.getByLabelText('Servings per package'), {
      target: { value: '-1' },
    })
    // Save disables the moment the payload is invalid (schema-derived).
    expect(
      screen.getByRole('button', { name: 'Add food' }).hasAttribute('disabled'),
    ).toBe(true)
    submit()
    // The load-bearing case: -1 must not become "unknown" (null).
    expect(onSave).not.toHaveBeenCalled()
  })

  it('a malformed optional lexeme is REJECTED, never turned into null', () => {
    // With a text input the raw "abc" survives to Number() -> NaN and is
    // rejected. A number input would have sanitized it to "" -> null, which is
    // exactly the conflation this guards against.
    const { onSave } = renderDialog()
    fireEvent.change(screen.getByLabelText('Servings per package'), {
      target: { value: 'abc' },
    })
    expect(
      screen.getByRole('button', { name: 'Add food' }).hasAttribute('disabled'),
    ).toBe(true)
    submit()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('a value with too many decimals is rejected even near the upper bound', () => {
    const { onSave } = renderDialog()
    fireEvent.change(screen.getByLabelText(/Calories/), {
      target: { value: '99999999.00999999' },
    })
    submit()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('zero serving weight is rejected (> 0, unlike calories)', () => {
    const { onSave } = renderDialog()
    fireEvent.change(screen.getByLabelText(/Serving weight/), {
      target: { value: '0' },
    })
    submit()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('too many decimal places is rejected', () => {
    const { onSave } = renderDialog()
    fireEvent.change(screen.getByLabelText(/Serving weight/), {
      target: { value: '1.2345' }, // numeric(10,3) allows 3
    })
    submit()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('an over-bounds value is rejected', () => {
    const { onSave } = renderDialog()
    fireEvent.change(screen.getByLabelText(/Calories/), {
      target: { value: '100000000' },
    })
    submit()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('save is disabled until the required fields are present', () => {
    const onSave = vi.fn()
    render(<FoodItemDialog onSave={onSave} onClose={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Add food' })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText(/Serving weight/), {
      target: { value: '10' },
    })
    fireEvent.change(screen.getByLabelText(/Calories/), {
      target: { value: '50' },
    })
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('a fractional value round-trips (REAL storage, IEEE-754 contract)', () => {
    const { onSave } = renderDialog()
    fireEvent.change(screen.getByLabelText(/Serving weight/), {
      target: { value: '13.5' },
    })
    fireEvent.change(screen.getByLabelText('Servings per package'), {
      target: { value: '1.5' },
    })
    submit()
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      servingWeightGrams: 13.5,
      servingsPerPackage: 1.5,
    })
  })
})
