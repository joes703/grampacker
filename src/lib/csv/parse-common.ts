import { parseCsv, MAX_CSV_ROWS } from './core'
import { parseCostFromColumn } from './money'
import { toGrams } from './units'
import { MAX_NAME_LENGTH } from '../caps'

// The parse preamble and base fields both importers (gear library and list)
// share. Each accepts our own export format AND the Lighterpack format; the
// columns they resolve identically live here so the two parsers cannot
// drift.

type CsvRecord = ReturnType<typeof parseCsv>[number]

export type CommonCsvColumns = {
  // Every header key, for the importer-specific columns (purchase_date,
  // qty, worn, consumable) resolved by each caller.
  keys: string[]
  nameKey: string
  weightKey: string
  unitKey: string | undefined
  descKey: string | undefined
  catKey: string | undefined
  costKey: string | undefined
  costKind: 'cost' | 'price'
}

// Parses the CSV text and resolves the shared columns (case-insensitive -
// parseCsv lowercases headers - with aliases). Returns an error string for
// the user when the file is empty, too large, or missing a required column.
export function parseCsvWithCommonColumns(
  text: string,
): { rows: CsvRecord[]; cols: CommonCsvColumns } | string {
  const rows = parseCsv(text)
  const [sample] = rows
  if (!sample) return 'File appears empty or has no data rows.'
  if (rows.length > MAX_CSV_ROWS) {
    return `This file has more than ${MAX_CSV_ROWS.toLocaleString('en-US')} rows, which is too many to import at once. Split it into smaller files and import them one at a time.`
  }

  const keys = Object.keys(sample)

  const nameKey = keys.find((k) => k === 'name' || k === 'item name')
  const weightKey = keys.find((k) => k === 'weight_grams' || k === 'weight (g)' || k === 'weight')
  const unitKey = keys.find((k) => k === 'unit')
  const descKey = keys.find((k) => k === 'description' || k === 'desc' || k === 'notes')
  const catKey = keys.find((k) => k === 'category')
  // cost: prefer our column name; fall back to Lighterpack's "price" so a
  // Lighterpack export imports its prices directly. Two-pass lookup (not a
  // single find with OR) so column order in the source CSV doesn't matter.
  //
  // The precedence is load-bearing for BACKWARD COMPATIBILITY: exports
  // downloaded before the columns were collapsed carry a fake price=0
  // alongside the real cost (gear exports) or hardcoded price=0 on EVERY
  // row (list exports), so cost must win or re-importing one of those older
  // files would read the fake 0 and wipe every price - a whole list would
  // import as free. Current exports emit cost alone.
  //
  // WHICH column won also decides how a 0 reads: 0 in `cost` is genuinely
  // free, 0 in `price` is unset (see parseCostFromColumn).
  const ownCostKey = keys.find((k) => k === 'cost')
  const costKey = ownCostKey ?? keys.find((k) => k === 'price')
  const costKind = ownCostKey ? ('cost' as const) : ('price' as const)

  if (!nameKey) return 'Missing required column: "name" or "Item Name"'
  if (!weightKey) return 'Missing required column: "weight_grams" or "weight"'

  return {
    rows,
    cols: { keys, nameKey, weightKey, unitKey, descKey, catKey, costKey, costKind },
  }
}

// The base fields both import-row shapes share, from one data row. Each
// importer spreads these and adds its own (purchaseDate; quantity and the
// worn/consumable flags).
export function commonRowFields(
  row: CsvRecord,
  cols: CommonCsvColumns,
): {
  name: string
  description: string | null
  weightGrams: number
  categoryName: string
  cost: number | null
} {
  const unit = cols.unitKey ? (row[cols.unitKey] ?? 'g') : 'g'
  return {
    name: (row[cols.nameKey] ?? '').trim().slice(0, MAX_NAME_LENGTH),
    description: cols.descKey ? (row[cols.descKey] || null) : null,
    weightGrams: toGrams(row[cols.weightKey] ?? '0', unit),
    categoryName: cols.catKey ? (row[cols.catKey] ?? '') : '',
    cost: cols.costKey ? parseCostFromColumn(row[cols.costKey], cols.costKind) : null,
  }
}
