import type { FoodItem } from '../types'
import type { FoodItemInput } from '../queries/food'
import { toCsv, parseCsv, MAX_CSV_ROWS } from './core'

// The canonical Grampacker Food CSV header: snake_case column names in
// FoodItemInput order. SINGLE SOURCE OF TRUTH shared by export (foodItemsToCsv
// emits exactly this), import (parseFoodCsv reads these canonical names), and
// the "CSV format" help affordance. GearSkeptic headers are an import-only
// convenience alias and are never part of this list.
export const FOOD_CSV_HEADERS = [
  'name',
  'brand',
  'serving_description',
  'serving_weight_grams',
  'calories_per_serving',
  'servings_per_package',
  'fat_grams',
  'saturated_fat_grams',
  'carbs_grams',
  'fiber_grams',
  'sugar_grams',
  'protein_grams',
  'sodium_mg',
  'potassium_mg',
  'notes',
] as const

// The canonical header row as a single comma-joined string (what users copy).
export const FOOD_CSV_HEADER = FOOD_CSV_HEADERS.join(',')

// Serialize the food library to the canonical Grampacker Food CSV (FOOD_CSV_HEADERS),
// the SAME format parseFoodCsv reads, so export -> import round-trips every field.
// The Record type binds the row keys to FOOD_CSV_HEADERS, so a column rename/reorder
// is a compile error here. Missing optional values render as '' (never 0) so unknown
// stays unknown, and import reads those empty cells back as null (Story 1, Story 5).
export function foodItemsToCsv(items: FoodItem[]): string {
  const rows = items.map(
    (f): Record<(typeof FOOD_CSV_HEADERS)[number], string | number> => ({
      name: f.name,
      brand: f.brand ?? '',
      serving_description: f.serving_description ?? '',
      serving_weight_grams: f.serving_weight_grams,
      calories_per_serving: f.calories_per_serving,
      servings_per_package: f.servings_per_package ?? '',
      fat_grams: f.fat_grams ?? '',
      saturated_fat_grams: f.saturated_fat_grams ?? '',
      carbs_grams: f.carbs_grams ?? '',
      fiber_grams: f.fiber_grams ?? '',
      sugar_grams: f.sugar_grams ?? '',
      protein_grams: f.protein_grams ?? '',
      sodium_mg: f.sodium_mg ?? '',
      potassium_mg: f.potassium_mg ?? '',
      notes: f.notes ?? '',
    }),
  )
  return toCsv(rows)
}

// Realistic sample library ported from the approved Claude Design food study:
// one 7-day backpacking trip's worth of foods. Deliberately mixes packaged foods, by-weight foods
// (no servings_per_package), foods with genuinely-unknown macros (null, NEVER
// 0 - e.g. instant coffee), and real zeros (olive oil sodium). Expanded from a
// 5-item placeholder so the sample doubles as useful smoke-test data for the
// Food Plan UI (see docs/smoke-tests/food-plan-sample.md). Canonical
// snake_case only; the GearSkeptic header aliases stay an import-only alias.
type SampleFood = {
  name: string; brand: string | null; serving: string
  sw: number; cal: number; perPkg: number | null
  fat: number | null; sat: number | null; carbs: number | null; fiber: number | null
  sugar: number | null; protein: number | null; sodium: number | null; potassium: number | null
  notes: string | null
}
const SAMPLE_FOODS: SampleFood[] = [
  { name: 'Instant oatmeal', brand: 'Quaker', serving: '1 packet', sw: 43, cal: 150, perPkg: 1, fat: 3, sat: 0.5, carbs: 27, fiber: 3, sugar: 12, protein: 4, sodium: 100, potassium: 130, notes: 'Add hot water; doubles as a base for add-ins.' },
  { name: 'Instant coffee', brand: 'Starbucks Via', serving: '1 stick', sw: 2.3, cal: 5, perPkg: 1, fat: null, sat: null, carbs: 0, fiber: 0, sugar: 0, protein: null, sodium: null, potassium: null, notes: 'Label only lists calories. Macros unknown.' },
  { name: 'Powdered milk', brand: 'Nido', serving: '3 tbsp', sw: 24, cal: 80, perPkg: 8, fat: 0, sat: 0, carbs: 12, fiber: 0, sugar: 12, protein: 8, sodium: 120, potassium: 380, notes: null },
  { name: 'Meal bar', brand: 'ProBar', serving: '1 bar', sw: 85, cal: 370, perPkg: 1, fat: 18, sat: 3, carbs: 44, fiber: 5, sugar: 22, protein: 9, sodium: 150, potassium: 350, notes: null },
  { name: 'Energy bar, crunchy PB', brand: 'Clif', serving: '1 bar', sw: 68, cal: 260, perPkg: 1, fat: 9, sat: 2, carbs: 39, fiber: 5, sugar: 17, protein: 9, sodium: 200, potassium: 250, notes: null },
  { name: 'Trail mix', brand: 'Bulk bin', serving: '30 g', sw: 30, cal: 150, perPkg: null, fat: 9, sat: 1.5, carbs: 14, fiber: 2, sugar: 8, protein: 4, sodium: 45, potassium: 160, notes: 'Bought by weight - no fixed package.' },
  { name: 'Peanut butter packet', brand: "Justin's", serving: '1 packet', sw: 32, cal: 190, perPkg: 1, fat: 16, sat: 2.5, carbs: 7, fiber: 2, sugar: 2, protein: 7, sodium: 65, potassium: null, notes: 'Potassium not on label.' },
  { name: 'Beef stroganoff', brand: 'Mountain House', serving: '1 cup', sw: 70, cal: 250, perPkg: 2, fat: 9, sat: 4, carbs: 32, fiber: 2, sugar: 4, protein: 11, sodium: 720, potassium: 300, notes: 'Pouch is 2 servings.' },
  { name: 'Pasta side, alfredo', brand: 'Knorr', serving: '1/2 pouch', sw: 61, cal: 240, perPkg: 2, fat: 6, sat: 3, carbs: 41, fiber: 2, sugar: 3, protein: 8, sodium: 770, potassium: 200, notes: null },
  { name: 'Olive oil', brand: null, serving: '1 tbsp', sw: 14, cal: 120, perPkg: null, fat: 14, sat: 2, carbs: 0, fiber: 0, sugar: 0, protein: 0, sodium: 0, potassium: 0, notes: 'Calorie-dense dinner add.' },
  { name: 'Flour tortilla', brand: 'Mission', serving: '1 tortilla', sw: 49, cal: 140, perPkg: 8, fat: 4, sat: 1.5, carbs: 24, fiber: 1, sugar: 1, protein: 4, sodium: 350, potassium: 70, notes: null },
  { name: 'Summer sausage', brand: 'Hickory Farms', serving: '28 g', sw: 28, cal: 110, perPkg: null, fat: 10, sat: 4, carbs: 1, fiber: 0, sugar: 0, protein: 5, sodium: 430, potassium: 90, notes: 'Sliced from a chub - entered by weight.' },
  { name: 'Cheddar cheese', brand: 'Tillamook', serving: '28 g', sw: 28, cal: 110, perPkg: null, fat: 9, sat: 6, carbs: 1, fiber: 0, sugar: 0, protein: 7, sodium: 180, potassium: 28, notes: null },
  { name: 'Tuna packet', brand: 'StarKist', serving: '1 pouch', sw: 74, cal: 80, perPkg: 1, fat: 1, sat: 0, carbs: 0, fiber: 0, sugar: 0, protein: 17, sodium: 230, potassium: 200, notes: null },
  { name: 'Dehydrated refried beans', brand: 'Harmony House', serving: '1/3 cup', sw: 35, cal: 120, perPkg: 6, fat: 1, sat: 0, carbs: 20, fiber: 7, sugar: 1, protein: 7, sodium: 330, potassium: 500, notes: null },
  { name: 'Chocolate bar', brand: 'Snickers', serving: '1 bar', sw: 52, cal: 250, perPkg: 1, fat: 12, sat: 4.5, carbs: 33, fiber: 1, sugar: 27, protein: 4, sodium: 120, potassium: 150, notes: null },
  { name: 'Energy waffle', brand: 'Honey Stinger', serving: '1 waffle', sw: 30, cal: 140, perPkg: 1, fat: 6, sat: 2.5, carbs: 21, fiber: 0, sugar: 9, protein: 1, sodium: 50, potassium: null, notes: null },
  { name: 'Peanut candies', brand: "M&M's", serving: '1/4 cup', sw: 40, cal: 200, perPkg: 1, fat: 10, sat: 4, carbs: 24, fiber: 2, sugar: 21, protein: 4, sodium: 20, potassium: 130, notes: null },
  { name: 'Electrolyte mix', brand: 'LMNT', serving: '1 stick', sw: 6, cal: 10, perPkg: 1, fat: 0, sat: 0, carbs: 2, fiber: 0, sugar: 0, protein: 0, sodium: 1000, potassium: 200, notes: null },
  { name: 'Fruit leather', brand: 'Homemade', serving: '1 strip', sw: 15, cal: 45, perPkg: null, fat: null, sat: null, carbs: 11, fiber: null, sugar: 9, protein: null, sodium: null, potassium: null, notes: 'Homemade - only calories, carbs and sugar measured.' },
  { name: 'Dark chocolate', brand: "Lily's", serving: '2 squares', sw: 20, cal: 110, perPkg: 5, fat: 8, sat: 5, carbs: 9, fiber: 2, sugar: 5, protein: 2, sodium: 5, potassium: 80, notes: null },
  { name: 'Emergency ration bar', brand: 'Datrex', serving: '1 bar', sw: 55, cal: 200, perPkg: 1, fat: 8, sat: 4, carbs: 30, fiber: 0, sugar: 14, protein: 2, sodium: 5, potassium: null, notes: 'Carried, not planned to eat.' },
]

const SAMPLE_FOOD_ITEMS: FoodItem[] = SAMPLE_FOODS.map((f, i) => ({
  id: `sample-${i}`,
  user_id: 'sample',
  name: f.name,
  brand: f.brand,
  serving_description: f.serving,
  serving_weight_grams: f.sw,
  calories_per_serving: f.cal,
  servings_per_package: f.perPkg,
  fat_grams: f.fat,
  saturated_fat_grams: f.sat,
  carbs_grams: f.carbs,
  fiber_grams: f.fiber,
  sugar_grams: f.sugar,
  protein_grams: f.protein,
  sodium_mg: f.sodium,
  potassium_mg: f.potassium,
  notes: f.notes,
  sort_order: i,
  created_at: '',
  updated_at: '',
}))

export const FOOD_SAMPLE_CSV = foodItemsToCsv(SAMPLE_FOOD_ITEMS)

// One parsed CSV data row: the mapped FoodItemInput when valid, or null with a
// non-empty errors list. The preview renders every row (valid and invalid) and
// blocks import unless every row is valid.
export type FoodImportRow = {
  rowNumber: number // 1-based data row index (header excluded), for the preview
  name: string // best-effort name for display even when the row is invalid
  item: FoodItemInput | null
  errors: string[]
}

// DB column maxima (food_items CHECK constraints). Text is sliced to these so a
// long cell can't abort the bulk INSERT; numerics are validated, not clamped.
const NAME_MAX = 256
const BRAND_MAX = 256
const SERVING_DESC_MAX = 256
const NOTES_MAX = 2000

// Strict decimal: no thousands separators, no trailing units, no hex/Infinity.
const DECIMAL_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

function parseNumber(raw: string): { value: number | null } | { error: true } {
  const s = raw.trim()
  if (s === '') return { value: null }
  if (!DECIMAL_RE.test(s)) return { error: true }
  const n = Number(s)
  if (!Number.isFinite(n)) return { error: true }
  return { value: n }
}

// Resolve the first present header (lowercased by parseCsv) from candidates.
function resolveKey(keys: string[], candidates: string[]): string | undefined {
  return keys.find((k) => candidates.includes(k))
}

// Parses the Food library CSV (canonical snake_case headers + GearSkeptic
// aliases). Returns a top-level error string for whole-file problems (empty,
// too many rows, missing required columns); otherwise one FoodImportRow per
// data row. Blanks in optional fields become null (never 0). Optional numeric
// fields are validated against the DB CHECK constraints (nutrients >= 0,
// servings_per_package > 0) so a value the DB would reject fails in the preview
// rather than aborting the bulk INSERT.
export function parseFoodCsv(text: string): FoodImportRow[] | string {
  const rows = parseCsv(text)
  const [sample] = rows
  if (!sample) return 'File appears empty or has no data rows.'
  if (rows.length > MAX_CSV_ROWS) {
    return `This file has more than ${MAX_CSV_ROWS.toLocaleString('en-US')} rows, which is too many to import at once. Split it into smaller files and import them one at a time.`
  }

  const keys = Object.keys(sample)
  const nameKey = resolveKey(keys, ['name', 'flavor'])
  const brandKey = resolveKey(keys, ['brand'])
  const servDescKey = resolveKey(keys, ['serving_description', 'class'])
  const swKey = resolveKey(keys, ['serving_weight_grams', 'serv(g)'])
  const calKey = resolveKey(keys, ['calories_per_serving', 'cal/serv'])
  const servingsKey = resolveKey(keys, ['servings_per_package', 'servings'])
  const fatKey = resolveKey(keys, ['fat_grams', 'fat'])
  const satFatKey = resolveKey(keys, ['saturated_fat_grams'])
  const carbsKey = resolveKey(keys, ['carbs_grams', 'carbs'])
  const fiberKey = resolveKey(keys, ['fiber_grams', 'fiber'])
  const sugarKey = resolveKey(keys, ['sugar_grams', 'sugar'])
  const proteinKey = resolveKey(keys, ['protein_grams', 'protein'])
  const sodiumKey = resolveKey(keys, ['sodium_mg', 'na'])
  const potassiumKey = resolveKey(keys, ['potassium_mg', 'k'])
  const notesKey = resolveKey(keys, ['notes'])

  const missing: string[] = []
  if (!nameKey) missing.push('name')
  if (!swKey) missing.push('serving_weight_grams')
  if (!calKey) missing.push('calories_per_serving')
  if (missing.length > 0) {
    return `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. The file needs at least name, serving_weight_grams, and calories_per_serving (GearSkeptic Flavor / Serv(g) / Cal/Serv also work).`
  }

  return rows.map((row, i) => {
    const errors: string[] = []

    // Trimmed text cell, sliced to its DB max; blank -> null.
    const text2 = (key: string | undefined, max: number): string | null => {
      if (!key) return null
      const s = (row[key] ?? '').trim().slice(0, max)
      return s === '' ? null : s
    }

    const name = (nameKey ? row[nameKey] ?? '' : '').trim().slice(0, NAME_MAX)
    if (!name) errors.push('Name is required')

    // Required: serving_weight_grams (finite, > 0).
    let serving_weight_grams = 0
    const sw = parseNumber(swKey ? row[swKey] ?? '' : '')
    if ('error' in sw) errors.push('Serving weight must be a number')
    else if (sw.value === null) errors.push('Serving weight is required')
    else if (sw.value <= 0) errors.push('Serving weight must be greater than 0')
    else serving_weight_grams = sw.value

    // Required: calories_per_serving (finite, >= 0).
    let calories_per_serving = 0
    const cal = parseNumber(calKey ? row[calKey] ?? '' : '')
    if ('error' in cal) errors.push('Calories must be a number')
    else if (cal.value === null) errors.push('Calories is required')
    else if (cal.value < 0) errors.push('Calories cannot be negative')
    else calories_per_serving = cal.value

    // Optional non-negative nutrient (blank -> null; present must be finite, >= 0).
    const optNonNeg = (key: string | undefined, label: string): number | null => {
      if (!key) return null
      const p = parseNumber(row[key] ?? '')
      if ('error' in p) {
        errors.push(`${label} must be a number`)
        return null
      }
      if (p.value === null) return null
      if (p.value < 0) {
        errors.push(`${label} cannot be negative`)
        return null
      }
      return p.value
    }

    // Optional positive (servings_per_package: blank -> null; present must be > 0).
    let servings_per_package: number | null = null
    if (servingsKey) {
      const p = parseNumber(row[servingsKey] ?? '')
      if ('error' in p) errors.push('Servings per package must be a number')
      else if (p.value !== null) {
        if (p.value <= 0) errors.push('Servings per package must be greater than 0')
        else servings_per_package = p.value
      }
    }

    const fat_grams = optNonNeg(fatKey, 'Fat')
    const saturated_fat_grams = optNonNeg(satFatKey, 'Saturated fat')
    const carbs_grams = optNonNeg(carbsKey, 'Carbs')
    const fiber_grams = optNonNeg(fiberKey, 'Fiber')
    const sugar_grams = optNonNeg(sugarKey, 'Sugar')
    const protein_grams = optNonNeg(proteinKey, 'Protein')
    const sodium_mg = optNonNeg(sodiumKey, 'Sodium')
    const potassium_mg = optNonNeg(potassiumKey, 'Potassium')

    const item: FoodItemInput | null =
      errors.length > 0
        ? null
        : {
            name,
            brand: text2(brandKey, BRAND_MAX),
            serving_description: text2(servDescKey, SERVING_DESC_MAX),
            serving_weight_grams,
            calories_per_serving,
            servings_per_package,
            fat_grams,
            saturated_fat_grams,
            carbs_grams,
            fiber_grams,
            sugar_grams,
            protein_grams,
            sodium_mg,
            potassium_mg,
            notes: text2(notesKey, NOTES_MAX),
          }

    return { rowNumber: i + 1, name, item, errors }
  })
}
