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

// list and food CSV exports (listItemsToCsv/parseListCsv,
// foodItemsToCsv/parseFoodCsv, and their row types) return with their
// respective slices.
