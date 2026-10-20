import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { updateGearItemRequestSchema } from './gear'
import { updateListItemRequestSchema, updateListRequestSchema } from './lists'
import { updateFoodItemRequestSchema } from './food'

// One empty-patch idiom for every PATCH schema (nonEmptyPatch in
// shared/schema-primitives.ts): at least one field must be DEFINED.
// `{name: undefined}` is the case the two old idioms disagreed on - a
// key-count check accepted it, the defined-field check rejects it. JSON
// cannot encode an explicit undefined, so only TS callers meet that half.
// The message is asserted at the schema level because HTTP answers invalid
// bodies with the generic copy.
const cases: [string, z.ZodType, Record<string, unknown>][] = [
  ['gear item', updateGearItemRequestSchema, { name: 'Tent' }],
  ['list', updateListRequestSchema, { name: 'Trip' }],
  ['list item', updateListItemRequestSchema, { quantity: 2 }],
  ['food item', updateFoodItemRequestSchema, { name: 'Ramen' }],
]

describe.each(cases)('%s patch', (_label, schema, valid) => {
  it('rejects {} with the shared message', () => {
    const r = schema.safeParse({})
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toBe('empty patch')
  })

  it('rejects a patch whose only field is explicitly undefined', () => {
    const key = Object.keys(valid)[0] as string
    expect(schema.safeParse({ [key]: undefined }).success).toBe(false)
  })

  it('accepts one defined field', () => {
    expect(schema.safeParse(valid).success).toBe(true)
  })
})
