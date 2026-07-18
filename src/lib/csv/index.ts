// Public barrel for the csv domain. External consumers import from
// '../lib/csv', never from a specific submodule. The per-format file
// layout is an internal organizational concern.
//
// Internal cross-module imports inside src/lib/csv/ go directly to the
// source module (./core, ./units, ./gear), never through this barrel, to
// avoid circular module resolution and to keep dependency direction
// one-way. toGrams (./units) stays internal by design, as it did in the
// old repo's barrel.
//
// The import planner (./import-plan) and its dedup helper (./sort-keys)
// are not re-exported here; consumers import them directly from
// '../lib/csv/import-plan' to keep this barrel to the format adapters.

export { toCsv, downloadCsv, parseCsv, MAX_CSV_ROWS } from './core'
export { gearItemsToCsv, parseGearCsv } from './gear'
export type { GearCsvRow } from './gear'
export { listItemsToCsv, parseListCsv, nameFromCsvFilename } from './list'
export type { ListCsvRow } from './list'
export {
  foodItemsToCsv,
  parseFoodCsv,
  FOOD_CSV_HEADERS,
  FOOD_CSV_HEADER,
  FOOD_SAMPLE_CSV,
} from './food'
export type { FoodCsvItem, FoodImportRow } from './food'
