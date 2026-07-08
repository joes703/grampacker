// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import WeightInput from './WeightInput'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function ControlledWeightInput({
  initialGrams = 0,
  onChangeSpy,
}: {
  initialGrams?: number
  onChangeSpy?: (grams: number) => void
}) {
  const [grams, setGrams] = useState(initialGrams)

  return (
    <WeightInput
      grams={grams}
      onChange={(nextGrams) => {
        setGrams(nextGrams)
        onChangeSpy?.(nextGrams)
      }}
      ariaLabel="Weight"
    />
  )
}

describe('WeightInput', () => {
  it('enters gram values as integer grams', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { getByLabelText } = render(<ControlledWeightInput onChangeSpy={onChange} />)

    const input = getByLabelText('Weight')
    await user.clear(input)
    await user.type(input, '123')

    expect((input as HTMLInputElement).value).toBe('123')
    expect(onChange).toHaveBeenLastCalledWith(123)
  })

  it('converts typed ounce values to stored integer grams', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { getByLabelText, getByRole } = render(<ControlledWeightInput onChangeSpy={onChange} />)

    await user.click(getByRole('button', { name: 'Entering grams, switch to ounces' }))
    const input = getByLabelText('Weight')
    await user.clear(input)
    await user.type(input, '10.5')

    expect((input as HTMLInputElement).value).toBe('10.5')
    expect(onChange).toHaveBeenLastCalledWith(298)
  })

  it('honors an oz display preference when first mounted', async () => {
    localStorage.setItem('weightUnit', 'oz')
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { getByLabelText, getByRole } = render(<ControlledWeightInput onChangeSpy={onChange} />)

    expect(getByRole('button', { name: 'Entering ounces, switch to grams' }).textContent).toBe('oz')
    const input = getByLabelText('Weight')
    await user.clear(input)
    await user.type(input, '2')

    expect((input as HTMLInputElement).value).toBe('2')
    expect(onChange).toHaveBeenLastCalledWith(57)
  })
})
