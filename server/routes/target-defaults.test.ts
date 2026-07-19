import { describe, expect, it } from 'vitest'
import { targetDefaultsResponseSchema } from '../../shared/food-plans'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'

// Account-level default daily targets (slice 7). Same full-replace contract
// as the plan-targets route: the PUT body is the COMPLETE default set,
// "off" = the row is absent, and every DB rule is a zod 400 first.

async function getDefaults(cookie: string) {
  const res = await apiRequest(cookie, 'GET', '/api/target-defaults')
  expect(res.status).toBe(200)
  return targetDefaultsResponseSchema.parse(await res.json())
}

describe('/api/target-defaults', () => {
  it('anon requests are 401', async () => {
    for (const [method, body] of [
      ['GET', undefined],
      ['PUT', { defaults: [] }],
    ] as const) {
      const res = await apiRequest(null, method, '/api/target-defaults', body)
      expect(res.status, method).toBe(401)
    }
  })

  it('GET with nothing saved returns an empty list', async () => {
    const { cookie } = await signUpVerifiedUser('defaults-empty@example.com', 'E')
    expect(await getDefaults(cookie)).toEqual({ defaults: [] })
  })

  it('PUT replaces the whole set; empty PUT clears it', async () => {
    const { cookie } = await signUpVerifiedUser('defaults-crud@example.com', 'C')

    let res = await apiRequest(cookie, 'PUT', '/api/target-defaults', {
      defaults: [
        { metric: 'protein', mode: 'min', targetMin: 120, targetMax: null },
        { metric: 'calories', mode: 'range', targetMin: 2500, targetMax: 3500 },
      ],
    })
    expect(res.status).toBe(200)
    const raw = (await res.json()) as { defaults: Record<string, unknown>[] }
    // Exact keys asserted on the RAW wire body: zod objects are non-strict,
    // so parse() strips unknown keys and a widened select (userId...) would
    // cross the wire yet vanish before a parsed-row assertion ran.
    expect(Object.keys(raw).toSorted()).toEqual(['defaults'])
    for (const row of raw.defaults) {
      expect(Object.keys(row).toSorted()).toEqual([
        'id', 'metric', 'mode', 'targetMax', 'targetMin',
      ])
    }
    let body = targetDefaultsResponseSchema.parse(raw)
    // Sorted by metric; server-minted ids.
    expect(body.defaults.map((d) => d.metric)).toEqual(['calories', 'protein'])
    expect(body.defaults[0]).toMatchObject({
      metric: 'calories', mode: 'range', targetMin: 2500, targetMax: 3500,
    })
    expect(body.defaults[0]!.id).toBeTruthy()
    expect(await getDefaults(cookie)).toEqual(body)

    res = await apiRequest(cookie, 'PUT', '/api/target-defaults', {
      defaults: [{ metric: 'fiber', mode: 'min', targetMin: 25, targetMax: null }],
    })
    expect(res.status).toBe(200)
    body = targetDefaultsResponseSchema.parse(await res.json())
    expect(body.defaults).toHaveLength(1)
    expect(body.defaults[0]).toMatchObject({ metric: 'fiber' })

    res = await apiRequest(cookie, 'PUT', '/api/target-defaults', { defaults: [] })
    expect(res.status).toBe(200)
    expect(targetDefaultsResponseSchema.parse(await res.json())).toEqual({
      defaults: [],
    })
  })

  it('400s zod-invalid payloads', async () => {
    const { cookie } = await signUpVerifiedUser('defaults-400@example.com', 'Z')
    const bad: unknown[] = [
      { defaults: [{ metric: 'fat_pct', mode: 'min', targetMin: 1, targetMax: null }] }, // meal-only metric
      { defaults: [{ metric: 'calories', mode: 'off', targetMin: null, targetMax: null }] }, // off is not a wire mode
      { defaults: [{ metric: 'calories', mode: 'range', targetMin: 300, targetMax: 200 }] }, // min <= max
      { defaults: [{ metric: 'calories', mode: 'min', targetMin: -5, targetMax: null }] }, // negative
      {
        defaults: [
          { metric: 'sodium', mode: 'min', targetMin: 1, targetMax: null },
          { metric: 'sodium', mode: 'max', targetMin: null, targetMax: 2 },
        ],
      }, // duplicate metric
      {
        defaults: [
          'calories', 'protein', 'carbs', 'fiber', 'sodium', 'calorie_density', 'calories',
        ].map((m) => ({ metric: m, mode: 'min', targetMin: 1, targetMax: null })),
      }, // 7 rows
      { defaults: [], extra: true }, // strict
      {}, // missing key
    ]
    for (const [i, body] of bad.entries()) {
      const res = await apiRequest(cookie, 'PUT', '/api/target-defaults', body)
      expect(res.status, `bad body #${i}`).toBe(400)
    }
  })

  it('defaults are per-user: A\'s set is invisible to B', async () => {
    const a = await signUpVerifiedUser('defaults-iso-a@example.com', 'A')
    const b = await signUpVerifiedUser('defaults-iso-b@example.com', 'B')
    const res = await apiRequest(a.cookie, 'PUT', '/api/target-defaults', {
      defaults: [{ metric: 'calories', mode: 'min', targetMin: 3000, targetMax: null }],
    })
    expect(res.status).toBe(200)
    expect(await getDefaults(b.cookie)).toEqual({ defaults: [] })
  })
})
