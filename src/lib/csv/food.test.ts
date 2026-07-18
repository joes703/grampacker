import { describe, it, expect } from 'vitest'
import {
  FOOD_CSV_HEADER,
  FOOD_SAMPLE_CSV,
  foodItemsToCsv,
  parseFoodCsv,
} from './index'
import type { FoodImportRow } from './index'
import type { FoodItem } from '../types'

// camelCase DTO builder (FoodItem = FoodItemResponse). Defaults are the
// minimal valid item; optionals default null so a test states exactly what
// it populates.
function makeFood(over: Partial<FoodItem> & { id: string; name: string }): FoodItem {
  return {
    id: over.id,
    name: over.name,
    brand: over.brand ?? null,
    servingDescription: over.servingDescription ?? null,
    servingWeightGrams: over.servingWeightGrams ?? 50,
    caloriesPerServing: over.caloriesPerServing ?? 200,
    servingsPerPackage: over.servingsPerPackage ?? null,
    fatGrams: over.fatGrams ?? null,
    saturatedFatGrams: over.saturatedFatGrams ?? null,
    carbsGrams: over.carbsGrams ?? null,
    fiberGrams: over.fiberGrams ?? null,
    sugarGrams: over.sugarGrams ?? null,
    proteinGrams: over.proteinGrams ?? null,
    sodiumMg: over.sodiumMg ?? null,
    potassiumMg: over.potassiumMg ?? null,
    notes: over.notes ?? null,
    sortOrder: over.sortOrder ?? 0,
    createdAt: over.createdAt ?? '2024-01-01',
    updatedAt: over.updatedAt ?? '2024-01-01',
  }
}

// Expects a successful parse; narrows away the top-level error string.
function parsedRows(text: string): FoodImportRow[] {
  const result = parseFoodCsv(text)
  if (typeof result === 'string') throw new Error(`unexpected parse error: ${result}`)
  return result
}

describe('foodItemsToCsv export format', () => {
  it('emits the exact 15-column canonical header (old-repo byte parity)', () => {
    expect(FOOD_CSV_HEADER).toBe(
      'name,brand,serving_description,serving_weight_grams,calories_per_serving,' +
        'servings_per_package,fat_grams,saturated_fat_grams,carbs_grams,fiber_grams,' +
        'sugar_grams,protein_grams,sodium_mg,potassium_mg,notes',
    )
    const lines = foodItemsToCsv([makeFood({ id: 'f-1', name: 'Oats' })]).split('\r\n')
    expect(lines[0]).toBe(FOOD_CSV_HEADER)
  })

  it('renders nulls as blank cells (never 0) and keeps real zeros', () => {
    const lines = foodItemsToCsv([
      makeFood({
        id: 'f-1', name: 'Olive oil', servingWeightGrams: 14, caloriesPerServing: 120,
        fatGrams: 14, sodiumMg: 0, // real zero must survive as "0"
      }),
    ]).split('\r\n')
    expect(lines[1]).toBe('Olive oil,,,14,120,,14,,,,,,0,,')
  })
})

describe('food CSV round-trip', () => {
  it('export -> import preserves every field, including null-vs-0', () => {
    const items = [
      makeFood({
        id: 'f-1', name: 'Instant oatmeal', brand: 'Quaker',
        servingDescription: '1 packet', servingWeightGrams: 43.125,
        caloriesPerServing: 150, servingsPerPackage: 1, fatGrams: 3,
        saturatedFatGrams: 0.5, carbsGrams: 27, fiberGrams: 3, sugarGrams: 12,
        proteinGrams: 4, sodiumMg: 0, potassiumMg: 130.5,
        notes: 'Add hot water; comma, and "quotes" survive',
      }),
      makeFood({ id: 'f-2', name: 'Mystery snack' }), // all optionals null
    ]
    const rows = parsedRows(foodItemsToCsv(items))
    expect(rows).toHaveLength(2)
    expect(rows[0]?.errors).toEqual([])
    expect(rows[0]?.item).toEqual({
      name: 'Instant oatmeal',
      brand: 'Quaker',
      servingDescription: '1 packet',
      servingWeightGrams: 43.125,
      caloriesPerServing: 150,
      servingsPerPackage: 1,
      fatGrams: 3,
      saturatedFatGrams: 0.5,
      carbsGrams: 27,
      fiberGrams: 3,
      sugarGrams: 12,
      proteinGrams: 4,
      sodiumMg: 0,
      potassiumMg: 130.5,
      notes: 'Add hot water; comma, and "quotes" survive',
    })
    // Blanks come back as null - never 0. Unknown stays unknown.
    expect(rows[1]?.item).toEqual({
      name: 'Mystery snack',
      brand: null,
      servingDescription: null,
      servingWeightGrams: 50,
      caloriesPerServing: 200,
      servingsPerPackage: null,
      fatGrams: null,
      saturatedFatGrams: null,
      carbsGrams: null,
      fiberGrams: null,
      sugarGrams: null,
      proteinGrams: null,
      sodiumMg: null,
      potassiumMg: null,
      notes: null,
    })
  })
})

describe('parseFoodCsv', () => {
  it('resolves GearSkeptic aliases (Flavor / Serv(g) / Cal/Serv / Na / K)', () => {
    const rows = parsedRows(
      'Flavor,Class,Serv(g),Cal/Serv,Servings,Fat,Carbs,Fiber,Sugar,Protein,Na,K\r\n' +
        'Trail mix,Snack,30,150,4,9,14,2,8,4,45,160',
    )
    expect(rows[0]?.errors).toEqual([])
    expect(rows[0]?.item).toMatchObject({
      name: 'Trail mix',
      servingDescription: 'Snack',
      servingWeightGrams: 30,
      caloriesPerServing: 150,
      servingsPerPackage: 4,
      fatGrams: 9,
      carbsGrams: 14,
      fiberGrams: 2,
      sugarGrams: 8,
      proteinGrams: 4,
      sodiumMg: 45,
      potassiumMg: 160,
    })
  })

  it('prefers the canonical column when both it and an alias are present', () => {
    // Alias column deliberately FIRST so file order cannot be what wins.
    const rows = parsedRows(
      'fat,name,serving_weight_grams,calories_per_serving,fat_grams\r\nBar,50,200,7,9',
    )
    expect(rows[0]?.item?.fatGrams).toBe(9)
  })

  it('flags bad numbers, negatives, and excess decimal places as row errors', () => {
    const header = 'name,serving_weight_grams,calories_per_serving,fat_grams,sodium_mg\r\n'
    const cases: { row: string; pattern: RegExp }[] = [
      { row: 'A,abc,100,,', pattern: /number/i },          // unparseable
      { row: 'B,50,100,-1,', pattern: /negative/i },        // negative macro
      { row: 'C,1.2345,100,,', pattern: /decimal/i },       // 4 dp on a 3-dp field
      { row: 'D,50,100.123,,', pattern: /decimal/i },       // 3 dp on a 2-dp field
      { row: 'E,50,100,,1.25', pattern: /decimal/i },       // 2 dp on a 1-dp field
      { row: 'F,50,100000000,,', pattern: /large/i },       // over numeric(10,2) max
      { row: 'G,0,100,,', pattern: /greater than 0/i },     // serving weight 0
    ]
    for (const c of cases) {
      const rows = parsedRows(header + c.row)
      expect(rows[0]?.item, c.row).toBeNull()
      expect(rows[0]?.errors.join('; '), c.row).toMatch(c.pattern)
    }
  })

  it('rejects a zero or negative servings_per_package but keeps blank as null', () => {
    const header = 'name,serving_weight_grams,calories_per_serving,servings_per_package\r\n'
    const bad = parsedRows(header + 'A,50,100,0')
    expect(bad[0]?.item).toBeNull()
    const blank = parsedRows(header + 'B,50,100,')
    expect(blank[0]?.item?.servingsPerPackage).toBeNull()
  })

  it('requires a non-blank name and reports the 1-based row number', () => {
    const rows = parsedRows(
      'name,serving_weight_grams,calories_per_serving\r\nOats,50,100\r\n  ,50,100',
    )
    expect(rows[1]?.rowNumber).toBe(2)
    expect(rows[1]?.item).toBeNull()
    expect(rows[1]?.errors.join('; ')).toMatch(/name/i)
  })

  it('slices over-long text to the DB caps instead of failing the row', () => {
    const longName = 'x'.repeat(300)
    const rows = parsedRows(
      `name,serving_weight_grams,calories_per_serving\r\n${longName},50,100`,
    )
    expect(rows[0]?.errors).toEqual([])
    expect(rows[0]?.item?.name).toBe('x'.repeat(256))
  })

  it('rejects a NUL byte in text via the schema parity guard', () => {
    const rows = parsedRows(
      'name,serving_weight_grams,calories_per_serving,notes\r\n"A",50,100,"a\u0000b"',
    )
    expect(rows[0]?.item).toBeNull()
    expect(rows[0]?.errors.length).toBeGreaterThan(0)
  })

  it('returns a top-level error for an empty file', () => {
    expect(parseFoodCsv('')).toMatch(/empty/i)
    expect(parseFoodCsv('name,serving_weight_grams,calories_per_serving')).toMatch(/empty/i)
  })

  it('returns a top-level error naming the missing required columns', () => {
    const result = parseFoodCsv('name,brand\r\nOats,Quaker')
    expect(result).toMatch(/serving_weight_grams/)
    expect(result).toMatch(/calories_per_serving/)
  })

  it('returns a top-level error above the row cap', () => {
    const body = Array.from({ length: 2001 }, (_, i) => `row-${i},10,100`).join('\r\n')
    const result = parseFoodCsv(`name,serving_weight_grams,calories_per_serving\r\n${body}`)
    expect(result).toMatch(/too many/i)
  })
})

describe('FOOD_SAMPLE_CSV', () => {
  it('parses with zero errors (every sample row importable)', () => {
    const rows = parsedRows(FOOD_SAMPLE_CSV)
    expect(rows).toHaveLength(22)
    for (const row of rows) {
      expect(row.errors, row.name).toEqual([])
      expect(row.item, row.name).not.toBeNull()
    }
  })
})
