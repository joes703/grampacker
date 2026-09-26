import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAX_LIST_ITEM_QUANTITY } from '../shared/lists'
import { FOOD_QUANTITY_MAX } from '../shared/food'
import { definitionOf } from './schema-sql'

// The same mechanism as pack-rank-constants.test.ts, for the quantity CHECKs.
//
// A quantity ceiling is declared once in TypeScript - MAX_LIST_ITEM_QUANTITY
// for gear on a list, FOOD_QUANTITY_MAX for food - and the request schemas and
// the inline editors' clamps read it from there. But the DATABASE enforces its
// own copy, as a CHECK constraint literal in a migration, because SQL
// cannot import a constant.
//
// What this catches is someone raising a ceiling in shared/ and leaving the
// database rejecting values the app now believes are legal - a write that
// passes every client check and every zod schema and then 500s on a
// constraint.
//
// server/db/app-schema.ts is checked too. It is the Drizzle source the
// snapshots are generated from, so a divergence there is what a FUTURE
// migration would carry into the database.

const readRepoFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// The `between 1 and N` belonging to a named quantity CHECK. Scans a window
// AFTER each occurrence of the constraint name rather than the same line: the
// Drizzle source splits `check('name', sql`...`)` across lines, so a
// line-oriented match silently found nothing and the test passed vacuously
// (caught by writing it and watching it fail on a schema that was correct).
const WINDOW = 400
const quantityUpperBounds = (text: string, constraintName: string): number[] => {
  const bounds: number[] = []
  let from = text.indexOf(constraintName)
  while (from !== -1) {
    const match = /between\s+1\s+and\s+(\d+)/i.exec(text.slice(from, from + WINDOW))
    const captured = match?.[1]
    if (captured !== undefined) bounds.push(Number(captured))
    from = text.indexOf(constraintName, from + constraintName.length)
  }
  return bounds
}

describe('quantity ceilings stay in step outside TypeScript', () => {
  it('the list_items table enforces the gear quantity ceiling shared/lists.ts declares', () => {
    const sql = definitionOf('list_items')
    const bounds = quantityUpperBounds(sql, 'list_items_quantity_range')
    expect(bounds).toEqual([MAX_LIST_ITEM_QUANTITY])
  })

  it('the list_food_items table enforces the food quantity ceiling shared/food.ts declares', () => {
    const sql = definitionOf('list_food_items')
    const bounds = quantityUpperBounds(sql, 'list_food_items_quantity_range')
    expect(bounds).toEqual([FOOD_QUANTITY_MAX])
  })

  it('the Drizzle schema declares the same two ceilings', () => {
    const schema = readRepoFile('server/db/app-schema.ts')
    expect(quantityUpperBounds(schema, 'list_items_quantity_range')).toEqual([
      MAX_LIST_ITEM_QUANTITY,
    ])
    expect(quantityUpperBounds(schema, 'list_food_items_quantity_range')).toEqual([
      FOOD_QUANTITY_MAX,
    ])
  })
})
