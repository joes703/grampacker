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
- **9999** max `list_items.quantity` (raised from 99 to support water tracked as 1g gear with quantity = grams; see DECISIONS.md ADR 9).
- **2 MB** max CSV upload, enforced client-side in `useCsvFileInput` before parse.

Length and weight constraints also live in the migrations as `CHECK` constraints — see `supabase/migrations/20260425000001_categories_and_gear.sql` and `20260425000002_lists_and_list_items.sql`.

---

## Weight categorization

Every list item has one of three weight classifications based on its flags:

- **Base** — `is_worn = false` and `is_consumable = false`.
- **Worn** — `is_worn = true`.
- **Consumable** — `is_worn = false` and `is_consumable = true`.

The flags are mutually exclusive at the database level (`worn_xor_consumable` CHECK constraint) and at the UI level (toggling one clears the other). When CSV import sees both flags set on a row, BOTH are cleared — we'd rather lose the flags than reject the whole import; the user re-applies the right flag in the UI. (See the "Import" section below for full CSV-tolerance rules.)

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

- Each list gets a **6-character alphanumeric `slug`** (mixed case + digits, 62-char alphabet) generated at creation; never null. UNIQUE-constrained at the DB level; the inserter retries on the (effectively impossible) collision.
- `is_shared` (boolean, default false) toggles whether the slug is active.
- The share URL pattern is `/r/:slug`.
- When `is_shared = false`, the public anon can't read the list — RLS blocks it. The slug stays in the database; toggling back on reactivates the same link.
- The slug is fixed for the life of the list — there is no "regenerate" action. To break a leaked link the user duplicates the list (which gets a fresh slug) and stops sharing the original.
- Public anon receives 404 for both unknown slugs and inactive shared lists. Slug guessing is impractical at 6 base62 chars, but currently-shared lists are technically enumerable through PostgREST's generic query interface — see `SECURITY.md` "Public read paths" for the trust model.

### Public share view (`/r/:slug`)

Read-only, no auth. Field exclusions vs. the authenticated view:

- **Visible:** list name, description, items grouped by category, weight table, weight unit toggle.
- **Per-item visible** (in the wire response): `id` (used as React key), `gear_item_id`, `quantity`, `is_worn`, `is_consumable`, `sort_order`, plus the joined `gear_item.{id, name, description, weight_grams, category_id}`.
- **Per-category visible**: `id`, `name`, `sort_order`.
- **Excluded** (not in the wire response): `is_packed` (personal packing state), `list_id` (viewer already has it), owner `user_id` on every table, `slug` echo on the list, `is_shared` on the list, `is_default` on categories, `created_at` / `updated_at` on every table. Enforced via explicit `select(...)` column lists in the public query helpers, not just RLS — see `SECURITY.md` "Public read column allowlist".

Categories shown in the public view are filtered to only those that have at least one item in this list, ordered by their `sort_order`.

---

## Authentication flows

User-visible steps for the four auth flows. Security mechanism (re-auth, anti-enumeration, recovery-token equivalence, etc.) lives in `SECURITY.md` "Defense-in-depth extras" — this section is the user-facing reference.

### Sign up (`/register`)

- Fields: email, password (8-128 characters).
- On submit, the page swaps to a "Check your email" state showing the address used.
- The user clicks the confirmation link in their inbox; the account becomes active.
- Subsequent sign-in via `/login` lands on `/lists`. (The confirmation link redirects to the Supabase project's "Site URL" by default — `signUp` doesn't pass `emailRedirectTo`.)

### Sign in (`/login`)

- Fields: email, password.
- Below the form: "Create one" link to `/register`, "Forgot password?" link to `/forgot-password`.
- Failure messages are deliberately broad ("Invalid email or password.") to limit account-state probing. Unconfirmed accounts get a distinct "Please confirm your email address before signing in" message — a small known account-state leak we accept until a future cleanup.

### In-app password change (`/settings` → Change password)

- Fields: current password, new password (8+ characters), confirm new password.
- Validation order, all client-side before any network call: current non-empty, new ≥ 8, confirm matches new, new ≠ current. Then verify current via re-auth, then call `updateUser`.
- The current-password requirement is the auth proof — see `SECURITY.md` "Defense-in-depth extras" for why it's required and why the verification error is genericized.
- The user stays signed in after a successful change; the re-auth step refreshes the session token transparently.

### Forgot password (`/login` → "Forgot password?")

- **`/forgot-password`** — fields: email. On submit, calls `resetPasswordForEmail` with `redirectTo: ${origin}/reset-password`. The success message is generic — same text whether the email exists or not (anti-enumeration; `SECURITY.md`).
- **Email** — Supabase's default recovery template (no custom branding yet). Delivery via the Resend SMTP setup (DECISIONS.md ADR 4).
- **`/reset-password`** — landing page from the email link. Verifies the recovery token (PKCE `?code=` exchanged via `exchangeCodeForSession`, or implicit-flow hash fragment auto-detected by `detectSessionInUrl`). On success, shows new-password + confirm fields. On submit, calls `updateUser` and auto-redirects to `/lists` signed in. Expired/used/invalid recovery tokens render an error state with a "request a new link" path back to `/forgot-password`.
- The `redirectTo` URL must be allowlisted in the Supabase dashboard's Auth → URL Configuration → Redirect URLs. Production, Cloudflare Pages preview, and local dev origins each need their own `/reset-password` entry.

---

## Row-level security

The database itself prevents cross-user data access. Even if the frontend has a bug, RLS refuses to serve user A's data to user B. Every table has RLS enabled; policies live in `supabase/migrations/20260425000001_categories_and_gear.sql` and `20260425000002_lists_and_list_items.sql`.

Every user-owned table currently uses the **owner-keyed** pattern: `auth.uid() = user_id`. Applies to `categories`, `gear_items`, `lists`, and `list_items` (the latter gained a direct `user_id` column in migration `20260506000002`, replacing its previous joined-via-parent policy). The joined-via-parent pattern (`EXISTS (SELECT 1 FROM <parent> WHERE <parent>.id = <child>.<fk> AND <parent>.user_id = auth.uid())`) is a documented option for future child tables that don't carry their own `user_id` — see `SECURITY.md` "Adding a new table safely" for the template.

Public read for shared lists is a separate policy with `using (is_shared = true)` on `lists` and `using (EXISTS (SELECT 1 FROM lists WHERE id = list_items.list_id AND is_shared = true))` on `list_items`. The transitive read on `gear_items` and `categories` (so the share view can render names and groupings) lives in `20260427000000_public_select_via_shared_list.sql`.

For bulk partial-column writes that have to bypass RLS WITH CHECK on the INSERT path, see `CLAUDE.md` "Database patterns" and the `bulk_update_sort_order` RPC. Migration chain: `20260430000000_bulk_reorder_rpc.sql` (function shape), `20260501000000_bulk_reorder_rpc_ownership_check.sql` (inline ownership check), `20260502000000_add_gear_items_to_bulk_reorder.sql` (gear_items branch), `20260503000000_add_lists_to_bulk_reorder.sql` (lists branch).

---

## CSV format

Used for gear-library and per-list export/import. The format is a small, hand-rolled RFC-4180-style CSV (`src/lib/csv/`) — no external CSV library. The export format is **drop-in compatible with Lighterpack**: same 10-column header and same value conventions, so a grampacker CSV can be re-imported into Lighterpack without manual header massaging. Importing Lighterpack, HikerHerd, Packstack, or hand-edited CSVs into grampacker works thanks to the parser's case-insensitive column-alias lookup, the spelled-out unit recognition, and the boolean-value tolerance described under "Import" below.

### Export columns

Both export paths emit the same 10-column header in this exact order:

    Item Name,Category,desc,qty,weight,unit,url,price,worn,consumable

**Gear-library export** (`gear-library.csv`): no list-item context, so per-row `qty=1`, `worn=""`, `consumable=""`.

**List export** (`<sanitized-list-name>.csv`): full per-row data. `qty` is the list_item quantity. `worn` is the literal `Worn` when true, empty when false. `consumable` is the literal `Consumable` when true, empty when false. `is_packed` is excluded — Lighterpack has no equivalent and it's per-user runtime checklist state.

**Both paths**, every row: `weight` is the gear-item weight in grams as an integer (no unit suffix in the value). `unit` is the literal string `gram` (lowercase, full word — Lighterpack's convention). `url` is empty (grampacker doesn't store URLs). `price` is `0` (Lighterpack's default for unset prices; emitted numerically, not as empty).

Both:
- Header row first.
- Weights always exported in grams as integers.
- File encoding: UTF-8.
- Cell quoting only when needed (comma, quote, or newline in the cell).
- **Formula-injection handling.** On export: any cell starting with `=`, `+`, `-`, `@`, tab, or CR is prefixed with a single apostrophe to prevent formula evaluation in Excel/Sheets/Numbers. On import: leading apostrophes are preserved as-is — third-party CSV tools may emit them legitimately, and stripping would mangle those imports.
- No BOM. List-export filenames are sanitized at the call site (lowercase + non-alphanumerics → `-`).

### Import

Two surfaces, both run through `parseListCsv` / `parseGearCsv` and the shared `resolveOrCreateGearForImport` helper in `src/lib/queries/import-helpers.ts`.

**List import** (Import CSV button on `/lists` and the lists empty state) creates a new list named from the source filename (`nameFromCsvFilename` strips the path and `.csv` extension; falls back to `"Imported list"` when blank). The full per-row CSV — name, weight, category, quantity, worn, consumable — is captured into list_items.

**Gear-only import** (Import CSV button on `/gear`) adds gear directly to the inventory without creating a list. An explainer modal appears before the file picker:

> **Import gear inventory**
>
> Adds gear directly to your library without creating a list. Useful for importing an existing inventory of gear you own.
>
> Quantity, worn, and consumable settings from the CSV are ignored. Those apply to list items, not the inventory itself.

Common rules across both paths:

- **2 MB max file size**, checked in `useCsvFileInput` before parse. Larger files reject with a friendly error.
- Header row required. Column names matched case-insensitively after trimming. Required columns: a name column (`name` or `item name`) and a weight column (`weight_grams`, `weight (g)`, or `weight`). Optional aliases recognized: `description`/`desc`/`notes`, `category`, `quantity`/`qty`, `worn`/`is_worn`, `consumable`/`is_consumable`, `unit`. Unknown columns (including `is_packed`, `url`, `price` from a Lighterpack export) are silently dropped — the parser only reads the columns it has a use for.
- Optional `unit` column converts the weight value. Recognized: `g` / `gram` / `grams` / empty (treat as grams), `oz` / `ounce` / `ounces` (× 28.3495), `lb` / `pound` / `pounds` (× 453.592), `kg` / `kilogram` / `kilograms` (× 1000). Unknown unit strings fall through to grams as the most-tolerant default. Result rounded to integer grams and clamped to 100,000 g.
- Rows with empty name are skipped silently.
- Boolean columns accept `1`, `yes`, `true`, `worn`, or `consumable` as truthy (case-insensitive); anything else is false. The `worn` / `consumable` literals are Lighterpack's column-value convention (a worn-flag column carries the literal `Worn` when true, empty when false).
- Quantity is parsed as int and clamped to `[1, 9999]`; non-integer or empty values default to 1.
- **If both `worn` and `consumable` are truthy on the same row, BOTH are cleared.** The DB has a `worn_xor_consumable` CHECK constraint and we'd rather lose the flags than reject the whole import; the user re-applies the right flag in the UI. (Worth revisiting — silent lossy behavior is a known oddity.)
- Categories are matched case-insensitively against the user's existing categories and created if not found.

### Dedup rule (both import paths)

Gear-item match key: `category_id + lowercase(name) + weight_grams` — exact triple. Match against the existing library only, snapshotted at import start. **Newly-created gear during this import is NOT considered for matching by other rows in the same import** — within-CSV duplicates create separate gear items because typing two rows is intent.

- **List import.** Matched rows link the new list_item to the existing gear (no duplicate). Unmatched rows create new gear AND a list_item linking to it.
- **Gear-only import.** Matched rows skip silently (already in inventory). Unmatched rows create new gear; no list_items are touched.

---

## Drag-and-drop reordering rules

Three surfaces support DnD: `/gear`, `/lists/:id`, and `/lists` (card-level reorder). The public share view at `/r/:slug` is read-only and renders no drag affordances.

- **Category reorder is `/gear`-only.** Categories on `/lists/:id` render in their global `sort_order` but cannot be reordered there — no drag handle, no `useSortable` wrapper. Item-level DnD within categories works on both pages. The single-surface rule keeps "manage gear inventory and its order" cleanly on `/gear`; the list page is for working on a specific trip. (See `DECISIONS.md` ADR 11 for the rationale.)
- **Items reorder within their category only.** Cross-category drops are silently rejected — the item snaps back. Recategorizing an item happens via the item edit modal, or — on `/gear` only — via the multi-select toolbar's "Move to category". Each category section renders its own `<SortableContext>` for items, so dnd-kit's auto-shift only operates within-category. (See `DECISIONS.md` ADR 1 for the rationale.)
- **Uncategorized is not draggable.** The Uncategorized section has no `categories` table row, no drag handle, no rename, no delete. On `/gear` it cannot be a drop target for category drags either — the handler rejects `destCatId === null`. Items inside Uncategorized reorder among themselves like any other category.
- **Pack mode on `/lists/:id` disables item DnD.** The `useSortable` hook receives `disabled: packMode` so structural changes can't happen while the user is checking off items.
- **List cards on `/lists` reorder via DnD.** Drag a card by its grip handle (top-left); release on another card to insert. Multi-column grid uses `rectSortingStrategy` for collision detection (calculates target by bounding-rect intersection across column wraps). Drag is disabled while a card's rename input is open. `lists.sort_order` is rewritten globally per user. The other surfaces (`/lists/:id` for items, `/gear` for gear-items and categories) are unchanged.
- **All four reorderable tables go through the `bulk_update_sort_order` RPC** — `categories`, `list_items`, `gear_items`, and `lists`. Single round-trip per drag, atomic on the server, inline ownership filter per branch. Gear-item reorder still doesn't invalidate `['list-items']` (lists order by `list_items.sort_order`, not `gear_items.sort_order`, and the gear_item join projection doesn't include sort_order — a change is invisible to every list consumer).
- **Reorder writes are optimistic; failures surface a toast.** `makeOptimisticReorder` snapshots the cache, applies the new ordering, and on error rolls back AND triggers a toast via the shared toast system (`src/lib/toast.ts`). The toast says "Couldn't save the new order. Please try again." Other mutation failures (non-reorder) are still silent on rollback — see `CLAUDE.md` "Verification" for the hard-refresh discipline that catches them.
- **Custom collision detection during category drag on `/gear`.** When the active drag is a category, the droppable-container set is filtered to category-only ids. Without this, dnd-kit's `closestCenter` resolves `over` to one of the dragged category's own item rows (closer to the active's center than a sibling category) and the drop snaps back. Item drags use unmodified `closestCenter`. The list page only ever drags items, so it uses unmodified `closestCenter` directly.

---

## Optimistic update lifecycle

All four reorder mutations (`reorderCategories`, `reorderGearItems`, `reorderListItems`, `reorderLists`) use the same optimistic lifecycle, defined by `makeOptimisticReorder` in `src/lib/queries/optimistic.ts`:

1. **onMutate**: cancel in-flight queries for the affected key, snapshot the current cache as `previous`, write the new ordering to the cache. Synchronous (no `await` on `cancelQueries`) so dnd-kit's drop transition animates against the new DOM order rather than the old one.
2. **onError**: restore `previous`, surface a toast via `showToast` from `src/lib/toast.ts`.
3. **onSettled**: invalidate the affected key so a fresh fetch settles state.

Important: the cache rewrite assumes `updates` is a permutation of an existing subset of cached rows. Passing arbitrary values silently corrupts the cache. Use `assignSortOrderSlots` (in `lib/grouping.ts`) to build safe `updates` arrays.

See `CLAUDE.md` "Verification" — optimistic UI hides server rejections in milliseconds, so always hard-refresh after writes during testing.

---

## Toast notifications

The app uses a custom toast system for non-blocking notifications. Implementation in `src/lib/toast.ts` (module-level pub/sub store) and `src/components/Toast.tsx` (the `<ToastViewport>` component, mounted once at the app root).

- **Position.** Fixed bottom-right on md+ (`md:right-4 md:bottom-4 md:w-80`); fixed bottom-stretched on mobile (`inset-x-4`), lifted above the `MobileTabBar` plus its safe-area inset (`bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)]`) so toasts don't sit under the fixed tab bar.
- **Auto-dismiss.** 4 seconds default. The store records an absolute `expiresAt` timestamp rather than a relative duration, so cards that mount mid-toast (HMR reload, late subscribe) compute the right remaining delay.
- **Manual dismiss.** Each toast renders an X close button (`aria-label="Dismiss notification"`). Tapping it removes the toast immediately.
- **Type variants.** `info` (white background, `Info` icon, neutral), `error` (red-50 background, `TriangleAlert` icon, red accent), `success` (green-50 background, `CheckCircle2` icon, green accent). Selected via the `type` field on `showToast`'s options.
- **Accessibility.** The viewport carries `role="status"` and `aria-live="polite"` so additive new toasts announce to screen readers without interrupting the current SR output.
- **Current usage.** Only `makeOptimisticReorder.onError` (reorder failures across all four reorderable surfaces). Most mutation failures continue to surface inline at their call sites or via silent optimistic rollback — the global `MutationCache.onError` in `App.tsx` documents the policy on what gets a toast.
- **API.** `showToast(message, options?)` exported from `src/lib/toast.ts`. Options: `{ duration?: number; type?: 'info' | 'error' | 'success' }`. Plus `dismissToast(id)` for manual removal and `subscribe(listener)` for the viewport's `useSyncExternalStore` integration.

---

## Bulk operations

- **Multi-select on `/gear`**: enter Select mode via the Select button in the header. Toggle individual items, or use Select all / Deselect all. Toolbar appears at the bottom with: Move to category, Delete, Create list (creates a new list pre-populated from selection).
- **Move to category** uses `bulkMoveToCategoryGearItems` — distinct from DnD reorder, which is within-category only (see `DECISIONS.md` ADR 1).
- **Delete from inventory** cascades to every `list_item` referencing the gear item (NOT NULL gear_item_id with ON DELETE CASCADE since migration `20260427000001`).
