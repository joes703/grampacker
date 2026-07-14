// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasSeenSession, rememberSession } from './session-hint'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('session-hint', () => {
  it('does not claim a session on a browser that has never had one', () => {
    // The case the whole bundle split is for: a genuinely new visitor must not
    // pull down the authenticated chunk.
    expect(hasSeenSession()).toBe(false)
  })

  it('remembers across a reload', () => {
    rememberSession()
    expect(hasSeenSession()).toBe(true)
  })

  // The failure mode that matters is not "returns null" - it is "throws".
  // Safari in private mode and any browser with site data blocked raise on
  // access, and a perf hint must never be the thing that takes the app down.
  it('survives a localStorage that throws on write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => rememberSession()).not.toThrow()
  })

  it('survives a localStorage that throws on read, and stays conservative', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    // False, not a crash and not an optimistic true: without a hint the chunk
    // just loads serially, which is correct, only slower.
    expect(hasSeenSession()).toBe(false)
  })
})
