// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { useWeightUnit } from './use-weight-unit'
import { setWeightUnit } from './weight'

// Two independent consumers under one tree — exercises the multi-mount sync
// behavior that the per-consumer-useState version got wrong.
function TwoConsumers() {
  return (
    <>
      <ConsumerA />
      <ConsumerB />
    </>
  )
}

function ConsumerA() {
  const { weightUnit, toggleWeightUnit } = useWeightUnit()
  return (
    <button data-testid="a" onClick={toggleWeightUnit}>
      {weightUnit}
    </button>
  )
}

function ConsumerB() {
  const { weightUnit } = useWeightUnit()
  return <span data-testid="b">{weightUnit}</span>
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('useWeightUnit', () => {
  it('reads the persisted value on mount', () => {
    setWeightUnit('oz')
    const { getByTestId } = render(<TwoConsumers />)
    expect(getByTestId('a').textContent).toBe('oz')
    expect(getByTestId('b').textContent).toBe('oz')
  })

  it('updates every mounted consumer when one consumer toggles', () => {
    const { getByTestId } = render(<TwoConsumers />)
    expect(getByTestId('a').textContent).toBe('g')
    expect(getByTestId('b').textContent).toBe('g')

    act(() => {
      getByTestId('a').click()
    })
    expect(getByTestId('a').textContent).toBe('oz')
    expect(getByTestId('b').textContent).toBe('oz')
  })

  it('updates same-tab consumers when setWeightUnit is called imperatively', () => {
    const { getByTestId } = render(<TwoConsumers />)
    expect(getByTestId('b').textContent).toBe('g')

    act(() => {
      setWeightUnit('oz')
    })
    expect(getByTestId('a').textContent).toBe('oz')
    expect(getByTestId('b').textContent).toBe('oz')
  })

  it('reacts to cross-tab storage events', () => {
    const { getByTestId } = render(<TwoConsumers />)
    expect(getByTestId('b').textContent).toBe('g')

    act(() => {
      localStorage.setItem('weightUnit', 'oz')
      // The browser does not fire `storage` in the originating tab; simulate
      // an out-of-tab write by dispatching one ourselves.
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'weightUnit', newValue: 'oz' }),
      )
    })
    expect(getByTestId('b').textContent).toBe('oz')
  })

  it('ignores storage events for unrelated keys', () => {
    const { getByTestId } = render(<TwoConsumers />)

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'unrelated', newValue: 'whatever' }),
      )
    })
    expect(getByTestId('a').textContent).toBe('g')
    expect(getByTestId('b').textContent).toBe('g')
  })
})
