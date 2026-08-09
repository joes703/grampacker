import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { deepStrict } from './deep-strict'
import {
  listResponseSchema,
  listItemResponseSchema,
  packingLocationResponseSchema,
  sharedListResponseSchema,
} from './lists'
import {
  categoryResponseSchema,
  gearItemResponseSchema,
  importGearResponseSchema,
} from './gear'
import {
  foodItemResponseSchema,
  foodSlotResponseSchema,
  listFoodResponseSchema,
} from './food'
import { meResponseSchema } from './me'
import { healthResponseSchema } from './health'

// deepStrict is what stands between "the schema is tolerant" and "drift
// fails CI": the share route parses with it at the boundary and the API
// contract tests parse every raw response with it. These tests pin TWO
// facts per schema: a valid fixture still passes (the walker preserved the
// schema), and an extra key is rejected at every nesting level that exists
// (the walker actually made each level strict). If a zod upgrade changed
// the accessors deepStrict walks, these go red instead of deepStrict
// silently returning a non-strict schema.

const listFixture = {
  id: 'l1',
  name: 'Trip',
  description: null,
  slug: 'abc123',
  isShared: false,
  groupWorn: false,
  readyChecksEnabled: true,
  isDraft: false,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const gearFixture = {
  id: 'g1',
  categoryId: null,
  name: 'Tent',
  description: null,
  weightGrams: 900,
  cost: null,
  purchaseDate: null,
  status: 'active',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const listItemFixture = {
  id: 'li1',
  listId: 'l1',
  gearItemId: 'g1',
  quantity: 1,
  isWorn: false,
  isConsumable: false,
  isPacked: false,
  isReady: false,
  packingLocationId: null,
  sortOrder: 0,
  packSortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  gearItem: gearFixture,
}

const sharedListFixture = {
  list: { name: 'Trip', description: null, groupWorn: false, isDraft: false },
  categories: [{ id: 'c1', name: 'Shelter', sortOrder: 0 }],
  items: [
    {
      id: 'li1',
      gearItemId: 'g1',
      quantity: 1,
      isWorn: false,
      isConsumable: false,
      sortOrder: 0,
      gear: { name: 'Tent', description: null, weightGrams: 900, categoryId: null },
    },
  ],
}

const foodSlotFixture = { id: 's1', dayNumber: 1, meal: 'breakfast', needed: true }
const foodItemFixture = {
  id: 'f1',
  name: 'Oats',
  weightGrams: 90,
  quantity: 1,
  sortOrder: 0,
  isPacked: false,
  isReady: false,
  packingLocationId: null,
  packSortOrder: 0,
  slotIds: ['s1'],
}
const listFoodFixture = {
  dayCount: 1,
  slots: [foodSlotFixture],
  items: [foodItemFixture],
}

// [schema, valid fixture, paths to inject an extra key at - '' is top level,
// 'a.b' descends objects, a trailing [0] descends into the first array row]
const cases: [string, Parameters<typeof deepStrict>[0], unknown, string[]][] = [
  ['listResponseSchema', listResponseSchema, listFixture, ['']],
  [
    'listItemResponseSchema',
    listItemResponseSchema,
    listItemFixture,
    ['', 'gearItem'],
  ],
  [
    'packingLocationResponseSchema',
    packingLocationResponseSchema,
    { id: 'p1', name: 'Pack', sortOrder: 0, containerListItemId: null },
    [''],
  ],
  [
    'sharedListResponseSchema',
    sharedListResponseSchema,
    sharedListFixture,
    ['', 'list', 'categories[0]', 'items[0]', 'items[0].gear'],
  ],
  ['categoryResponseSchema', categoryResponseSchema, {
    id: 'c1',
    name: 'Shelter',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  }, ['']],
  ['gearItemResponseSchema', gearItemResponseSchema, gearFixture, ['']],
  [
    'importGearResponseSchema',
    importGearResponseSchema,
    { createdCategories: 1, createdItems: 2 },
    [''],
  ],
  ['foodSlotResponseSchema', foodSlotResponseSchema, foodSlotFixture, ['']],
  ['foodItemResponseSchema', foodItemResponseSchema, foodItemFixture, ['']],
  [
    'listFoodResponseSchema',
    listFoodResponseSchema,
    listFoodFixture,
    ['', 'slots[0]', 'items[0]'],
  ],
  [
    'meResponseSchema',
    meResponseSchema,
    {
      id: 'u1',
      email: 'a@b.c',
      emailVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      passkeyCount: 1,
    },
    [''],
  ],
  ['healthResponseSchema', healthResponseSchema, { ok: true }, ['']],
]

function injectExtra(fixture: unknown, path: string): unknown {
  const clone = structuredClone(fixture) as Record<string, unknown>
  if (path === '') return { ...clone, __extra__: 1 }
  let node: unknown = clone
  for (const segment of path.split('.')) {
    const m = /^([^[]+)(?:\[(\d+)\])?$/.exec(segment)
    if (!m) throw new Error(`bad path segment: ${segment}`)
    node = (node as Record<string, unknown>)[m[1] as string]
    if (m[2] !== undefined) node = (node as unknown[])[Number(m[2])]
  }
  ;(node as Record<string, unknown>).__extra__ = 1
  return clone
}

describe('deepStrict fails closed on what it cannot preserve', () => {
  // Rebuilding a container drops its .refine/.min/.max. Silently returning a
  // weaker "strict" schema would be worse than not having one, so these must
  // THROW until the walker learns to carry the check across.
  it('throws on a refined object', () => {
    const refined = z.object({ a: z.string() }).refine(() => true)
    expect(() => deepStrict(refined)).toThrow(/object-level checks/)
  })

  it('throws on an array with length checks', () => {
    expect(() => deepStrict(z.array(z.string()).min(1))).toThrow(
      /array-level checks/,
    )
  })

  it('throws on a nested check-bearing container too', () => {
    const nested = z.object({ rows: z.array(z.string()).max(5) })
    expect(() => deepStrict(nested)).toThrow(/array-level checks/)
  })
})

describe('deepStrict', () => {
  for (const [name, schema, fixture, paths] of cases) {
    it(`${name}: valid passes, extras rejected at every level`, () => {
      const strict = deepStrict(schema)
      expect(strict.safeParse(fixture).success, 'valid fixture').toBe(true)
      // The tolerant original must STRIP the same extras (the whole point of
      // keeping the browser runtime on the original schemas) - accepted AND
      // absent from the output, or a schema gone .passthrough would still be
      // green here while leaking unknown fields into the UI.
      const tolerant = schema.safeParse(injectExtra(fixture, ''))
      expect(tolerant.success).toBe(true)
      if (tolerant.success) {
        expect(
          Object.hasOwn(tolerant.data as object, '__extra__'),
          'tolerant parse must strip, not pass through',
        ).toBe(false)
      }
      for (const path of paths) {
        const poisoned = injectExtra(fixture, path)
        expect(
          strict.safeParse(poisoned).success,
          `extra at ${path === '' ? 'top level' : path}`,
        ).toBe(false)
      }
    })
  }
})
