# Working with Claude on grampacker

## Verification

- **Always use `npm run build` to verify before committing.** Not `tsc --noEmit`; they are not equivalent. `npm run build` runs `tsc -b && vite build`, which applies stricter project-reference checks that match what Cloudflare Pages runs on deploy. A passing `tsc --noEmit` does NOT guarantee the build will succeed.
- After completing any multi-site refactor (extracting a hook, splitting a module, removing a feature), run a final grep to verify the migration is complete. Don't trust "it's done" assertions; trust grep.
- For any TypeScript change touching React types, especially refs and event handlers, verify with `npm run build` specifically. The lib types are subtle and small "cleanups" can break compatibility.
- When testing a DB helper, verify the production code path you think uses it actually does. Production callers can diverge from what a helper was "designed for". Historically the gear-items reorder used `Promise.all` of single-row PATCHes rather than `bulkUpdateSortOrder` (since unified; see migration `20260502000000`), and the bulk-reorder helper was silently broken for categories for weeks because the existing test exercised an unused gear_items path. A passing test on table A tells you nothing about table B even if "they share a helper." Trace production callers manually and match tests to them.
- Optimistic updates can hide server rejections. A failed write rolls back in milliseconds: the UI flashes the right state, then snaps back to the original. During development, ALWAYS hard-refresh after a write to confirm the server accepted it. Optimistic UI is a UX latency tool, not a correctness signal.
- **Database migrations and RPCs are verified by the `DB Tests` pgTAP CI job** (`.github/workflows/db-tests.yml`), which runs `supabase db start` + `supabase test db` on a Docker-enabled GitHub runner against the pgTAP suites in `supabase/tests/`. `npm run build` does NOT exercise SQL. When you add or change a migration/RPC, add or update a pgTAP test (assert the happy path AND the rollback/failure path) and let `DB Tests` go green; local Docker is optional - the CI job is the authoritative integration loop. `throws_ok` gotcha: the 2-arg form treats arg 2 as the expected message, not a description - use the 4-arg form `throws_ok(sql, '23514', NULL, 'description')` to assert a SQLSTATE. To debug one failing suite locally, run `supabase test db supabase/tests/<file>.sql`. Catalog gotcha: `set search_path = ''` is stored in `pg_catalog.pg_proc.proconfig` as `search_path=""`, not `search_path=`.
- Supabase's advanced pgTAP docs describe optional `basejump-supabase_test_helpers` helpers (`tests.create_supabase_user()`, `tests.authenticate_as()`, `tests.authenticate_as_service_role()`, `tests.get_supabase_uid()`, `tests.rls_enabled()`) plus a `000-setup-tests-hooks.sql` pre-test file. This repo currently uses raw pgTAP fixtures. Do not half-adopt those helpers in one suite; if we adopt them, do it deliberately with a pinned helper version and shared setup file.

## TypeScript gotchas in this codebase

- `RefObject<T | null>` is the correct type for refs created with `useRef<T>(null)`. Do NOT "tighten" to `RefObject<T>`; the `| null` is load-bearing, not noise. This came up in `usePortalPopover` and broke the Cloudflare build.
- `noUncheckedIndexedAccess` is enabled in `tsconfig.app.json`. Indexed access returns `T | undefined`. Prefer destructuring with defaults, length guards, or `.find()` over non-null assertions. If you must use `!`, comment why.

## Database patterns

- **Bulk partial-column updates: use a Postgres RPC, not `.upsert()`.** PostgREST's `.upsert(rows, { onConflict: 'id' })` builds `INSERT … ON CONFLICT DO UPDATE`. PostgreSQL evaluates the INSERT-side RLS WITH CHECK, NOT NULL, and FK constraints against the proposed row (your payload + nulls for missing columns) BEFORE conflict resolution fires, even when the conflict always fires for the use case. With a partial `[{id, sort_order}]` payload, this fails on whichever constraint catches the missing columns first (RLS on user_id → 42501; then NOT NULL on name → 23502; then …). Adding columns one at a time is whack-a-mole. The fix is a `SECURITY DEFINER` Postgres function called via `supabase.rpc()`, gated by a hard-coded table whitelist. See `bulk_update_sort_order` in migration `20260430000000_bulk_reorder_rpc.sql` as the template.
- **Single-row PATCHes don't have the upsert problem.** `supabase.from(table).update(patch).eq('id', id)` is a true UPDATE: no INSERT path, no WITH CHECK on the proposed row, no NOT NULL trap. Fine for single-row writes (gear-item edits, list-item edits). The RPC pattern only matters for bulk partial-column writes.
- **Bulk multi-table writes that must be all-or-nothing: use a `SECURITY INVOKER` RPC with client-assigned UUIDs and server-side reference validation.** CSV list import (`create_list_with_imported_items` in migration `20260607135857_atomic_list_import_rpc.sql`) inserts categories, gear_items, a list, and list_items in one transaction. The TypeScript path (`src/lib/queries/import-plan.ts`) owns normalization, dedup, within-file duplicate handling, and sort-order planning, then emits a resolved plan whose new rows carry client-generated UUIDs (`randomTempId`). The RPC does NOT trust the plan: it re-checks `auth.uid() = p_user_id` and validates every symbolic reference (each gear's `category_id` and each list_item's `gear_item_id` must be either a UUID minted in this same call or an existing RLS-visible owned row) before writing. It is `security invoker` with `set search_path = ''` (fully schema-qualified identifiers) and `revoke ... from public, anon; grant execute ... to authenticated`, modeled on `create_list_from_selection`/`duplicate_list`. **Atomicity prevents partial writes (no orphaned list/categories/gear on a mid-import failure); it does NOT serialize dedup across concurrent imports** - two simultaneous imports can each create the same "new" gear. That is pre-existing, accepted behavior. Preflight caps (`assertListImportWithinCaps`) still run BEFORE the RPC so an over-cap import is rejected client-side.

## Domain model

- `gear_items` are the inventory (flat rows: id, name, weight_grams, category_id).
- `list_items` are per-trip references with their own per-list properties (quantity, is_packed, is_worn, is_consumable). They embed `gear_item` via Supabase join. When reading from the join, the gear_item is the source of truth for name/weight; list_item only stores trip-specific fields.
- After migration `20260427000001`, `list_items.gear_item_id` is NOT NULL with ON DELETE CASCADE. The gear_item join is non-nullable. Do not write code that handles a null gear_item.
- DnD reorders items WITHIN a category only. Cross-category DnD was deliberately removed. Moving an item between categories happens through the edit modal.
- Categories are draggable to reorder on `/gear` only, not on `/lists/:id`. (See DECISIONS.md ADR 11 for the rationale.)
- List cards on `/lists` are draggable to reorder. Card-level DnD shares the same `bulk_update_sort_order` RPC and `makeOptimisticReorder` helper as the other surfaces.
- Bulk "Move to category" via multi-select toolbar uses `bulkMoveToCategoryGearItems`. That path is intentional and separate from DnD.

## Cache invalidation rules

- Lists embed gear via join. Gear mutations that change fields embedded in `list_items.gear_item` must use `makeOptimisticUpdateWithFanout` (see `src/lib/queries/optimistic.ts`) or explicitly invalidate `['list-items']`. The private embedded field set is locked by `GEAR_ITEM_AUTH_SELECT` in `src/lib/queries/projections.ts` and the matching fan-out field set in `src/lists/list-items-fan-out.ts` (today: `name`, `description`, `weight_grams`, `category_id`, `status`); `shared-projections.test.ts` keeps them in sync. Public gear sharing uses the curated public views plus runtime forbidden-column guards rather than a `GEAR_ITEM_PUBLIC_SELECT` constant. The fan-out helper owns the cancel/snapshot/write/rollback/settle lifecycle across both caches so new gear-mutating sites cannot accidentally skip it.
- Mutations that only change `gear_items.sort_order` do NOT need to invalidate `['list-items']`. Lists order by `list_items.sort_order`, not gear_items.sort_order.
- Mutations that only write to `list_items` invalidate `['list-items']` only.
- Don't widen invalidation defensively. Wider invalidation = unnecessary network traffic. If unsure whether an invalidation is needed, trace the actual data flow before adding it.

## Mutation & async-action failure feedback

- **Optimistic mutation with a visible rollback:** the snap-back IS the failure
  signal; do NOT add a toast (existing documented policy for
  `makeOptimisticUpdate`/fan-out rollbacks). The one exception already in place
  is `makeOptimisticReorder`, whose rollback is otherwise invisible.
- **Non-optimistic `useMutation`:** opt into explicit feedback with
  `meta: { errorToast: "Couldn't ... Please try again." }`. The global
  `mutationErrorHandler` (`src/lib/mutation-error-handler.ts`) turns that into an
  error toast. Don't hand-roll an `onError` toast when the meta covers it.
- **Non-optimistic async action that is NOT a mutation** (a `useCallback` like
  `exportCsv`, or a raw async like `resetPacked`/`resetReady`): wrap the body in
  `try/catch`, `showToast(..., { type: 'error' })` on failure, and CONSUME the
  error (no rethrow). A toast-then-rethrow still leaves an unhandled rejection.
- **Fire-and-forget rejected promises are prohibited.** If an async handler is
  invoked without `await`/`.catch` (e.g. `onClick={() => doThing()}`), it must
  catch internally and surface feedback, or its contract must become
  `() => Promise<void>` and be awaited+caught at the call site.

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
- Flat reorder surfaces (ListsPage, DesktopListsPanel, GearLibraryPage categories) use the `useReorderable` hook in `src/lib/use-reorderable.ts`. The hook owns the `useQuery` subscription for the sortable cache, the `useMutation` with `makeOptimisticReorder`, the `activeId` state, and the `handleDragStart/Cancel/End` shape; the page wires `DndContext` with its own sensors, `SortableContext` with `items` from the hook, and `DragOverlay`. Using the hook structurally enforces the same-tick cache-subscription rule documented in `optimistic.ts` (the b8624ec snap-back race class). Nested-reorder surfaces (within-category list items on `/lists/:id`; within-category gear items on `/gear`) still hand-roll DnD because their algebra is slice-based; the narrated rule still applies there — keep the `useQuery` in the same component as the `DndContext`.

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
- Don't add `target="_blank"` without `rel="noopener noreferrer"` on the same anchor. Modern browsers default to `noopener` for `_blank`, but explicit `rel` is the codebase convention and removes the silent dependency on the browser default. The current sites are the external-link branches in `src/components/MarkdownContent.tsx` and `src/components/MarkdownPage.tsx` (both already correctly paired); this rule keeps any future site honest.

## Supply chain

- Use `npm ci` for deploy/CI installs, not `npm install`. `npm ci` installs exactly from `package-lock.json` and fails closed on drift; `npm install` can mutate the lockfile mid-deploy.
- Cloudflare Pages Build System v3 does not expose an "Install command" UI field; it auto-detects from the lockfile. With `package-lock.json` present the deploy runs `npm clean-install` (the long form of `npm ci`). Verified in the build log on 2026-05-28: `Installing project dependencies: npm clean-install --progress=false`. If the lockfile is ever deleted or renamed, the auto-detection falls back to `npm install`, which would silently allow drift; keep `package-lock.json` checked in.
- Do not use `git add -A` or `git add .`. Stage exact files by path. See `feedback_explicit_git_add` memory for the incident history.
- `.npmrc` sets `ignore-scripts=true`. This was accepted after testing a clean install + build, trading off the install-script convenience for supply-chain safety. If you ever remove it, re-test `rm -rf node_modules && npm ci` first: `fsevents` (Vite's macOS file-watcher) uses an install script, and toggling this flag affects dev file-watching on macOS.
- If GitHub Actions workflows are added later:
  - Avoid `pull_request_target` for workflows that check out or run fork code. Use `pull_request` for untrusted code paths.
  - Pin third-party actions to a full commit SHA, not a tag (`uses: owner/action@<sha>` with the tag in a trailing comment).
  - Do not share cache keys (`actions/cache`, setup-node cache, etc.) between trusted (push/release) and untrusted (PR) workflow contexts. A poisoned cache from a PR can otherwise leak into release builds.
  - Keep npm publish / OIDC workflows isolated from PR workflows. Separate files, separate triggers, no shared composite actions that PRs can influence.

## Deferred upgrades

- vitest 4 → 5: blocked on 5.0.0 GA. As of 2026-05-28, `npm view vitest dist-tags` shows `latest: 4.1.7`, `beta: 5.0.0-beta.3`. Not putting the test runner on a beta. Revisit when `latest` advances to 5.x (or when a stable `rc` ships and you trust the RC line).
- dnd-kit classic (`@dnd-kit/core` 6 / `@dnd-kit/sortable` 10 / `@dnd-kit/utilities` 3) → `@dnd-kit/react`: blocked on `@dnd-kit/react` reaching 1.0 (or a stable RC). As of 2026-05-28, `npm view @dnd-kit/react dist-tags` shows `latest: 0.4.0`, `beta: 0.5.0-beta-20260518131345`. Pre-1.0 with active churn — the maintainer hasn't frozen the API. The classic line is frozen but stable, no security issues, clean under `npm ci`. Migration is not a drop-in swap (new package names, new hook APIs); usage spans 7 files anchored by `src/lib/use-reorderable.ts`, so we want one migration pass against a stable target, not two against shifting 0.x minors. Revisit when `latest` advances to 1.x.

## Disabled lint coverage

- `eslint-plugin-jsx-a11y` is intentionally disabled while the project runs ESLint 10. Version 6.10.2 only declares support through ESLint 9 and breaks `npm ci` under npm's peer-dependency resolver. Revisit once a release lands with ESLint 10 in its peer range; until then, do not re-add the plugin or `jsx-a11y` flat config.
