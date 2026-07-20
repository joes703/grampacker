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
// Used by gear.parseGearCsv (and, once ported, list.parseListCsv). Lives
// outside either to avoid circular imports and to keep the dependency
// direction one-way (gear/list -> units, never the reverse).
import { MAX_ITEM_WEIGHT_GRAMS } from '../caps'
import { roundGrams } from '../weight'

export function toGrams(value: string, unit: string): number {
  const n = parseFloat(value)
  if (isNaN(n) || n < 0) return 0
  let grams: number
  switch (unit.trim().toLowerCase()) {
    case 'oz':
    case 'ounce':
    case 'ounces':
      grams = n * 28.3495
      break
    case 'lb':
    case 'pound':
    case 'pounds':
      grams = n * 453.592
      break
    case 'kg':
    case 'kilogram':
    case 'kilograms':
      grams = n * 1000
      break
    case '':
    case 'g':
    case 'gram':
    case 'grams':
    default:
      // Empty + g/gram/grams take the default; unknown units (typos
      // etc.) also default to grams as the most-tolerant fallback.
      // Matches the previous behavior, just with the happy path now
      // explicit instead of hidden under `default`.
      grams = n
  }
  // Round to one decimal, not to a whole gram. Rounding to integers here
  // silently discarded up to 0.5 g per row on every ounce-denominated import
  // (4.2 oz landed as 119 g instead of 119.1 g).
  return Math.min(roundGrams(grams), MAX_ITEM_WEIGHT_GRAMS)
}
