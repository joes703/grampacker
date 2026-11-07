// CSV-import-specific weight parser. Distinct from a "real" unit
// converter (e.g., src/lib/weight.ts) in three ways:
// - returns 0 on NaN/negative input rather than throwing or returning
//   null (the import pipeline filters empty-name rows but tolerates
//   zero weights, so a zero-grams row is a valid "weight unknown"
//   signal rather than a parse failure).
// - clamps to MAX_ITEM_WEIGHT_GRAMS (loose upper bound matching the gear
//   item weightGrams cap the server enforces; without this an over-cap
//   row would be rejected on insert and could take the rest of the
//   import batch down with it).
// - defaults to grams on unknown unit (CSV import tolerance: a typo
//   like "kgs" or an empty unit becomes grams; matches the prior behavior).
//
// Used by gear.parseGearCsv and list.parseListCsv. Lives
// outside either to avoid circular imports and to keep the dependency
// direction one-way (gear/list -> units, never the reverse).
import { MAX_ITEM_WEIGHT_GRAMS } from '../caps'
import { roundGrams } from '../weight'

// Grams per unit. A unit not listed here counts as grams (see above).
// A Map, because the unit is text from the file: a plain object would answer
// "constructor" with a function.
const GRAMS_PER_UNIT = new Map<string, number>([
  ['', 1],
  ['g', 1],
  ['gram', 1],
  ['grams', 1],
  ['oz', 28.3495],
  ['ounce', 28.3495],
  ['ounces', 28.3495],
  ['lb', 453.592],
  ['pound', 453.592],
  ['pounds', 453.592],
  ['kg', 1000],
  ['kilogram', 1000],
  ['kilograms', 1000],
])

function gramsPerUnit(unit: string): number | undefined {
  return GRAMS_PER_UNIT.get(unit.trim().toLowerCase())
}

export function toGrams(value: string, unit: string): number {
  const n = parseFloat(value)
  if (isNaN(n) || n < 0) return 0
  // Round to one decimal, not to a whole gram. Rounding to integers here
  // silently discarded up to 0.5 g per row on every ounce-denominated import
  // (4.2 oz landed as 119 g instead of 119.1 g).
  return Math.min(roundGrams(n * (gramsPerUnit(unit) ?? 1)), MAX_ITEM_WEIGHT_GRAMS)
}

// A plain decimal. parseFloat alone would read "1,200" as 1 and "12abc" as 12.
const PLAIN_NUMBER = /^(\d+\.?\d*|\.\d+)$/

// True when toGrams had to replace or guess: the import preview shows these in
// red. A blank weight is not one of them, since a Lighterpack export leaves it
// blank to mean no weight.
export function weightIsUnreadable(value: string, unit: string): boolean {
  const text = value.trim()
  if (text === '') return false
  const factor = gramsPerUnit(unit)
  if (!PLAIN_NUMBER.test(text) || factor === undefined) return true
  return roundGrams(Number(text) * factor) > MAX_ITEM_WEIGHT_GRAMS
}

// True when clampQuantity had to replace the value. Blank means 1.
export function quantityIsUnreadable(value: string, max: number): boolean {
  const text = value.trim()
  if (text === '') return false
  const n = Number(text)
  return !PLAIN_NUMBER.test(text) || !Number.isInteger(n) || n < 1 || n > max
}
