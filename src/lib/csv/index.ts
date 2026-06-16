// Public barrel for the csv domain. External consumers import from
// '../lib/csv' (which resolves to this file once src/lib/csv.ts is
// removed and src/lib/csv/ exists), never from a specific submodule.
// The per-format file layout is an internal organizational concern.
//
// Internal cross-module imports inside src/lib/csv/ go directly to the
// source module (./core, ./units, ./gear, ./list), never through this
// barrel, to avoid circular module resolution and to keep dependency
// direction one-way.

export { toCsv, downloadCsv, parseCsv, MAX_CSV_ROWS } from './core'
export { gearItemsToCsv, parseGearCsv } from './gear'
export type { GearCsvRow } from './gear'
export { foodItemsToCsv, parseFoodCsv, FOOD_CSV_HEADER, FOOD_CSV_HEADERS } from './food'
export type { FoodImportRow } from './food'
export { listItemsToCsv, parseListCsv, nameFromCsvFilename } from './list'
export type { ListImportRow } from './list'
