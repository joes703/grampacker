import { describe, expect, it } from 'vitest'
import { generateSlug, withFreshSlug } from './lists'

// withFreshSlug is the single retry loop behind every write that mints a share
// slug: create, duplicate, from-selection, import, and replacing a share link.
// It used to be five copies of the same for-loop, so this is the test that
// stops the shared version regressing all five at once.
//
// It cannot be reached through the HTTP surface: it only does anything when two
// 6-char base62 draws collide, which is ~1-in-2^35 per attempt. Hence a direct
// test with a fake that collides on demand.

// Shaped like the real thing: DrizzleQueryError -> D1_ERROR -> the raw SQLite
// message. isUniqueViolation walks to the ROOT cause and requires the
// SQLITE_CONSTRAINT marker, so a plain `new Error(text)` would not exercise it.
const slugCollision = () =>
  new Error('D1_ERROR', {
    cause: new Error(
      'UNIQUE constraint failed: lists.slug: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)',
    ),
  })

describe('withFreshSlug', () => {
  it('returns the first attempt when nothing collides', async () => {
    const seen: string[] = []
    const out = await withFreshSlug(async (slug) => {
      seen.push(slug)
      return `used:${slug}`
    })

    expect(seen).toHaveLength(1)
    expect(out).toBe(`used:${seen[0]}`)
  })

  it('retries on a slug collision, with a DIFFERENT slug each time', async () => {
    const seen: string[] = []
    const out = await withFreshSlug(async (slug) => {
      seen.push(slug)
      if (seen.length < 3) throw slugCollision()
      return 'ok'
    })

    expect(out).toBe('ok')
    expect(seen).toHaveLength(3)
    // The point of retrying is a fresh draw. Re-offering the same slug would
    // loop to exhaustion against a real index.
    expect(new Set(seen).size).toBe(3)
  })

  it('gives up after 5 attempts rather than looping forever', async () => {
    let attempts = 0
    await expect(
      withFreshSlug(async () => {
        attempts++
        throw slugCollision()
      }),
    ).rejects.toThrow(/slug generation exhausted retries/)
    expect(attempts).toBe(5)
  })

  it('rethrows anything that is NOT a slug collision, without retrying', async () => {
    // This is the property the callers depend on: they catch their own
    // failures (the list-cap trigger) and rethrow the rest, so a non-collision
    // error must pass straight through instead of burning retries or being
    // swallowed into a misleading "exhausted retries".
    for (const err of [
      new Error('D1_ERROR', {
        cause: new Error(
          'UNIQUE constraint failed: lists.id, lists.user_id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)',
        ),
      }),
      new Error('D1_ERROR', {
        cause: new Error('list cap exceeded: SQLITE_CONSTRAINT_TRIGGER'),
      }),
      new Error('network exploded'),
    ]) {
      let attempts = 0
      await expect(
        withFreshSlug(async () => {
          attempts++
          throw err
        }),
      ).rejects.toThrow(err)
      expect(attempts, err.cause instanceof Error ? err.cause.message : err.message).toBe(1)
    }
  })

  it('generateSlug produces the 6-char base62 shape the CHECK constraint wants', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateSlug()).toMatch(/^[A-Za-z0-9]{6}$/)
    }
  })
})
