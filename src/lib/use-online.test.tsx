// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { useOnline } from './use-online'

// Harness exposes the hook's current value via data-attribute so tests can
// read it without React Testing Library queries needing the DOM tree.
function Harness() {
  const online = useOnline()
  return <div data-testid="status" data-online={online ? 'yes' : 'no'} />
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function setNavigatorOnline(value: boolean) {
  // navigator.onLine is read-only on the prototype; redefine on the
  // instance for the test scope.
  Object.defineProperty(window.navigator, 'onLine', {
    value,
    configurable: true,
  })
}

describe('useOnline', () => {
  it('reads navigator.onLine on mount', () => {
    setNavigatorOnline(true)
    const { getByTestId, unmount } = render(<Harness />)
    expect(getByTestId('status').dataset.online).toBe('yes')
    unmount()

    setNavigatorOnline(false)
    const { getByTestId: getByTestId2 } = render(<Harness />)
    expect(getByTestId2('status').dataset.online).toBe('no')
  })

  it('updates when an offline event fires', () => {
    setNavigatorOnline(true)
    const { getByTestId } = render(<Harness />)
    expect(getByTestId('status').dataset.online).toBe('yes')

    act(() => {
      setNavigatorOnline(false)
      window.dispatchEvent(new Event('offline'))
    })
    expect(getByTestId('status').dataset.online).toBe('no')
  })

  it('updates when an online event fires', () => {
    setNavigatorOnline(false)
    const { getByTestId } = render(<Harness />)
    expect(getByTestId('status').dataset.online).toBe('no')

    act(() => {
      setNavigatorOnline(true)
      window.dispatchEvent(new Event('online'))
    })
    expect(getByTestId('status').dataset.online).toBe('yes')
  })

  it('removes its event listeners on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    setNavigatorOnline(true)
    const { unmount } = render(<Harness />)
    unmount()
    const removed = removeSpy.mock.calls.map((c) => c[0])
    expect(removed).toContain('online')
    expect(removed).toContain('offline')
  })
})
