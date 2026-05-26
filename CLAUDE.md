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

- Lists embed gear via join. Gear mutations that change fields embedded in `list_items.gear_item` must use `makeOptimisticUpdateWithFanout` (see `src/lib/queries/optimistic.ts`) or explicitly invalidate `['list-items']`. The current embedded field set is locked by `GEAR_ITEM_AUTH_SELECT` / `GEAR_ITEM_PUBLIC_SELECT` in `src/lib/queries/projections.ts` (today: `name`, `description`, `weight_grams`, `category_id`, `status`). The fan-out helper owns the cancel/snapshot/write/rollback/settle lifecycle across both caches so new gear-mutating sites cannot accidentally skip it.
- Mutations that only change `gear_items.sort_order` do NOT need to invalidate `['list-items']`. Lists order by `list_items.sort_order`, not gear_items.sort_order.
- Mutations that only write to `list_items` invalidate `['list-items']` only.
- Don't widen invalidation defensively. Wider invalidation = unnecessary network traffic. If unsure whether an invalidation is needed, trace the actual data flow before adding it.

## Row/table visual system

- The flat row/table grammar (white surface, gray-50 section-divider headers, bordered table rows, touch-vs-pointer density, control target sizes) is centralized in `src/components/flat-table-styles.ts` (`FLAT_TABLE_SURFACE`, `FLAT_TABLE_HEADER`, `FLAT_TABLE_ROW`, `ROW_CONTROL_TARGET`). Compose layout-specific gap/padding/columns around these bases; don't re-hand-code the density/border/surface classes. Row/category/list kebab actions use `src/components/RowMenuItem.tsx` for neutral/removal/danger tones. The gear picker (`LibraryPanel`) is the reference implementation. Full rationale + the documented exceptions (ListsPage `divide-y` rows, popover menus, `PanelCard`) live in `docs/ui-density.md`.

## UX patterns to preserve

- UI density rules live in `docs/ui-density.md`. Before changing row heights, category
  header heights, row chevrons, kebabs, or drag-handle target sizes, read that file and
  update all matching row-like surfaces together.
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

## Supply chain

- Use `npm ci` for deploy/CI installs, not `npm install`. `npm ci` installs exactly from `package-lock.json` and fails closed on drift; `npm install` can mutate the lockfile mid-deploy.
- Cloudflare Pages' install command lives in the dashboard, not in any repo file. The repo cannot enforce it. Manually confirm in Cloudflare → Pages → grampacker → Settings → Builds & deployments that "Install command" is `npm ci`.
- Do not use `git add -A` or `git add .`. Stage exact files by path. See `feedback_explicit_git_add` memory for the incident history.
- Do not add `ignore-scripts=true` to `.npmrc` without testing a clean install + build first and explicitly accepting the tradeoff. `fsevents` (Vite's macOS file-watcher) currently uses an install script; flipping the flag silently degrades dev file-watching on macOS.
- If GitHub Actions workflows are added later:
  - Avoid `pull_request_target` for workflows that check out or run fork code. Use `pull_request` for untrusted code paths.
  - Pin third-party actions to a full commit SHA, not a tag (`uses: owner/action@<sha>` with the tag in a trailing comment).
  - Do not share cache keys (`actions/cache`, setup-node cache, etc.) between trusted (push/release) and untrusted (PR) workflow contexts. A poisoned cache from a PR can otherwise leak into release builds.
  - Keep npm publish / OIDC workflows isolated from PR workflows. Separate files, separate triggers, no shared composite actions that PRs can influence.

## Deferred upgrades

- eslint 9 → 10: blocked on eslint-plugin-jsx-a11y publishing a release with ^10 in its peer range. Revisit when they ship.
