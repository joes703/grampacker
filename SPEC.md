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
- **2 MB** max CSV upload (UTF-8).

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

- Each list gets an **8-character URL-safe alphanumeric `share_token`** generated at creation; never null.
- `is_shared` (boolean, default false) toggles whether the token is active.
- The share URL pattern is `/r/:token`.
- When `is_shared = false`, the public anon can't read the list — RLS blocks it. The token stays in the database; toggling back on reactivates the same link.
- A "regenerate token" action replaces the token (breaking any existing links). Retries up to 5 times on the rare collision.
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

LighterPack-compatible. Used both for gear-library export/import and per-list export/import.

### Column layout (0-indexed)

| Index | Column name | Notes |
|-------|-------------|-------|
| 0 | Item Name | required |
| 1 | Category | category name string |
| 2 | desc | description / notes |
| 3 | qty | integer; defaults to 1 if missing or non-integer |
| 4 | weight | numeric |
| 5 | unit | `g`, `oz`, or `lb` |
| 6 | worn | `1` or `0` |
| 7 | consumable | `1` or `0` |
| 8 | Image URL | exported as empty string; ignored on import |

### Export

- Header row written first.
- Weights always exported in grams (unit column = `"g"`).
- Per-item quantity from the list is exported in the qty column.
- worn / consumable reflect the list-item flags.
- Gear-library export uses qty=1, worn=0, consumable=0 for every row.
- Filenames sanitized: alphanumeric, space, hyphen, underscore pass through; everything else becomes `_`.
- Cell values starting with `=`, `+`, `-`, or `@` are prefixed with a single quote to prevent spreadsheet formula injection.
- File encoding: UTF-8.

### Import into a list

Creates a new list named after the source filename (or "Imported List" if blank).

- Max 2 MB; UTF-8 (BOM-stripped).
- Header detection: if the first cell of row 0 (lowercased) is `"item name"` or `"name"`, the row is skipped as a header.
- Rows with empty name are skipped.
- Any row that fails to parse is skipped; the import continues.
- Weight conversion: `oz × 28.3495` → grams; `lb × 453.592` → grams; rounded, clamped to 100,000 g.
- If both worn and consumable are `1` on the same row, **worn wins** (consumable is silently cleared).
- Categories are looked up case-insensitively and created if not found.
- Gear items are looked up by name + category (case-insensitive). An existing match is reused — the existing item's weight and description are NOT updated. A new gear item is created on no match.

CSV parsing is hand-rolled in `src/lib/csv.ts` (a "minimal RFC-4180-compliant CSV parser, no external dependency") — there is no external CSV library dependency.

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
