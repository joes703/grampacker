import type { FoodItem } from '../types'
import { toCsv, parseCsv, MAX_CSV_ROWS } from './core'
import {
  createFoodItemRequestSchema,
  type CreateFoodItemRequest,
} from '../../../shared/food'

// The canonical Grampacker Food CSV header: snake_case column names, byte-
// identical to the old repo's export so an old-app takeout imports cleanly
// here (and vice versa). SINGLE SOURCE OF TRUTH shared by export
// (foodItemsToCsv emits exactly this), import (parseFoodCsv reads these
// canonical names), and the import-explainer help copy. GearSkeptic headers
// are an import-only convenience alias and are never part of this list.
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

// The nutrition surface of a food item - what the CSV carries. A structural
// subset of FoodItemResponse so both real library items and the sample data
// below satisfy it without fake ids/timestamps.
export type FoodCsvItem = Pick<
  FoodItem,
  | 'name'
  | 'brand'
  | 'servingDescription'
  | 'servingWeightGrams'
  | 'caloriesPerServing'
  | 'servingsPerPackage'
  | 'fatGrams'
  | 'saturatedFatGrams'
  | 'carbsGrams'
  | 'fiberGrams'
  | 'sugarGrams'
  | 'proteinGrams'
  | 'sodiumMg'
  | 'potassiumMg'
  | 'notes'
>

// Serialize the food library to the canonical CSV (FOOD_CSV_HEADERS), the
// SAME format parseFoodCsv reads, so export -> import round-trips every
// field. The Record type binds the row keys to FOOD_CSV_HEADERS, so a column
// rename/reorder is a compile error here. Null renders as '' (never 0) so
// unknown stays unknown, and import reads those empty cells back as null;
// a real 0 stays 0.
// The shapes that are ambiguous with the spreadsheet text-marker escape:
// zero or more apostrophes followed by a formula character. escapeCell in
// core.ts prefixes ONE apostrophe to bare formula-char cells; for the food
// round-trip contract that transformation must be reversible, so export
// prefixes an apostrophe to EVERY value of this shape (escaping the escape:
// '=x exports as ''=x) and import strips exactly one apostrophe from the
// shape. decode(encode(s)) === s for every storable value - stored text is
// schema-trimmed, so it can never begin with the tab/CR members of the
// class, which exist here only to stay aligned with escapeCell's set.
// Once encoded, these cells start with an apostrophe, so escapeCell itself
// no-ops on them and spreadsheet formula-injection safety is preserved.
const FORMULA_ESCAPE_SHAPE = /^'*[=+\-@\t\r]/

function escapeFoodText(s: string): string {
  return FORMULA_ESCAPE_SHAPE.test(s) ? `'${s}` : s
}

function unescapeFormulaPrefix(s: string): string {
  if (s.startsWith("'") && FORMULA_ESCAPE_SHAPE.test(s.slice(1))) return s.slice(1)
  return s
}

export function foodItemsToCsv(items: FoodCsvItem[]): string {
  // toCsv derives headers from the first row, so zero items would yield a
  // zero-byte file; the takeout bundle promises a stable header-only CSV
  // instead (Codex finding).
  if (items.length === 0) return FOOD_CSV_HEADER
  const rows = items.map(
    (f): Record<(typeof FOOD_CSV_HEADERS)[number], string | number> => ({
      name: escapeFoodText(f.name),
      brand: escapeFoodText(f.brand ?? ''),
      serving_description: escapeFoodText(f.servingDescription ?? ''),
      serving_weight_grams: f.servingWeightGrams,
      calories_per_serving: f.caloriesPerServing,
      servings_per_package: f.servingsPerPackage ?? '',
      fat_grams: f.fatGrams ?? '',
      saturated_fat_grams: f.saturatedFatGrams ?? '',
      carbs_grams: f.carbsGrams ?? '',
      fiber_grams: f.fiberGrams ?? '',
      sugar_grams: f.sugarGrams ?? '',
      protein_grams: f.proteinGrams ?? '',
      sodium_mg: f.sodiumMg ?? '',
      potassium_mg: f.potassiumMg ?? '',
      notes: escapeFoodText(f.notes ?? ''),
    }),
  )
  return toCsv(rows)
}

// Realistic sample library ported from the old repo (originally the approved
// Claude Design food study): one 7-day backpacking trip's worth of foods.
// Deliberately mixes packaged foods, by-weight foods (no servingsPerPackage),
// foods with genuinely-unknown macros (null, NEVER 0 - e.g. instant coffee),
// and real zeros (olive oil sodium), so the sample doubles as smoke-test
// data for the Food Plan UI. Compact keys keep the table readable; the map
// below expands them to FoodCsvItem.
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

export const FOOD_SAMPLE_CSV = foodItemsToCsv(
  SAMPLE_FOODS.map((f) => ({
    name: f.name,
    brand: f.brand,
    servingDescription: f.serving,
    servingWeightGrams: f.sw,
    caloriesPerServing: f.cal,
    servingsPerPackage: f.perPkg,
    fatGrams: f.fat,
    saturatedFatGrams: f.sat,
    carbsGrams: f.carbs,
    fiberGrams: f.fiber,
    sugarGrams: f.sugar,
    proteinGrams: f.protein,
    sodiumMg: f.sodium,
    potassiumMg: f.potassium,
    notes: f.notes,
  })),
)

// One parsed CSV data row: the validated create-request when valid, or null
// with a non-empty errors list. The preview renders every row (valid and
// invalid) and blocks import unless every row is valid. `item` is the schema
// OUTPUT (defaults applied, every field present), so what the preview
// approves is byte-for-byte what the import endpoint receives.
export type FoodImportRow = {
  rowNumber: number // 1-based data row index (header excluded), for the preview
  name: string // best-effort name for display even when the row is invalid
  item: CreateFoodItemRequest | null
  errors: string[]
}

// Text caps (shared/food.ts schema maxima; the DB CHECKs mirror them). Text
// is sliced to these so a long cell can't fail the row; numbers are
// validated, not clamped (a silently rounded number would corrupt data).
const NAME_MAX = 256
const BRAND_MAX = 256
const SERVING_DESC_MAX = 256
const NOTES_MAX = 2000

// Numeric bounds, mirroring shared/food.ts's decimalNumber() fields. Kept in
// friendly-message form here so the preview says "Fat can have at most 2
// decimal places" instead of surfacing a zod issue path; the schema parse at
// the end of each row is the enforcement backstop.
type NumericBounds = { max: number; decimals: number }
const THREE_DP: NumericBounds = { max: 9_999_999.999, decimals: 3 } // numeric(10,3)
const TWO_DP: NumericBounds = { max: 99_999_999.99, decimals: 2 } // numeric(10,2)
const ONE_DP: NumericBounds = { max: 999_999_999.9, decimals: 1 } // numeric(10,1)

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

// Bounds shared/food.ts enforces beyond sign: magnitude and decimal places.
// The round-trip decimal check matches the schema's exactly (see
// decimalNumber in shared/food.ts for why it's not an epsilon compare).
function boundsError(value: number, label: string, bounds: NumericBounds): string | null {
  if (value > bounds.max) return `${label} is too large`
  const scale = 10 ** bounds.decimals
  if (Math.round(value * scale) / scale !== value) {
    return `${label} can have at most ${bounds.decimals} decimal place${bounds.decimals > 1 ? 's' : ''}`
  }
  return null
}

// Parses the food library CSV (canonical snake_case headers + GearSkeptic
// import-only aliases). Returns a top-level error string for whole-file
// problems (empty, too many rows, missing required columns); otherwise one
// FoodImportRow per data row. Blanks in optional fields become null (never
// 0). Validation matches shared/food.ts createFoodItemRequestSchema so a row
// that survives the preview cannot 400 the atomic import; each valid row is
// run through that schema as the parity backstop.
export function parseFoodCsv(text: string): FoodImportRow[] | string {
  const rows = parseCsv(text)
  const [sample] = rows
  if (!sample) return 'File appears empty or has no data rows.'
  if (rows.length > MAX_CSV_ROWS) {
    return `This file has more than ${MAX_CSV_ROWS.toLocaleString('en-US')} rows, which is too many to import at once. Split it into smaller files and import them one at a time.`
  }

  const keys = Object.keys(sample)
  // Candidate-priority resolution (NOT keys.find): the canonical column must
  // win over an alias regardless of column order in the file. Mirrors the
  // two-pass cost/price lookup in gear.ts.
  const resolveKey = (...candidates: string[]): string | undefined =>
    candidates.find((c) => keys.includes(c))

  const nameKey = resolveKey('name', 'flavor')
  const brandKey = resolveKey('brand')
  const servDescKey = resolveKey('serving_description', 'class')
  const swKey = resolveKey('serving_weight_grams', 'serv(g)')
  const calKey = resolveKey('calories_per_serving', 'cal/serv')
  const servingsKey = resolveKey('servings_per_package', 'servings')
  const fatKey = resolveKey('fat_grams', 'fat')
  const satFatKey = resolveKey('saturated_fat_grams')
  const carbsKey = resolveKey('carbs_grams', 'carbs')
  const fiberKey = resolveKey('fiber_grams', 'fiber')
  const sugarKey = resolveKey('sugar_grams', 'sugar')
  const proteinKey = resolveKey('protein_grams', 'protein')
  const sodiumKey = resolveKey('sodium_mg', 'na')
  const potassiumKey = resolveKey('potassium_mg', 'k')
  const notesKey = resolveKey('notes')

  const missing: string[] = []
  if (!nameKey) missing.push('name')
  if (!swKey) missing.push('serving_weight_grams')
  if (!calKey) missing.push('calories_per_serving')
  // Guard on the keys themselves (not missing.length) so the const
  // narrowing to `string` survives into the rows.map closure below.
  if (!nameKey || !swKey || !calKey) {
    return `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. The file needs at least name, serving_weight_grams, and calories_per_serving (GearSkeptic Flavor / Serv(g) / Cal/Serv also work).`
  }

  return rows.map((row, i) => {
    const errors: string[] = []

    // Trimmed text cell, sliced to its schema max; blank -> null. The
    // formula-prefix escape decodes FIRST so a max-length escaped field
    // (257 chars on the wire) is not clipped by the slice.
    const textCell = (key: string | undefined, max: number): string | null => {
      if (!key) return null
      const s = unescapeFormulaPrefix(row[key] ?? '').trim().slice(0, max)
      return s === '' ? null : s
    }

    const name = unescapeFormulaPrefix(row[nameKey] ?? '').trim().slice(0, NAME_MAX)
    if (!name) errors.push('Name is required')

    // Required: serving_weight_grams (finite, > 0, numeric(10,3)).
    let servingWeightGrams = 0
    const sw = parseNumber(row[swKey] ?? '')
    if ('error' in sw) errors.push('Serving weight must be a number')
    else if (sw.value === null) errors.push('Serving weight is required')
    else if (sw.value <= 0) errors.push('Serving weight must be greater than 0')
    else {
      const e = boundsError(sw.value, 'Serving weight', THREE_DP)
      if (e) errors.push(e)
      else servingWeightGrams = sw.value
    }

    // Required: calories_per_serving (finite, >= 0, numeric(10,2)).
    let caloriesPerServing = 0
    const cal = parseNumber(row[calKey] ?? '')
    if ('error' in cal) errors.push('Calories must be a number')
    else if (cal.value === null) errors.push('Calories is required')
    else if (cal.value < 0) errors.push('Calories cannot be negative')
    else {
      const e = boundsError(cal.value, 'Calories', TWO_DP)
      if (e) errors.push(e)
      else caloriesPerServing = cal.value
    }

    // Optional non-negative nutrient (blank -> null; present must be finite,
    // >= 0, and within its column's precision).
    const optNonNeg = (
      key: string | undefined,
      label: string,
      bounds: NumericBounds,
    ): number | null => {
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
      const e = boundsError(p.value, label, bounds)
      if (e) {
        errors.push(e)
        return null
      }
      return p.value
    }

    // Optional positive (servings_per_package: blank -> null; present must
    // be > 0 - a package can't have zero servings, and NULL is the
    // incomplete-projection signal so blank and 0 must not collapse).
    let servingsPerPackage: number | null = null
    if (servingsKey) {
      const p = parseNumber(row[servingsKey] ?? '')
      if ('error' in p) errors.push('Servings per package must be a number')
      else if (p.value !== null) {
        if (p.value <= 0) errors.push('Servings per package must be greater than 0')
        else {
          const e = boundsError(p.value, 'Servings per package', THREE_DP)
          if (e) errors.push(e)
          else servingsPerPackage = p.value
        }
      }
    }

    const fatGrams = optNonNeg(fatKey, 'Fat', TWO_DP)
    const saturatedFatGrams = optNonNeg(satFatKey, 'Saturated fat', TWO_DP)
    const carbsGrams = optNonNeg(carbsKey, 'Carbs', TWO_DP)
    const fiberGrams = optNonNeg(fiberKey, 'Fiber', TWO_DP)
    const sugarGrams = optNonNeg(sugarKey, 'Sugar', TWO_DP)
    const proteinGrams = optNonNeg(proteinKey, 'Protein', TWO_DP)
    const sodiumMg = optNonNeg(sodiumKey, 'Sodium', ONE_DP)
    const potassiumMg = optNonNeg(potassiumKey, 'Potassium', ONE_DP)

    let item: CreateFoodItemRequest | null = null
    if (errors.length === 0) {
      // Parity backstop: the friendly checks above are meant to be exactly
      // as strict as the shared schema, but the schema is the contract the
      // import endpoint enforces, so run it. Anything it rejects that the
      // checks above missed (e.g. a NUL byte in a text field) becomes a row
      // error here instead of a 400 that aborts the whole atomic import.
      const parsed = createFoodItemRequestSchema.safeParse({
        name,
        brand: textCell(brandKey, BRAND_MAX),
        servingDescription: textCell(servDescKey, SERVING_DESC_MAX),
        servingWeightGrams,
        caloriesPerServing,
        servingsPerPackage,
        fatGrams,
        saturatedFatGrams,
        carbsGrams,
        fiberGrams,
        sugarGrams,
        proteinGrams,
        sodiumMg,
        potassiumMg,
        notes: textCell(notesKey, NOTES_MAX),
      })
      if (parsed.success) item = parsed.data
      else {
        for (const issue of parsed.error.issues) {
          errors.push(
            issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
          )
        }
      }
    }

    return { rowNumber: i + 1, name, item, errors }
  })
}
