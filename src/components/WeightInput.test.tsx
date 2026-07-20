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

  it('accepts a typed tenth of a gram', async () => {
    // The reported bug: typing 12.4 in the add-item dialog was rounded away
    // to 12 before it ever reached the server.
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { getByLabelText } = render(<ControlledWeightInput onChangeSpy={onChange} />)

    const input = getByLabelText('Weight')
    await user.clear(input)
    await user.type(input, '12.4')

    expect((input as HTMLInputElement).value).toBe('12.4')
    expect(onChange).toHaveBeenLastCalledWith(12.4)
  })

  it('snaps input finer than a tenth onto the stored precision', async () => {
    // shared/gear.ts rejects more than one decimal, so the input must not
    // emit a value the server would refuse.
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { getByLabelText } = render(<ControlledWeightInput onChangeSpy={onChange} />)

    const input = getByLabelText('Weight')
    await user.clear(input)
    await user.type(input, '12.46')

    expect(onChange).toHaveBeenLastCalledWith(12.5)
  })

  it('does not drift a fractional value across a unit round trip', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { getByLabelText, getByRole } = render(
      <ControlledWeightInput initialGrams={12.4} onChangeSpy={onChange} />,
    )

    expect((getByLabelText('Weight') as HTMLInputElement).value).toBe('12.4')
    await user.click(getByRole('button', { name: 'Entering grams, switch to ounces' }))
    await user.click(getByRole('button', { name: 'Entering ounces, switch to grams' }))

    expect((getByLabelText('Weight') as HTMLInputElement).value).toBe('12.4')
  })

  it('converts typed ounce values to stored grams, keeping the tenth', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { getByLabelText, getByRole } = render(<ControlledWeightInput onChangeSpy={onChange} />)

    await user.click(getByRole('button', { name: 'Entering grams, switch to ounces' }))
    const input = getByLabelText('Weight')
    await user.clear(input)
    await user.type(input, '10.5')

    expect((input as HTMLInputElement).value).toBe('10.5')
    // 10.5 oz = 297.669... g. Previously rounded to a whole 298.
    expect(onChange).toHaveBeenLastCalledWith(297.7)
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
    // 2 oz = 56.7048... g.
    expect(onChange).toHaveBeenLastCalledWith(56.7)
  })
})
