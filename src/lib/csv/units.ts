// CSV-import-specific weight parser. Distinct from a "real" unit
// converter (e.g., src/lib/weight.ts) in three ways:
// - returns 0 on NaN/negative input rather than throwing or returning
//   null (the import pipeline filters empty-name rows but tolerates
//   zero weights, so a zero-grams row is a valid "weight unknown"
//   signal rather than a parse failure).
// - clamps to 100000 grams (loose upper bound matching the gear_items
//   weight_grams CHECK constraint; without this an over-cap row aborts
//   the bulk insert with Postgres 22003 numeric_value_out_of_range,
//   killing the whole batch).
// - defaults to grams on unknown unit (CSV import tolerance: a typo
//   like "kgs" or an empty unit becomes grams; matches the prior behavior).
//
// Used by both gear.parseGearCsv and list.parseListCsv. Lives outside
// either to avoid circular imports and to keep the dependency
// direction one-way (gear/list → units, never the reverse).
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
  return Math.min(Math.round(grams), 100000)
}
