# Behavior specification

This document describes current app behavior — resource limits, file formats, sharing mechanics, and similar reference material. When behavior changes, update this doc in the same commit. If this doc disagrees with actual code, the code is authoritative. Open an issue so the doc gets fixed.

---

## Resource limits

Per-user caps enforced by `before insert` triggers in the database. Client UI checks the same caps before write so the user gets a friendly error rather than a 500.

- **100 lists** per user.
- **300 list items** per list.
- **500 gear items** per user.
- **100,000 g** (100 kg) max single-item weight.
- **256 chars** max for gear-item and list names.
- **128 chars** max for category names.
- **2,000 chars** max for description fields (gear items and lists).

Length and weight constraints also live in the migrations as `CHECK` constraints — see `supabase/migrations/20260425000001_categories_and_gear.sql` and `20260425000002_lists_and_list_items.sql`.

---

## Weight categorization

Every list item has one of three weight classifications based on its flags:

- **Base** — `is_worn = false` and `is_consumable = false`.
- **Worn** — `is_worn = true`.
- **Consumable** — `is_worn = false` and `is_consumable = true`.

The flags are mutually exclusive at the database level (`worn_xor_consumable` CHECK constraint) and at the UI level (toggling one clears the other). When CSV import sees both flags set on a row, worn wins and consumable is silently cleared.

### Rollups

- **Base Weight** — sum of `weight_grams × quantity` for all base items.
- **Consumable Weight** — sum for consumable items.
- **Pack Weight** — Base Weight + Consumable Weight (what goes in/on the pack; worn excluded).
- **Worn Weight** — sum for worn items (carried but not in the pack).
- **Total Weight** — Base + Consumable + Worn (everything).

The category subtotals on `WeightTable` show **base weight per category only**. Worn and consumable items are excluded from per-category rows; the summary section adds them back as "Consumables" and "Worn Weight" lines below.

### Display units

Toggled per-session via the `g`/`oz` button; persisted in `localStorage` under key `"weightUnit"`.

- Grams mode: `"1035 g"`.
- Imperial individual item weights: `"36.5 oz"` (oz only, never compound lb+oz).
- Imperial summary/total weights: `"9.2 oz"` under 1 lb, `"2 lb 5.4 oz"` at 1 lb or more.

Conversion factor: **1 g = 0.035274 oz** (used both directions).

Weight inputs in the UI are always in grams regardless of display mode — display conversion only happens on read.

### Item weight is the gear item's weight, not a per-list snapshot

`list_items` does not have its own weight column (migration `20260427000002` dropped it). Reads come from `gear_item.weight_grams` via the join. Editing an item's weight from inside a list updates the gear inventory and propagates to every list that contains it. There is no "snapshot vs live" reconciliation — the gear library is the source of truth.

---

## Sharing mechanics

See `DECISIONS.md` ADR 8 for the per-list opt-in rationale.

- Each list gets an **8-character alphanumeric `share_token`** (mixed case + digits, 62-char alphabet) generated at creation; never null.
- `is_shared` (boolean, default false) toggles whether the token is active.
- The share URL pattern is `/r/:token`.
- When `is_shared = false`, the public anon can't read the list — RLS blocks it. The token stays in the database; toggling back on reactivates the same link.
- The token is fixed for the life of the list — there is no "regenerate" action. To break a leaked link the user duplicates the list (which gets a fresh token) and stops sharing the original.
- Public anon receives 404 for both unknown tokens and inactive shared lists (deliberately indistinguishable to prevent enumeration).

### Public share view (`/r/:token`)

Read-only, no auth. Field exclusions vs. the authenticated view:

- **Visible:** list name, description, items grouped by category, weight table, weight unit toggle.
- **Per-item visible:** name, description, weight, quantity, `is_worn`, `is_consumable`, `sort_order`, category name.
- **Excluded:** `is_packed` (personal packing state), `list_item.id`, `gear_item.id`, `share_token`, user identity.

Categories shown in the public view are filtered to only those that have at least one item in this list, ordered by their `sort_order`.

---

## Row-level security

The database itself prevents cross-user data access. Even if the frontend has a bug, RLS refuses to serve user A's data to user B. Every table has RLS enabled; policies live in `supabase/migrations/20260425000001_categories_and_gear.sql` and `20260425000002_lists_and_list_items.sql`.

Two patterns:

- **Owner-keyed tables** (`categories`, `gear_items`, `lists`): `auth.uid() = user_id`.
- **Joined-via-parent tables** (`list_items`): `EXISTS (SELECT 1 FROM lists WHERE id = list_items.list_id AND user_id = auth.uid())`.

Public read for shared lists is a separate policy with `using (is_shared = true)` on `lists` and `using (EXISTS (SELECT 1 FROM lists WHERE id = list_items.list_id AND is_shared = true))` on `list_items`.

For bulk partial-column writes that have to bypass RLS WITH CHECK on the INSERT path, see `CLAUDE.md` "Database patterns" and the `bulk_update_sort_order` RPC (migration `20260430000000_bulk_reorder_rpc.sql`).

---

## CSV format

Used for gear-library and per-list export/import. The format is a small, hand-rolled RFC-4180-style CSV (`src/lib/csv.ts`) — no external CSV library. The format is *not* drop-in compatible with LighterPack; importing LighterPack files happens to work because the parser tolerates extra columns and aliases (see "Import" below).

### Export columns

**Gear-library export** (`gear-library.csv`): `name`, `description`, `weight_grams`, `category`.

**List export** (`<sanitised-list-name>.csv`): `name`, `description`, `weight_grams`, `quantity`, `worn`, `consumable`, `packed`, `category`. Boolean columns are written as the literals `yes` / `no`.

Both:
- Header row first.
- Weights always exported in grams as integers.
- File encoding: UTF-8.
- Cell quoting only when needed (comma, quote, or newline in the cell).
- No formula-injection escaping. No BOM. No size cap. List-export filenames are sanitised at the call site (lowercase + non-alphanumerics → `-`).

### Import

Importing into a list creates a new list named from the source filename (`nameFromCsvFilename` strips the path and `.csv` extension; falls back to `"Imported list"` when the result is empty). Importing into the gear library adds rows without creating a list.

- No file-size cap is enforced. UTF-8 expected.
- Header row required. Column names matched case-insensitively after trimming. Required columns: a name column (`name` or `item name`) and a weight column (`weight_grams`, `weight (g)`, or `weight`). Optional aliases recognised: `description`/`desc`, `category`, `quantity`/`qty`, `worn`/`is_worn`, `consumable`/`is_consumable`, `unit`.
- Optional `unit` column converts the weight value: `g` (default), `oz` (× 28.3495), `lb` (× 453.592), `kg` (× 1000). Result rounded to integer grams and clamped to 100,000 g.
- Rows with empty name are skipped silently.
- Boolean columns accept `1`, `yes`, or `true` as truthy (case-insensitive); anything else is false.
- **If both `worn` and `consumable` are truthy on the same row, BOTH are cleared.** The DB has a `worn_xor_consumable` CHECK constraint and we'd rather lose the flags than reject the whole import; the user re-applies the right flag in the UI. (Worth revisiting — silent lossy behavior is a known oddity.)
- Categories are matched case-insensitively against the user's existing categories and created if not found.
- Gear items are matched by `category_id + lowercase(name)` against existing gear, then against rows queued earlier in the same import. A match is reused (its weight and description are NOT updated); no match means a new gear row is inserted.

---

## Optimistic update lifecycle

Reorder mutations (`reorderCategories`, `reorderListItems`, gear-item reorder on `/gear`) all use the same optimistic lifecycle, defined by `makeOptimisticReorder` in `src/lib/queries/optimistic.ts`:

1. **onMutate**: cancel in-flight queries for the affected key, snapshot the current cache as `previous`, write the new ordering to the cache.
2. **onError**: restore `previous`.
3. **onSettled**: invalidate the affected key so a fresh fetch settles state.

Important: the cache rewrite assumes `updates` is a permutation of an existing subset of cached rows. Passing arbitrary values silently corrupts the cache. Use `assignSortOrderSlots` (in `lib/grouping.ts`) to build safe `updates` arrays.

See `CLAUDE.md` "Verification" — optimistic UI hides server rejections in milliseconds, so always hard-refresh after writes during testing.

---

## Bulk operations

- **Multi-select on `/gear`**: enter Select mode via the Select button in the header. Toggle individual items, or use Select all / Deselect all. Toolbar appears at the bottom with: Move to category, Delete, Create list (creates a new list pre-populated from selection).
- **Move to category** uses `bulkMoveToCategoryGearItems` — distinct from DnD reorder, which is within-category only (see `DECISIONS.md` ADR 1).
- **Delete from inventory** cascades to every `list_item` referencing the gear item (NOT NULL gear_item_id with ON DELETE CASCADE since migration `20260427000001`).
