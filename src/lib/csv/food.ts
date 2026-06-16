import type { FoodItem } from '../types'
import type { FoodItemInput } from '../queries/food'
import { toCsv, parseCsv, MAX_CSV_ROWS } from './core'

// Serialize the food library for account takeout. Missing optional values
// render as '' (never 0): unknown stays unknown (Story 1, Story 5).
export function foodItemsToCsv(items: FoodItem[]): string {
  const rows = items.map((f) => ({
    'Food Name': f.name,
    Brand: f.brand ?? '',
    'Serving Description': f.serving_description ?? '',
    'Serving Weight (g)': f.serving_weight_grams,
    'Calories per Serving': f.calories_per_serving,
    'Servings per Package': f.servings_per_package ?? '',
    'Fat (g)': f.fat_grams ?? '',
    'Saturated Fat (g)': f.saturated_fat_grams ?? '',
    'Carbs (g)': f.carbs_grams ?? '',
    'Fiber (g)': f.fiber_grams ?? '',
    'Sugar (g)': f.sugar_grams ?? '',
    'Protein (g)': f.protein_grams ?? '',
    'Sodium (mg)': f.sodium_mg ?? '',
    'Potassium (mg)': f.potassium_mg ?? '',
    Notes: f.notes ?? '',
  }))
  return toCsv(rows)
}

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
