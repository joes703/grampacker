import { describe, it, expect } from 'vitest'
import { foodItemsToCsv, parseFoodCsv, FOOD_CSV_HEADER, FOOD_SAMPLE_CSV } from './food'
import type { FoodItem } from '../types'

function food(partial: Partial<FoodItem>): FoodItem {
  return {
    id: 'x',
    user_id: 'u',
    name: 'F',
    brand: null,
    serving_description: null,
    serving_weight_grams: 50,
    calories_per_serving: 100,
    servings_per_package: null,
    fat_grams: null,
    saturated_fat_grams: null,
    carbs_grams: null,
    fiber_grams: null,
    sugar_grams: null,
    protein_grams: null,
    sodium_mg: null,
    potassium_mg: null,
    notes: null,
    sort_order: 0,
    created_at: '',
    updated_at: '',
    ...partial,
  }
}

const CANONICAL_HEADER =
  'name,brand,serving_description,serving_weight_grams,calories_per_serving,servings_per_package,fat_grams,saturated_fat_grams,carbs_grams,fiber_grams,sugar_grams,protein_grams,sodium_mg,potassium_mg,notes'

describe('FOOD_CSV_HEADER', () => {
  it('is the single source of truth: matches the foodItemsToCsv header row', () => {
    const headerLine = foodItemsToCsv([food({})]).split('\r\n')[0]
    expect(FOOD_CSV_HEADER).toBe(headerLine)
    expect(FOOD_CSV_HEADER).toBe(CANONICAL_HEADER)
  })
})

describe('FOOD_SAMPLE_CSV', () => {
  it('uses the canonical header and imports as valid sample food rows', () => {
    const [header] = FOOD_SAMPLE_CSV.split('\r\n')
    expect(header).toBe(FOOD_CSV_HEADER)

    const rows = parseFoodCsv(FOOD_SAMPLE_CSV) as Exclude<ReturnType<typeof parseFoodCsv>, string>
    expect(rows.length).toBeGreaterThanOrEqual(5)
    expect(rows.every((row) => row.errors.length === 0 && row.item !== null)).toBe(true)
    expect(rows.map((row) => row.item!.name)).toContain('Instant Oatmeal')
    expect(rows.map((row) => row.item!.name)).toContain('Peanut Butter')
  })
})

describe('foodItemsToCsv', () => {
  it('emits exactly the canonical snake_case header order', () => {
    const csv = foodItemsToCsv([food({ name: 'Oats', calories_per_serving: 150 })])
    const lines = csv.trim().split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(CANONICAL_HEADER)
    expect(lines[1]).toContain('Oats')
    expect(lines[1]).toContain('150')
  })

  it('renders missing optional values as empty cells, never zero', () => {
    const csv = foodItemsToCsv([food({ name: 'Plain', protein_grams: null })])
    const cells = (csv.trim().split('\r\n')[1] ?? '').split(',')
    // Column order: 0 name, 3 weight, 4 calories, 11 protein.
    expect(cells[0]).toBe('Plain')
    expect(cells[3]).toBe('50')
    expect(cells[4]).toBe('100')
    expect(cells[11]).toBe('') // protein unknown -> empty, not 0
  })

  it('returns an empty string for an empty library', () => {
    expect(foodItemsToCsv([])).toBe('')
  })
})

describe('foodItemsToCsv <-> parseFoodCsv round-trip', () => {
  it('round-trips every supported field through export then import', () => {
    const original = food({
      name: 'Trail Mix',
      brand: 'TrailCo',
      serving_description: '1 handful',
      serving_weight_grams: 42,
      calories_per_serving: 210,
      servings_per_package: 6,
      fat_grams: 14,
      saturated_fat_grams: 2.5,
      carbs_grams: 18,
      fiber_grams: 3,
      sugar_grams: 9,
      protein_grams: 6,
      sodium_mg: 55,
      potassium_mg: 180,
      notes: 'salty, with chocolate',
    })
    const rows = parseFoodCsv(foodItemsToCsv([original])) as Exclude<
      ReturnType<typeof parseFoodCsv>,
      string
    >
    expect(rows[0]!.errors).toEqual([])
    expect(rows[0]!.item).toEqual({
      name: 'Trail Mix',
      brand: 'TrailCo',
      serving_description: '1 handful',
      serving_weight_grams: 42,
      calories_per_serving: 210,
      servings_per_package: 6,
      fat_grams: 14,
      saturated_fat_grams: 2.5,
      carbs_grams: 18,
      fiber_grams: 3,
      sugar_grams: 9,
      protein_grams: 6,
      sodium_mg: 55,
      potassium_mg: 180,
      notes: 'salty, with chocolate',
    })
  })

  it('round-trips blank optional fields as null (exported empty cells import as null)', () => {
    const sparse = food({
      name: 'Plain Rice',
      brand: null,
      serving_description: null,
      serving_weight_grams: 75,
      calories_per_serving: 270,
      servings_per_package: null,
      fat_grams: null,
      saturated_fat_grams: null,
      carbs_grams: null,
      fiber_grams: null,
      sugar_grams: null,
      protein_grams: null,
      sodium_mg: null,
      potassium_mg: null,
      notes: null,
    })
    const rows = parseFoodCsv(foodItemsToCsv([sparse])) as Exclude<
      ReturnType<typeof parseFoodCsv>,
      string
    >
    expect(rows[0]!.errors).toEqual([])
    expect(rows[0]!.item).toEqual({
      name: 'Plain Rice',
      brand: null,
      serving_description: null,
      serving_weight_grams: 75,
      calories_per_serving: 270,
      servings_per_package: null,
      fat_grams: null,
      saturated_fat_grams: null,
      carbs_grams: null,
      fiber_grams: null,
      sugar_grams: null,
      protein_grams: null,
      sodium_mg: null,
      potassium_mg: null,
      notes: null,
    })
  })
})

describe('parseFoodCsv', () => {
  it('returns an error string for an empty file', () => {
    expect(typeof parseFoodCsv('')).toBe('string')
  })

  it('returns an error string when required columns are missing', () => {
    const out = parseFoodCsv('brand,notes\nTrailCo,hi')
    expect(typeof out).toBe('string')
    expect(out as string).toMatch(/name/i)
  })

  it('parses a canonical CSV row into a valid FoodItemInput', () => {
    const csv = `${CANONICAL_HEADER}\nOats,TrailCo,1 cup,80,300,4,5,1,54,8,1,11,10,200,morning`
    const rows = parseFoodCsv(csv)
    expect(Array.isArray(rows)).toBe(true)
    const [row] = rows as Exclude<ReturnType<typeof parseFoodCsv>, string>
    expect(row!.errors).toEqual([])
    expect(row!.item).toEqual({
      name: 'Oats',
      brand: 'TrailCo',
      serving_description: '1 cup',
      serving_weight_grams: 80,
      calories_per_serving: 300,
      servings_per_package: 4,
      fat_grams: 5,
      saturated_fat_grams: 1,
      carbs_grams: 54,
      fiber_grams: 8,
      sugar_grams: 1,
      protein_grams: 11,
      sodium_mg: 10,
      potassium_mg: 200,
      notes: 'morning',
    })
  })

  it('maps GearSkeptic-style headers to canonical fields', () => {
    const csv =
      'Flavor,Brand,Class,Serv(g),Cal/Serv,Servings,Fat,Na,K,Carbs,Fiber,Sugar,Protein\n' +
      'Peanut Butter,TrailCo,Spread,34,190,1,16,150,180,7,2,3,8'
    const rows = parseFoodCsv(csv) as Exclude<ReturnType<typeof parseFoodCsv>, string>
    expect(rows[0]!.errors).toEqual([])
    expect(rows[0]!.item).toMatchObject({
      name: 'Peanut Butter',
      brand: 'TrailCo',
      serving_description: 'Spread',
      serving_weight_grams: 34,
      calories_per_serving: 190,
      servings_per_package: 1,
      fat_grams: 16,
      sodium_mg: 150,
      potassium_mg: 180,
      carbs_grams: 7,
      fiber_grams: 2,
      sugar_grams: 3,
      protein_grams: 8,
    })
  })

  it('maps blank optional nutrients to null, never 0', () => {
    // name=Plain, brand blank, serving_description blank,
    // serving_weight_grams=50, calories_per_serving=150, rest blank.
    const csv = `${CANONICAL_HEADER}\nPlain,,,50,150,,,,,,,,,,`
    const rows = parseFoodCsv(csv) as Exclude<ReturnType<typeof parseFoodCsv>, string>
    const { item } = rows[0]!
    expect(item).not.toBeNull()
    expect(item!.serving_weight_grams).toBe(50)
    expect(item!.calories_per_serving).toBe(150)
    expect(item!.brand).toBeNull()
    expect(item!.serving_description).toBeNull()
    expect(item!.servings_per_package).toBeNull()
    expect(item!.fat_grams).toBeNull()
    expect(item!.protein_grams).toBeNull()
    expect(item!.sodium_mg).toBeNull()
    expect(item!.notes).toBeNull()
  })

  it('flags rows with invalid required and optional numbers (and yields a null item)', () => {
    const csv =
      `${CANONICAL_HEADER}\n` +
      // blank name; zero serving weight; negative calories
      `,,,0,-5,,,,,,,,,,\n` +
      // non-numeric serving weight; servings_per_package = 0; negative fiber
      `Bar,,,abc,100,0,,,,-3,,,,,`
    const rows = parseFoodCsv(csv) as Exclude<ReturnType<typeof parseFoodCsv>, string>

    expect(rows[0]!.item).toBeNull()
    expect(rows[0]!.errors.join(' ')).toMatch(/name/i)
    expect(rows[0]!.errors.join(' ')).toMatch(/serving weight/i)
    expect(rows[0]!.errors.join(' ')).toMatch(/calories/i)

    expect(rows[1]!.item).toBeNull()
    expect(rows[1]!.errors.join(' ')).toMatch(/serving weight/i)
    expect(rows[1]!.errors.join(' ')).toMatch(/servings per package/i)
    expect(rows[1]!.errors.join(' ')).toMatch(/fiber/i)
  })

  it('rejects thousands separators and trailing units as non-numeric', () => {
    const csv = `${CANONICAL_HEADER}\nGranola,,,"1,000",150,,,,,,,,,,`
    const rows = parseFoodCsv(csv) as Exclude<ReturnType<typeof parseFoodCsv>, string>
    expect(rows[0]!.item).toBeNull()
    expect(rows[0]!.errors.join(' ')).toMatch(/serving weight/i)
  })
})
