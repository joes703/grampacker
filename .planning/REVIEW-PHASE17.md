# grampacker — Phase 17 fixes (2026-05-06)

**Source:** `REVIEW-quality.md` — N-5 (csv.ts per-format split). The last open item in `REVIEW-quality.md`'s Nit cluster after Phase 16 closed the M-cluster.
**Scope:** mechanical refactor of `src/lib/csv.ts` (374 lines) into a `src/lib/csv/` subdirectory with five files (core / units / gear / list / index). **Two commits.** No new tests in this phase — the existing pure-function round-trip suite at `src/lib/csv.test.ts` already exercises the public CSV surface (gear export → parse, list export → parse) without jsdom and continues to do so unchanged through the barrel; this split is module plumbing, not new behavior.
**Why bundle this together:** N-5 is a single-PR-class refactor — the split must be atomic to keep the build green. Partial states (some functions in new files, others still in `csv.ts`) would either compile-error on duplicate exports or break consumers' import resolution. C2 is the trailing summary, same shape as every prior phase.

> **Note on file paths:** all paths are repo-relative.
> **Phase 16 baseline:** main bundle = **187.84 KB gzip**. Bundle delta expected: **flat ±0.05 KB**. Same code, same exports, same imports — the bundler tree-shakes per export, not per file. The barrel pattern is the suspect for any positive movement; the per-file split is the suspect for any negative (potentially better tree-shaking if a consumer only pulls list-side or gear-side). Either way, sub-noise.
> **Risk profile:** low. The seam is the public API — every export from the original `csv.ts` is preserved through the `csv/index.ts` barrel. Consumer imports (`from '../lib/csv'`) resolve to `csv/index.ts` after the split with zero source change. The hidden risk is internal cross-module wiring inside `csv/` (gear and list both import `toGrams` from `units.ts`); spec calls out the convention up front.

---

## How to execute this file

Two commits. Order matters: C1 lands the split atomically; C2 documents.

C1 → C2.

After every commit:

```bash
npm run build && npm run lint && npm test -- --run
```

---

## Verification: audit-vs-current-code

| Audit ref | Audit said | Current code | Verdict |
|---|---|---|---|
| N-5 | `csv.ts` mixes generic, gear-specific, and list-specific helpers in one 374-line module | confirmed at `src/lib/csv.ts:1-375`. Three labeled sections (`// ── Stringify`, `// ── Parse`, `// ── Gear library helpers`, `// ── List import helpers`, `// ── List export helpers`) — five labels but functionally three domains: generic CSV format primitives, gear-format adapters, list-format adapters. `toGrams` is shared between the two parsers (a fourth concern). | exact |

Consumer survey (`grep -rn "from.*['\"]\\./csv['\"]\\|from.*['\"]\\.\\./.*lib/csv['\"]\\|from.*['\"]\\.\\./lib/csv['\"]" src --include="*.ts" --include="*.tsx"`):

- `src/settings/SettingsPage.tsx` — `gearItemsToCsv, listItemsToCsv`
- `src/lists/ListImportPreviewDialog.tsx` — type `ListImportRow`
- `src/lists/ListsPage.tsx` — `parseListCsv, listItemsToCsv, downloadCsv, nameFromCsvFilename, type ListImportRow`
- `src/lists/ListsEmptyState.tsx` — `parseListCsv, nameFromCsvFilename, type ListImportRow`
- `src/lists/ListDetailPage.tsx` — `parseListCsv, type ListImportRow`
- `src/gear/GearImportPreviewDialog.tsx` — type `GearCsvRow`
- `src/gear/GearLibraryPage.tsx` — `gearItemsToCsv, downloadCsv, parseGearCsv, type GearCsvRow`
- `src/lib/csv.test.ts` — `gearItemsToCsv, listItemsToCsv, parseGearCsv, parseListCsv`

Eight consumers total. **All eight import from `'../lib/csv'` (or `'./csv'` for the test).** With the barrel pattern, all eight imports stay byte-identical after the split — the path `'../lib/csv'` resolves to `src/lib/csv/index.ts` once `src/lib/csv.ts` is removed and the directory exists.

Architectural precedent: `src/lib/queries/` is the same pattern (subdirectory + `index.ts` barrel). Comment convention from `queries/index.ts:1-7` carries forward: external consumers use the barrel path; internal cross-module imports inside `csv/` go directly to the source module.

---

## Commit 1 — N-5: split `csv.ts` into `csv/` subdirectory

**Origin:** `REVIEW-quality.md` N-5 (Nit, but standalone-class).

**Why:**

`csv.ts` is 374 lines and conceptually does four things:

1. **Generic CSV format primitives** — `toCsv`, `parseCsv`, `downloadCsv`, plus internal `escapeCell` / `splitLines` / `parseRow`.
2. **Weight-value parsing** — `toGrams` (shared between gear and list parsers).
3. **Gear-format adapters** — `gearItemsToCsv`, `parseGearCsv`, plus internal `parseCost` / `parseIsoDate`. Lighterpack-compatible 10-column header on export; case-insensitive column resolution on parse.
4. **List-format adapters** — `listItemsToCsv`, `parseListCsv`, `nameFromCsvFilename`, plus internal `toBool`. Same Lighterpack-compatible header; different value semantics (qty/worn/consumable instead of cost/purchase_date).

The audit noted these as separable concerns. Splitting tightens responsibility boundaries (changes to gear-format value parsing don't touch the list-format module) and matches the codebase's existing `lib/queries/` precedent.

**Architecture:**

```
src/lib/csv/                       (new directory)
  index.ts                         (new — barrel; re-exports public API)
  core.ts                          (new — generic CSV format primitives)
  units.ts                         (new — toGrams, the cross-parser weight helper)
  gear.ts                          (new — gear-format adapters + private value parsers)
  list.ts                          (new — list-format adapters + private value parsers)

src/lib/csv.ts                     (DELETE)
src/lib/csv.test.ts                (UNCHANGED — still imports from './csv'; resolves to csv/index.ts)
```

Public API (re-exported from `csv/index.ts`):

- From `./core`: `toCsv`, `downloadCsv`, `parseCsv`
- From `./gear`: `gearItemsToCsv`, `parseGearCsv`, type `GearCsvRow`
- From `./list`: `listItemsToCsv`, `parseListCsv`, `nameFromCsvFilename`, type `ListImportRow`

Module-private (NOT in barrel):
- `core.ts`: `escapeCell`, `splitLines`, `parseRow`
- `units.ts`: `toGrams` is exported for `gear.ts` and `list.ts` to consume directly via `'./units'` — NOT through the barrel.
- `gear.ts`: `parseCost`, `parseIsoDate`
- `list.ts`: `toBool`

**Files:**

- Create: `src/lib/csv/core.ts`
- Create: `src/lib/csv/units.ts`
- Create: `src/lib/csv/gear.ts`
- Create: `src/lib/csv/list.ts`
- Create: `src/lib/csv/index.ts`
- Delete: `src/lib/csv.ts`
- Modify: `SPEC.md` — line 134 path reference.
- Modify: `.planning/REVIEW-security.md` — line 117 path reference and line 130 path reference.

No consumer file modifications. No test file modifications.

**What to do:**

### Step 1 — `src/lib/csv/core.ts`

Generic CSV format primitives. Lifts lines 1-124 of the current `csv.ts` verbatim (the `// ── Stringify` and `// ── Parse` sections plus their helpers).

```ts
// Generic CSV format primitives. Format-agnostic — knows about commas,
// quotes, newlines, and the Excel/Google Sheets formula-injection
// escape, but knows NOTHING about gear-library or list-import column
// shapes. The format-specific adapters live in ./gear and ./list.

function escapeCell(v: string | number | boolean | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v)
  // Formula-injection neutralization. Excel, Google Sheets, and Numbers
  // evaluate cells whose first character is =, +, -, @, tab, or CR as a
  // formula. A leading single apostrophe is the standard "treat as text"
  // escape — strips on display in those tools, not interpreted as part of
  // the cell value. Applied uniformly at the cell-writer layer so every
  // export path inherits it.
  //
  // We deliberately don't strip leading apostrophes on the import side
  // (parseCsv): third-party tools like Lighterpack may emit them
  // legitimately, and stripping would mangle those imports. The user's
  // own export → import round-trip preserves the apostrophe; that's
  // acceptable since names starting with =/+/-/@ are exotic enough that
  // round-trip purity isn't worth the data-mangling risk on third-party
  // CSVs.
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`
  }
  // Wrap in quotes if the value contains a comma, quote, or newline.
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function toCsv(rows: Record<string, string | number | boolean | null | undefined>[]): string {
  const [first, ...rest] = rows
  if (!first) return ''
  const headers = Object.keys(first)
  const lines = [
    headers.map(escapeCell).join(','),
    ...[first, ...rest].map((row) => headers.map((h) => escapeCell(row[h])).join(',')),
  ]
  return lines.join('\r\n')
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Minimal RFC-4180-compliant CSV parser (no external dependency).
export function parseCsv(text: string): Record<string, string>[] {
  const [headerLine, ...dataLines] = splitLines(text)
  if (!headerLine || dataLines.length === 0) return []

  const headers = parseRow(headerLine).map((h) => h.trim().toLowerCase())
  const result: Record<string, string>[] = []

  for (const line of dataLines) {
    if (!line.trim()) continue
    const cells = parseRow(line)
    const row: Record<string, string> = {}
    headers.forEach((h, j) => {
      row[h] = (cells[j] ?? '').trim()
    })
    result.push(row)
  }

  return result
}

function splitLines(text: string): string[] {
  // Split on \r\n or \n, but not inside quoted fields
  const lines: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      inQuote = !inQuote
      cur += ch
    } else if (!inQuote && (ch === '\n' || (ch === '\r' && text[i + 1] === '\n'))) {
      lines.push(cur)
      cur = ''
      if (ch === '\r') i++ // skip \n after \r
    } else {
      cur += ch
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function parseRow(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuote = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        inQuote = false
      } else {
        cur += ch
      }
    } else {
      if (ch === '"') {
        inQuote = true
      } else if (ch === ',') {
        cells.push(cur)
        cur = ''
      } else {
        cur += ch
      }
    }
  }
  cells.push(cur)
  return cells
}
```

### Step 2 — `src/lib/csv/units.ts`

The shared weight-value parser. Lifts `toGrams` from current `csv.ts:168-200`. Exported for `gear.ts` and `list.ts` to import directly (not through the barrel — the queries-module convention is that internal cross-module wiring goes direct).

```ts
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
// - defaults to grams on unknown unit (CSV import tolerance — typo
//   "kgs" or empty unit becomes grams; matches the prior behavior).
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
      // etc.) also default to grams as the most-tolerant fallback —
      // matches the previous behavior, just with the happy path now
      // explicit instead of hidden under `default`.
      grams = n
  }
  return Math.min(Math.round(grams), 100000)
}
```

### Step 3 — `src/lib/csv/gear.ts`

Gear-format adapters. Lifts `GearCsvRow`, `gearItemsToCsv`, `parseGearCsv`, `parseCost`, `parseIsoDate` from `csv.ts:126-267`.

```ts
import type { GearItem, Category } from '../types'
import { toCsv, parseCsv } from './core'
import { toGrams } from './units'

export type GearCsvRow = {
  name: string
  description: string | null
  weight_grams: number
  category: string
  cost: number | null
  purchase_date: string | null
}

export function gearItemsToCsv(items: GearItem[], categories: Category[]): string {
  const catMap = new Map(categories.map((c) => [c.id, c.name]))
  // Lighterpack-compatible base 10 columns so users can re-import a
  // grampacker gear-library export into Lighterpack without manual header
  // massaging — Lighterpack ignores unknown columns. The gear library has
  // no list-item context (no quantity / worn / consumable), so those get
  // Lighterpack defaults: qty=1, worn/consumable empty. url is empty
  // since grampacker doesn't store it; price stays at the Lighterpack
  // default 0 (its own field, not aliased to cost). cost and
  // purchase_date are grampacker-specific extension columns appended
  // after the Lighterpack 10; Lighterpack ignores them on its import.
  // Both blank for null — never 0 or epoch.
  const rows = items.map((item) => ({
    'Item Name': item.name,
    Category: item.category_id ? (catMap.get(item.category_id) ?? '') : '',
    desc: item.description ?? '',
    qty: 1,
    weight: item.weight_grams,
    unit: 'gram',
    url: '',
    price: 0,
    worn: '',
    consumable: '',
    cost: item.cost ?? '',
    purchase_date: item.purchase_date ?? '',
  }))
  return toCsv(rows)
}

// Returns parsed rows ready for import, or an error string.
// Accepts our own export format AND the Lighterpack format:
//   Item Name, Category, desc, qty, weight, unit, url, price, worn, consumable
export function parseGearCsv(text: string): GearCsvRow[] | string {
  const rows = parseCsv(text)
  const [sample] = rows
  if (!sample) return 'File appears empty or has no data rows.'

  const keys = Object.keys(sample)

  // Resolve column names (case-insensitive, support aliases)
  const nameKey   = keys.find((k) => k === 'name' || k === 'item name')
  const weightKey = keys.find((k) => k === 'weight_grams' || k === 'weight (g)' || k === 'weight')
  const unitKey   = keys.find((k) => k === 'unit')
  const descKey   = keys.find((k) => k === 'description' || k === 'desc' || k === 'notes')
  const catKey    = keys.find((k) => k === 'category')
  // cost: prefer our column name; fall back to Lighterpack's "price" so a
  // Lighterpack export imports its prices directly. Two-pass lookup (not
  // a single find with OR) so column order in the source CSV doesn't
  // matter — our own export has price=0 and cost=N side by side, and the
  // user-set cost must always win over the Lighterpack-default price.
  const costKey   = keys.find((k) => k === 'cost') ?? keys.find((k) => k === 'price')
  const dateKey   = keys.find((k) => k === 'purchase_date' || k === 'purchase date')

  if (!nameKey)   return 'Missing required column: "name" or "Item Name"'
  if (!weightKey) return 'Missing required column: "weight_grams" or "weight"'

  return rows
    .map((row) => {
      const unit = unitKey ? (row[unitKey] ?? 'g') : 'g'
      return {
        name:         (row[nameKey] ?? '').trim().slice(0, 256),
        description:  descKey ? (row[descKey] || null) : null,
        weight_grams: toGrams(row[weightKey] ?? '0', unit),
        category:     catKey ? (row[catKey] ?? '') : '',
        cost:         costKey ? parseCost(row[costKey]) : null,
        purchase_date: dateKey ? parseIsoDate(row[dateKey]) : null,
      }
    })
    .filter((r) => r.name.length > 0)
}

// Empty/whitespace cells become null (gifts and unknown values stay
// unknown — never coerced to 0). Negative or unparseable inputs also
// drop to null rather than corrupting the row.
function parseCost(raw: string | undefined): number | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const n = parseFloat(s)
  if (!isFinite(n) || n < 0) return null
  // Round to cents — numeric(10,2) in the DB rejects extra precision.
  // Cap at the column's max (99,999,999.99); without this, an over-cap
  // row would abort the entire bulk INSERT with Postgres 22003
  // numeric_value_out_of_range, taking the whole batch with it.
  return Math.min(Math.round(n * 100) / 100, 99_999_999.99)
}

// Strict ISO YYYY-MM-DD; anything else (or empty) is null. We deliberately
// don't accept locale formats — silent ambiguity (07/04/2024 = July 4 or
// April 7?) is worse than rejecting. Users can re-format their CSV.
function parseIsoDate(raw: string | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return s
}
```

Note the import path change for types: `from './types'` → `from '../types'` (one directory deeper now).

### Step 4 — `src/lib/csv/list.ts`

List-format adapters. Lifts `ListImportRow`, `parseListCsv`, `listItemsToCsv`, `nameFromCsvFilename`, `toBool` from `csv.ts:269-374`.

```ts
import type { Category, ListItemWithGear } from '../types'
import { toCsv, parseCsv } from './core'
import { toGrams } from './units'

export type ListImportRow = {
  name: string
  description: string | null
  weight_grams: number
  category: string
  quantity: number
  is_worn: boolean
  is_consumable: boolean
}

function toBool(v: string | undefined): boolean {
  const s = (v ?? '').trim().toLowerCase()
  // 1/yes/true: traditional CSV boolean conventions.
  // worn/consumable: Lighterpack's literal column-value style — a
  // worn-flag column carries the string "Worn" when true and empty
  // when false; same for consumable. Recognising both literals here
  // (rather than column-aware parsing) keeps toBool a single function
  // and is harmless since no tool emits cross-column values.
  return s === '1' || s === 'yes' || s === 'true' || s === 'worn' || s === 'consumable'
}

// Parses a Lighterpack-style CSV into list import rows.
// Accepts: Item Name, Category, desc, qty, weight, unit, url, price, worn, consumable
// Also accepts our own list export format.
export function parseListCsv(text: string): ListImportRow[] | string {
  const rows = parseCsv(text)
  const [sample] = rows
  if (!sample) return 'File appears empty or has no data rows.'

  const keys = Object.keys(sample)

  const nameKey     = keys.find((k) => k === 'name' || k === 'item name')
  const weightKey   = keys.find((k) => k === 'weight_grams' || k === 'weight (g)' || k === 'weight')
  const unitKey     = keys.find((k) => k === 'unit')
  const descKey     = keys.find((k) => k === 'description' || k === 'desc' || k === 'notes')
  const catKey      = keys.find((k) => k === 'category')
  const qtyKey      = keys.find((k) => k === 'quantity' || k === 'qty')
  const wornKey     = keys.find((k) => k === 'worn' || k === 'is_worn')
  const consumKey   = keys.find((k) => k === 'consumable' || k === 'is_consumable')

  if (!nameKey)   return 'Missing required column: "name" or "Item Name"'
  if (!weightKey) return 'Missing required column: "weight_grams" or "weight"'

  return rows
    .map((row) => {
      const unit = unitKey ? (row[unitKey] ?? 'g') : 'g'
      const rawQty = qtyKey ? parseInt(row[qtyKey] ?? '1', 10) : 1
      const isWorn = wornKey ? toBool(row[wornKey]) : false
      const isConsumable = consumKey ? toBool(row[consumKey]) : false
      // worn_xor_consumable is a DB CHECK constraint; if both are truthy in
      // the CSV the insert fails with a generic error. Silently normalize
      // by clearing both — the user can re-flag the right one in the UI.
      const bothSet = isWorn && isConsumable
      return {
        name:         (row[nameKey] ?? '').trim().slice(0, 256),
        description:  descKey ? (row[descKey] || null) : null,
        weight_grams: toGrams(row[weightKey] ?? '0', unit),
        category:     catKey ? (row[catKey] ?? '') : '',
        quantity:     isNaN(rawQty) || rawQty < 1 ? 1 : Math.min(rawQty, 9999),
        is_worn:      bothSet ? false : isWorn,
        is_consumable: bothSet ? false : isConsumable,
      }
    })
    .filter((r) => r.name.length > 0)
}

// Strip the .csv extension and any path prefix from a filename, fall back
// to a generic label if the result is empty. Used to derive a default
// list name when importing a CSV into a brand-new list.
export function nameFromCsvFilename(filename: string): string {
  const base = filename.replace(/^.*[/\\]/, '').replace(/\.csv$/i, '').trim()
  return base || 'Imported list'
}

// Lighterpack-compatible 10-column header (Item Name, Category, desc, qty,
// weight, unit, url, price, worn, consumable) so users can re-import a
// grampacker list export into Lighterpack and so users coming from
// Lighterpack see a familiar shape. is_packed is excluded — Lighterpack
// has no equivalent and it's per-user runtime checklist state. url and
// price are emitted as Lighterpack defaults ('' and 0) since grampacker
// doesn't store them. Boolean values use Lighterpack's "Worn" /
// "Consumable" literals (capitalized when true, empty when false). The
// import-side toBool recognizes both literals (case-insensitive) for
// round-trip parity.
export function listItemsToCsv(items: ListItemWithGear[], categories: Category[]): string {
  const catMap = new Map(categories.map((c) => [c.id, c.name]))
  const rows = items.map((item) => ({
    'Item Name': item.gear_item.name,
    Category: item.gear_item.category_id ? (catMap.get(item.gear_item.category_id) ?? '') : '',
    desc: item.gear_item.description ?? '',
    qty: item.quantity,
    weight: item.gear_item.weight_grams,
    unit: 'gram',
    url: '',
    price: 0,
    worn: item.is_worn ? 'Worn' : '',
    consumable: item.is_consumable ? 'Consumable' : '',
  }))
  return toCsv(rows)
}
```

### Step 5 — `src/lib/csv/index.ts`

Public barrel. Same shape as `src/lib/queries/index.ts`.

```ts
// Public barrel for the csv domain. External consumers import from
// '../lib/csv' (which resolves to this file once src/lib/csv.ts is
// removed and src/lib/csv/ exists), never from a specific submodule —
// the per-format file layout is an internal organizational concern.
//
// Internal cross-module imports inside src/lib/csv/ go directly to the
// source module (./core, ./units, ./gear, ./list) — never through this
// barrel — to avoid circular module resolution and to keep dependency
// direction one-way.

export { toCsv, downloadCsv, parseCsv } from './core'
export { gearItemsToCsv, parseGearCsv } from './gear'
export type { GearCsvRow } from './gear'
export { listItemsToCsv, parseListCsv, nameFromCsvFilename } from './list'
export type { ListImportRow } from './list'
```

### Step 6 — delete old `src/lib/csv.ts`

```bash
git rm src/lib/csv.ts
```

### Step 7 — update doc references to the deleted path

Two repo docs cite `src/lib/csv.ts` and would point at a deleted file post-split. Update both as part of C1 so the diff lands atomically:

**`SPEC.md:134`** — currently:

```
Used for gear-library and per-list export/import. The format is a small, hand-rolled RFC-4180-style CSV (`src/lib/csv.ts`) — no external CSV library.
```

→ change `(`src/lib/csv.ts`)` to `(`src/lib/csv/`)`. The directory points at the format implementation; readers can drill into `core.ts` / `gear.ts` / `list.ts` from there.

**`.planning/REVIEW-security.md:117`** — currently:

```
- **Where:** `/Users/joe/code/grampacker/src/lib/use-csv-file-input.ts:3` (size cap) and `/Users/joe/code/grampacker/src/lib/csv.ts:19` (formula-injection neutralization on export — leading `=`/`+`/`-`/`@`/`\t`/`\r` get a `'` prefix). Import side intentionally does not strip the prefix to preserve Lighterpack round-trips.
```

→ change `src/lib/csv.ts:19` to `src/lib/csv/core.ts` (no specific line — line numbers in audit docs aren't load-bearing, and the function moves with its comment block intact). The `escapeCell` function is the same code; just lives in `core.ts` now.

**`.planning/REVIEW-security.md:130`** — currently:

```
- **CSV formula-injection neutralization** on every export cell (`csv.ts:19`).
```

→ change to:

```
- **CSV formula-injection neutralization** on every export cell (`src/lib/csv/core.ts`).
```

Same reasoning as line 117 — drop the line number, point at the new file. Note line 117 uses absolute repo paths (`/Users/joe/code/grampacker/src/lib/...`) while line 130 uses bare filenames (`csv.ts:19`). Match each line's existing convention rather than normalizing both — that's a separate-PR-style cleanup outside N-5's scope.

Other references are in sealed phase artifacts (`.planning/REVIEW-PHASE9.md` cites `csv.ts:247-254` for the `parseCost` work, but Phase 9 is shipped — historical phase docs are point-in-time snapshots and don't get retroactively updated). Leave those as-is.

### Step 8 — verify

```bash
npm run build && npm run lint && npm test -- --run
```

Expected:
- TypeScript resolves `import { ... } from '../lib/csv'` (and `'./csv'` for the test) via `csv/index.ts` for all 8 consumers — zero source change in any consumer file.
- `csv.test.ts` continues to pass (45 → 45 tests).
- Bundle gzip flat ±0.05 KB.

Confirmation greps:

```bash
# No file at the old path
ls src/lib/csv.ts 2>&1   # expect: No such file
# New directory exists
ls src/lib/csv/          # expect: core.ts gear.ts index.ts list.ts units.ts
# All consumers still resolve
grep -rn "from.*['\"]\\./csv['\"]\\|from.*['\"]\\.\\./.*lib/csv['\"]\\|from.*['\"]\\.\\./lib/csv['\"]" src --include="*.ts" --include="*.tsx" | wc -l
# expect: 8 (unchanged from pre-split count)
```

**Why no consumer updates:**

Eight consumers, each importing 1-5 named exports from `'../lib/csv'`. All eight resolve to the new barrel automatically once `csv.ts` is gone and `csv/` exists. Updating consumers to import from specific submodules (`'../lib/csv/gear'`, etc.) would:

1. Spread the diff across 8 files for zero functional benefit.
2. Couple consumers to the internal layout of `csv/` — defeating the barrel's encapsulation purpose.
3. Diverge from the established `queries/` precedent (every consumer imports `'../lib/queries'`, never `'../lib/queries/optimistic'`).

Per the queries comment convention, the barrel IS the public API. Consumers don't know or care that gear and list adapters live in separate files.

**Why no test updates:**

`src/lib/csv.test.ts` lives at the lib level (sibling to the new `csv/` directory). Its `from './csv'` import resolves to `csv/index.ts` after the split. Both gear and list round-trip assertions exercise the public surface, which is preserved exactly. Splitting the test file into `csv/gear.test.ts` and `csv/list.test.ts` would parallel `queries/optimistic.test.ts`'s convention, but the existing test is a cross-domain round-trip — it tests the seam between gear export and gear parse, AND list export and list parse, in a single describe block. Splitting it is a separate refactor and isn't required by N-5.

**Why `units.ts` is its own file:**

`toGrams` is the only function shared between `parseGearCsv` and `parseListCsv`. Three placement options:

- **Inline in both** — DRY violation; the function has CSV-import-specific clamping behavior that needs to stay synchronized between gear and list.
- **Inside `core.ts`** — mixes "CSV format primitives" (parser/writer) with "domain value parser" (weight unit conversion). Not a hard violation, but `core.ts` should know about commas and quotes, not pounds and ounces.
- **Own file `units.ts`** — sharp responsibility line. `gear.ts` and `list.ts` import `from './units'` directly (not through the barrel; same as `queries/`'s internal cross-module convention).

Going with the third. It's a 30-line file with one export, but the responsibility is sharply distinct and the file leaves room to grow if a future converter (volume, currency, etc.) needs the same one-shared-helper-between-format-parsers pattern.

**Verification:**

- `npm run build` — types resolve; zero consumer changes.
- `npm run lint` — passes.
- `npm test -- --run` — 45 tests pass (csv.test.ts unchanged).
- Bundle: flat ±0.05 KB target.

**Acceptance criteria:** five new files in `src/lib/csv/`; one deleted file (`src/lib/csv.ts`); three doc lines updated (`SPEC.md:134`, `.planning/REVIEW-security.md:117`, `.planning/REVIEW-security.md:130`); zero changes in any consumer; zero changes in `csv.test.ts`. The public API surface is byte-identical pre/post.

**Suggested commit:** `refactor(csv): split csv.ts into per-format submodules (N-5)`

---

## Commit 2 — Phase 17 summary in `REVIEW-FIX.md`

**Origin:** workflow housekeeping.

**Why:**

Documents the N-5 closure, marks `REVIEW-quality.md` as fully closed (M-cluster done in Phase 16; N-cluster done now; W-cluster done in Phases 12-13), and restates the remaining campaign deck (T-cluster in Phase 18; F4 only if threat model changes; security/perf reviews next per user's stated ordering).

**Files:**

- Modify: `.planning/REVIEW-FIX.md` — append Phase 17 summary.

**What to do:**

Standard structure (Shipped / Audit closures / Verification / Blockers / Next phase). Critical content:

- **Shipped: N-5** — split as specified; barrel + 4 submodules; zero consumer/test changes; bundle flat target.
- **Audit closures: N-5** — closes the last N-cluster item in `REVIEW-quality.md`.
- **Campaign milestone:** with Phase 17 closed, `REVIEW-quality.md` is fully closed. M-cluster done (Phase 16), N-cluster done (Phase 17), W-cluster done (Phase 12-13), T-cluster deferred to Phase 18.
- **Next phase: Phase 18 = T-cluster** (T-3…T-9 + the seven deferred test surfaces from Phases 14/15/16). Requires jsdom + `@testing-library/react` install. Once tooling lands, the deferred surfaces become testable in the same phase as the explicit T-items.

**Suggested commit:** `docs(review-fix): append Phase 17 summary`

---

## Audit ledger (mark each as it lands)

- **Commit 1 — `<hash>`** — N-5. `csv.ts` (374 lines) split into `csv/{core,units,gear,list,index}.ts` (5 files). Public API preserved through `csv/index.ts` barrel; all 8 consumer imports resolve unchanged. `toGrams` lives in `units.ts` as the one-shared-helper-between-format-parsers; private value parsers (`parseCost`, `parseIsoDate`, `toBool`) stay module-local. `csv.test.ts` unchanged — still imports `from './csv'`, now resolves to `csv/index.ts`.
- **Commit 2 — `<hash>`** — Phase 17 summary appended to REVIEW-FIX.md. `REVIEW-quality.md` fully closed.

## Decisions and explicitly-deferred items

- **No new tests in Phase 17.** Existing pure-function `csv.test.ts` already covers the public surface (round-trip for gear-format and list-format) and continues to pass unchanged through the barrel. The split is module plumbing — every export is preserved, every consumer import is unchanged — so the existing tests are exactly the right verification. Adding tests for the internal seam (e.g., a direct unit test for `toGrams` from `units.ts`) would reach into module internals and isn't required by this refactor; defer to T-cluster if ever desired.
- **No consumer-import updates.** Per the established queries-module precedent, the barrel is the public API; consumers should not couple to the internal file layout. All 8 consumer imports resolve to `csv/index.ts` automatically.
- **`csv.test.ts` not split.** It's a round-trip integration test crossing both gear and list domains. Splitting parallels `queries/optimistic.test.ts`'s per-module convention but isn't required by N-5; defer if ever desired.
- **`units.ts` separate from `core.ts`.** `toGrams` is a domain value parser, not a CSV format primitive. The 30-line file leaves room for future per-format-parser-shared helpers without polluting `core.ts`.
- **Bundle target:** flat ±0.05 KB. Same code, same exports, same imports — bundler tree-shakes per export. The barrel is the suspect for any positive movement; per-file split is the suspect for any negative.
- **Pre-commit verification gate.** A naive byte-for-byte concat-and-diff is too noisy because `toGrams` moves to `units.ts`, every new file adds import lines, and the section-header comments shift. Use the cleaner gate instead:
  1. `git diff -- src/lib/csv.ts src/lib/csv/` — review the human-readable diff. Every function body should appear once on the new side; every removed-and-readded function body should match its old form exactly. Unexpected deltas in a function body are copy errors and must be reconciled before commit.
  2. `npm test -- --run src/lib/csv.test.ts` — targeted run of the round-trip suite. If gear or list export-then-parse drifts byte-for-byte, this fails immediately with a clear assertion site.
  3. `npm test -- --run` — full suite for cross-cutting regressions.
  4. `npm run lint && npm run build` — type and style gates.
