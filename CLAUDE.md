# Working with Claude on grampacker

## Verification

- **Always use `npm run build` to verify before committing.** Not `tsc --noEmit` — they are not equivalent. `npm run build` runs `tsc -b && vite build`, which applies stricter project-reference checks that match what Cloudflare Pages runs on deploy. A passing `tsc --noEmit` does NOT guarantee the build will succeed.
- After completing any multi-site refactor (extracting a hook, splitting a module, removing a feature), run a final grep to verify the migration is complete. Don't trust "it's done" assertions — trust grep.
- For any TypeScript change touching React types, especially refs and event handlers, verify with `npm run build` specifically. The lib types are subtle and small "cleanups" can break compatibility.

## TypeScript gotchas in this codebase

- `RefObject<T | null>` is the correct type for refs created with `useRef<T>(null)`. Do NOT "tighten" to `RefObject<T>` — the `| null` is load-bearing, not noise. This came up in `usePortalPopover` and broke the Cloudflare build.
- `noUncheckedIndexedAccess` is enabled in `tsconfig.app.json`. Indexed access returns `T | undefined`. Prefer destructuring with defaults, length guards, or `.find()` over non-null assertions. If you must use `!`, comment why.
- Supabase upserts replace the entire row by default. If you call `.upsert(updates, { onConflict: 'id' })` with a partial payload like `[{id, sort_order}]`, OTHER columns may be set to defaults or nulled. Either include all required columns or use a Postgres RPC.

## Domain model

- `gear_items` are the inventory (flat rows: id, name, weight_grams, category_id).
- `list_items` are per-trip references with their own per-list properties (quantity, is_packed, is_worn, is_consumable). They embed `gear_item` via Supabase join — when reading from the join, the gear_item is the source of truth for name/weight; list_item only stores trip-specific fields.
- After migration `20260427000001`, `list_items.gear_item_id` is NOT NULL with ON DELETE CASCADE. The gear_item join is non-nullable. Do not write code that handles a null gear_item.
- DnD reorders items WITHIN a category only. Cross-category DnD was deliberately removed. Moving an item between categories happens through the edit modal.
- Categories themselves are draggable to reorder.
- Bulk "Move to category" via multi-select toolbar uses `bulkMoveToCategoryGearItems`. That path is intentional and separate from DnD.

## Cache invalidation rules

- Lists embed gear via join. Any mutation that writes to `gear_items` AND changes a field that lists display (name, weight, category_id) must invalidate both `['gear-items']` and `['list-items']`.
- Mutations that only change `gear_items.sort_order` do NOT need to invalidate `['list-items']` — lists order by `list_items.sort_order`, not gear_items.sort_order.
- Mutations that only write to `list_items` invalidate `['list-items']` only.
- Don't widen invalidation defensively. Wider invalidation = unnecessary network traffic. If unsure whether an invalidation is needed, trace the actual data flow before adding it.

## UX patterns to preserve

- Single-row actions: kebab menu. Both gear page and list page. Items in order: Edit, [list-only: Remove from list], Delete from inventory (red).
- Bulk actions: multi-select toolbar on gear page only. Includes Select all / Select none.
- Edit happens in modals. Delete confirmations use the standardized "Delete from inventory" copy on both pages.
- Category moves happen in the edit modal, NOT in the kebab. This is deliberate — moves are rare enough that the modal friction is acceptable, and we avoid having two paths for the same operation.
- All four popovers (HamburgerMenu, PrivacyButton, ListsBox, ItemRow's RowKebab, GearItemRow's GearRowKebab) use the `usePortalPopover` hook for dismiss behavior. Do not reimplement mousedown/scroll/resize/escape listeners inline.

## Working style

- This codebase belongs to someone learning. Explain reasoning when proposing changes, not just the change itself.
- For multi-step refactors, work in checkpoints: survey before changing code, show the plan, then execute. Don't bundle structural decisions into a single diff.
- Single commits per logical change. Don't fold unrelated cleanups into a focused PR — split them.
- "Don't make any other changes" means don't expand scope. It does NOT mean leave the same conceptual change half-finished. If a type tightening implies cleanup at five other sites, those five sites are in scope.
- When asked to migrate or extract code at multiple sites, end with a grep confirming all sites moved. Don't assert completion based on memory.

## What NOT to do

- Don't recreate the "(deleted item)" placeholder rendering. The cascade migration made that case unreachable. The dead UI was removed in commit `c... ` (cascade cleanup batch).
- Don't add cross-category DnD back. It was deliberately removed.
- Don't add a second path to move items between categories. Edit modal only.
- Don't write `makeOptimisticCrossCategoryMove`. It was planned, then made unnecessary by removing cross-category DnD entirely.
- Don't add features inside refactor PRs. New behavior is a new commit.
- Don't bypass the `usePortalPopover` hook by writing inline event listeners for new popovers.

## Deferred upgrades

- eslint 9 → 10: blocked on eslint-plugin-jsx-a11y publishing a release with ^10 in its peer range. Revisit when they ship.
