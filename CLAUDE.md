# Working with Claude on grampacker

## Verification

- **Always use `npm run build` to verify before committing.** Not `tsc --noEmit`; they are not equivalent. `npm run build` runs `tsc -b && vite build`, which applies stricter project-reference checks that match what Cloudflare Pages runs on deploy. A passing `tsc --noEmit` does NOT guarantee the build will succeed.
- After completing any multi-site refactor (extracting a hook, splitting a module, removing a feature), run a final grep to verify the migration is complete. Don't trust "it's done" assertions; trust grep.
- For any TypeScript change touching React types, especially refs and event handlers, verify with `npm run build` specifically. The lib types are subtle and small "cleanups" can break compatibility.
- When testing a DB helper, verify the production code path you think uses it actually does. Production callers can diverge from what a helper was "designed for". Historically the gear-items reorder used `Promise.all` of single-row PATCHes rather than `bulkUpdateSortOrder` (since unified; see migration `20260502000000`), and the bulk-reorder helper was silently broken for categories for weeks because the existing test exercised an unused gear_items path. A passing test on table A tells you nothing about table B even if "they share a helper." Trace production callers manually and match tests to them.
- Optimistic updates can hide server rejections. A failed write rolls back in milliseconds: the UI flashes the right state, then snaps back to the original. During development, ALWAYS hard-refresh after a write to confirm the server accepted it. Optimistic UI is a UX latency tool, not a correctness signal.

## TypeScript gotchas in this codebase

- `RefObject<T | null>` is the correct type for refs created with `useRef<T>(null)`. Do NOT "tighten" to `RefObject<T>`; the `| null` is load-bearing, not noise. This came up in `usePortalPopover` and broke the Cloudflare build.
- `noUncheckedIndexedAccess` is enabled in `tsconfig.app.json`. Indexed access returns `T | undefined`. Prefer destructuring with defaults, length guards, or `.find()` over non-null assertions. If you must use `!`, comment why.

## Database patterns

- **Bulk partial-column updates: use a Postgres RPC, not `.upsert()`.** PostgREST's `.upsert(rows, { onConflict: 'id' })` builds `INSERT … ON CONFLICT DO UPDATE`. PostgreSQL evaluates the INSERT-side RLS WITH CHECK, NOT NULL, and FK constraints against the proposed row (your payload + nulls for missing columns) BEFORE conflict resolution fires, even when the conflict always fires for the use case. With a partial `[{id, sort_order}]` payload, this fails on whichever constraint catches the missing columns first (RLS on user_id → 42501; then NOT NULL on name → 23502; then …). Adding columns one at a time is whack-a-mole. The fix is a `SECURITY DEFINER` Postgres function called via `supabase.rpc()`, gated by a hard-coded table whitelist. See `bulk_update_sort_order` in migration `20260430000000_bulk_reorder_rpc.sql` as the template.
- **Single-row PATCHes don't have the upsert problem.** `supabase.from(table).update(patch).eq('id', id)` is a true UPDATE: no INSERT path, no WITH CHECK on the proposed row, no NOT NULL trap. Fine for single-row writes (gear-item edits, list-item edits). The RPC pattern only matters for bulk partial-column writes.

## Domain model

- `gear_items` are the inventory (flat rows: id, name, weight_grams, category_id).
- `list_items` are per-trip references with their own per-list properties (quantity, is_packed, is_worn, is_consumable). They embed `gear_item` via Supabase join. When reading from the join, the gear_item is the source of truth for name/weight; list_item only stores trip-specific fields.
- After migration `20260427000001`, `list_items.gear_item_id` is NOT NULL with ON DELETE CASCADE. The gear_item join is non-nullable. Do not write code that handles a null gear_item.
- DnD reorders items WITHIN a category only. Cross-category DnD was deliberately removed. Moving an item between categories happens through the edit modal.
- Categories are draggable to reorder on `/gear` only, not on `/lists/:id`. (See DECISIONS.md ADR 11 for the rationale.)
- List cards on `/lists` are draggable to reorder. Card-level DnD shares the same `bulk_update_sort_order` RPC and `makeOptimisticReorder` helper as the other surfaces.
- Bulk "Move to category" via multi-select toolbar uses `bulkMoveToCategoryGearItems`. That path is intentional and separate from DnD.

## Cache invalidation rules

- Lists embed gear via join. Any mutation that writes to `gear_items` AND changes a field that lists display (name, weight, category_id) must invalidate both `['gear-items']` and `['list-items']`.
- Mutations that only change `gear_items.sort_order` do NOT need to invalidate `['list-items']`. Lists order by `list_items.sort_order`, not gear_items.sort_order.
- Mutations that only write to `list_items` invalidate `['list-items']` only.
- Don't widen invalidation defensively. Wider invalidation = unnecessary network traffic. If unsure whether an invalidation is needed, trace the actual data flow before adding it.

## UX patterns to preserve

- Single-row actions: kebab menu. Both gear page and list page. Items in order: Edit, [list-only: Remove from list], Delete from inventory (red).
- Bulk actions: multi-select toolbar on gear page only. Includes Select all / Select none.
- Edit happens in modals. Delete confirmations use the standardized "Delete from inventory" copy on both pages.
- Category moves happen in the edit modal, NOT in the kebab. This is deliberate: moves are rare enough that the modal friction is acceptable, and we avoid having two paths for the same operation.
- All five popovers (HamburgerMenu, PrivacyButton, ItemRow's RowKebab, GearItemRow's GearRowKebab, ListsPage's per-card RowKebab) use the `usePortalPopover` hook for dismiss behavior. Do not reimplement mousedown/scroll/resize/escape listeners inline.

## Working style

- This codebase belongs to someone learning. Explain reasoning when proposing changes, not just the change itself.
- For multi-step refactors, work in checkpoints: survey before changing code, show the plan, then execute. Don't bundle structural decisions into a single diff.
- Single commits per logical change. Don't fold unrelated cleanups into a focused PR; split them.
- "Don't make any other changes" means don't expand scope. It does NOT mean leave the same conceptual change half-finished. If a type tightening implies cleanup at five other sites, those five sites are in scope.
- When asked to migrate or extract code at multiple sites, end with a grep confirming all sites moved. Don't assert completion based on memory.

## What NOT to do

- Don't recreate the "(deleted item)" placeholder rendering. The cascade migration made that case unreachable. The dead UI was removed in commit `5fac55f`.
- Don't add cross-category DnD back. It was deliberately removed.
- Don't add a second path to move items between categories. Edit modal only.
- Don't write `makeOptimisticCrossCategoryMove`. It was planned, then made unnecessary by removing cross-category DnD entirely.
- Don't add features inside refactor PRs. New behavior is a new commit.
- Don't bypass the `usePortalPopover` hook by writing inline event listeners for new popovers.
- Don't add `target="_blank"` without `rel="noopener noreferrer"` on the same anchor. Modern browsers default to `noopener` for `_blank`, but explicit `rel` is the codebase convention and removes the silent dependency on the browser default. The only current site is `src/components/MarkdownPage.tsx`'s external-link branch (already correctly paired); this rule keeps any future site honest.

## Deferred upgrades

- eslint 9 → 10: blocked on eslint-plugin-jsx-a11y publishing a release with ^10 in its peer range. Revisit when they ship.
