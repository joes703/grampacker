import { describe, it, expect, vi, afterEach } from 'vitest'
import { randomTempId } from './random-temp-id'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('randomTempId', () => {
  it('returns crypto.randomUUID when available (native happy path)', () => {
    vi.stubGlobal('crypto', {
      ...crypto,
      randomUUID: () => 'fixed-native-uuid' as `${string}-${string}-${string}-${string}-${string}`,
    })
    expect(randomTempId()).toBe('fixed-native-uuid')
  })

  it('falls back to a uuid v4-shaped string built from getRandomValues when randomUUID is missing', () => {
    // Stub randomUUID to undefined, leave getRandomValues working.
    vi.stubGlobal('crypto', {
      ...crypto,
      randomUUID: undefined,
      getRandomValues: <T extends ArrayBufferView | null>(buffer: T): T => {
        if (buffer instanceof Uint8Array) {
          for (let i = 0; i < buffer.length; i++) buffer[i] = i
        }
        return buffer
      },
    })

    const id = randomTempId()
    // RFC 4122 v4 shape: 8-4-4-4-12 hex; version nibble is 4; variant
    // is 8/9/a/b. The fallback sets these bits explicitly.
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('throws diagnosable error when both APIs are missing', () => {
    vi.stubGlobal('crypto', {
      randomUUID: undefined,
      getRandomValues: undefined,
    })
    expect(() => randomTempId()).toThrow(/crypto\.getRandomValues is unavailable/)
  })
})
