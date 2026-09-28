import { describe, it, expect, vi, afterEach } from 'vitest'
import { addToastHost, getToastHost, removeToastHost, subscribeToastHost } from './toast-host'

// Plain objects stand in for elements: the store only compares identity.
const a = {} as Element
const b = {} as Element
const c = {} as Element

afterEach(() => {
  for (const host of [a, b, c]) removeToastHost(host)
})

describe('toast host stack', () => {
  it('is null with nothing registered, then the most recently added host', () => {
    expect(getToastHost()).toBeNull()
    addToastHost(a)
    addToastHost(b)
    expect(getToastHost()).toBe(b)
  })

  it('removing the top host falls back to the one below; removing a lower one keeps the top', () => {
    addToastHost(a)
    addToastHost(b)
    addToastHost(c)
    removeToastHost(b)
    expect(getToastHost()).toBe(c)
    removeToastHost(c)
    expect(getToastHost()).toBe(a)
  })

  it('re-adding a registered host moves it to the top (a reopened dialog is on top again)', () => {
    addToastHost(a)
    addToastHost(b)
    addToastHost(a)
    expect(getToastHost()).toBe(a)
    removeToastHost(a)
    expect(getToastHost()).toBe(b)
  })

  it('notifies subscribers on change only', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToastHost(listener)
    addToastHost(a)
    addToastHost(a)
    removeToastHost(b)
    expect(listener).toHaveBeenCalledTimes(1)
    removeToastHost(a)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    addToastHost(a)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
