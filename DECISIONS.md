# Architecture decisions

Short ADRs covering the major shape decisions for grampacker that aren't obvious from reading the code. Each entry: context (what prompted it), decision (what we chose), consequences (what it means going forward), alternatives (what we rejected and why). The point is "future-you can scan this and understand why grampacker is shaped this way" without re-deriving it from `git log`.

---

## ADR 1: Cross-category drag-and-drop deliberately removed

**Date:** 2026-04-27 (commit `84e7efe`)

**Context.** An earlier iteration supported dragging items between categories via DnD on both `/gear` and `/lists/:id`. This required a planned `makeOptimisticCrossCategoryMove` helper, cross-category visual auto-shift on item drag, and ambiguous drop targets — was the user reordering within or recategorizing?

**Decision.** Items reorder WITHIN their category only via DnD. Recategorizing happens through the item edit modal. Bulk multi-select "Move to category" on `/gear` covers the "move many at once" path.

**Consequences.** DnD code is much simpler. The `/gear` page-level handler has two clean cases (category reorder, within-category item reorder) and rejects cross-category drops explicitly. The `/lists/:id` handler has only the within-category-item case after ADR 11 narrowed category reorder to `/gear`-only. Each `<CategoryGroup>` / `<CategorySection>` renders its own per-category `<SortableContext>` for items, so no page-wide flat items context is needed.

**Alternatives.** Keep cross-category DnD and accept the complexity. Rejected because the modal path is friction-acceptable for an action users do rarely, and the simpler DnD has fewer collision-detection edge cases — exactly the class of bug that bit us in late April when categories on `/lists/:id` snapped back because `closestCenter` resolved `over` to one of the dragged category's own items.

---

## ADR 2: No default categories created on signup

**Date:** 2026-04-29 (commit `cc571ec`)

**Context.** An earlier signup flow seeded a small starter set ("Shelter," "Sleeping," etc.) so new users had structure to drop items into.

**Decision.** New users land on an empty gear library and create their own categories.

**Consequences.** First-run requires the user to add at least one category before adding gear with categories. Signup is faster (no DB seed). The user's mental model isn't pre-shaped by an opinion the app has about how to categorize gear.

**Alternatives.** Keep defaults. Rejected because every backpacker's category mental model differs (long-trail vs. car-camp vs. winter), and forcing them to rename or delete starter categories felt worse than starting blank. Hidden upside: the empty-gear-library state was already worth special-casing in the UI for users who delete everything; the same affordance ("Add category") covers both the new-user and the deletes-everything case.

---

## ADR 3: Bulk DB operations go through Postgres RPCs, not PostgREST upserts

**Date:** 2026-04-30 (migration `20260430000000_bulk_reorder_rpc.sql`); ownership check added 2026-05-01 (migration `20260501000000_bulk_reorder_rpc_ownership_check.sql`).

**Context.** Reorder helpers originally called `supabase.from(table).upsert(rows, { onConflict: 'id' })`. PostgREST builds `INSERT … ON CONFLICT DO UPDATE`. PostgreSQL evaluates the INSERT-side RLS WITH CHECK and NOT NULL constraints against the proposed row before resolving the conflict, so partial-column payloads fail repeatedly — first RLS on user_id (42501), then NOT NULL on name (23502), then the next required column. Optimistic UI was masking the failures; the bug had been silently rolling back category reorders for weeks.

**Decision.** Bulk partial-column updates go through `SECURITY DEFINER` Postgres functions called via `supabase.rpc()`. The function bypasses RLS internally; we restrict its callable surface via a fixed table whitelist, revoke `EXECUTE` from anon, AND enforce ownership inline per table. `bulk_update_sort_order` is the canonical example: `categories`, `gear_items`, and `lists` branches filter on `user_id = auth.uid()` directly; the `list_items` branch joins `lists` and filters on `lists.user_id = auth.uid()`.

**Consequences.** Single round-trip preserved. The inline ownership check is defense-in-depth — the original migration relied on SELECT RLS gating which IDs a caller could know, but that trust assumption broke for tables with public/shared read paths (a signed-in attacker could read another user's `list_item` ids from a shared list and pass them to the RPC). The replacement (`20260501000000_bulk_reorder_rpc_ownership_check.sql`) silently drops rows the caller doesn't own — no error surface to probe, no information leak about which IDs exist. Tables added to the whitelist must specify their ownership predicate inline in the function body.

**Alternatives.** (a) Include every required column in the upsert payload. Rejected — whack-a-mole; every new NOT NULL or RLS clause re-breaks the helper. (b) Switch the bulk helper back to `Promise.all` of single-row PATCHes. Rejected — that's the N-roundtrips bug we'd already fixed once. The RPC sidesteps the upsert problem entirely while keeping the bulk-write performance.

**Accepted linter warning.** Supabase's linter raises an `authenticated_security_definer_function_executable` warning for this function. The warning is generic and flags any `SECURITY DEFINER` function callable by signed-in users — it doesn't know whether the function is safe, only that the class of risk exists. We accept the warning deliberately. The function's safety comes from its constraints (table whitelist limited to `categories`, `list_items`, `gear_items`, and `lists`; only ever rewrites `sort_order` and no other columns; inline `auth.uid()` ownership filter per branch; `EXECUTE` revoked from `public`/`anon` and granted only to `authenticated`) rather than from being unreachable. The linter's three suggested remediations would all break the feature without addressing a real risk given the constraints above: revoking `EXECUTE` would disable reorder for everyone; switching to `SECURITY INVOKER` would re-introduce the original PostgREST-upsert failure mode (RLS evaluating against the caller is exactly what we needed to bypass); moving the function out of the `public` schema would make it uncallable via `supabase.rpc()`, since PostgREST only exposes the `public` schema.

---

## ADR 4: Email — Resend for outbound, Cloudflare Email Routing for inbound

**Date:** 2026-04-30 (codified — providers configured out-of-band earlier)

**Context.** Supabase Auth needs working SMTP for signup verification, password reset, and magic links. Inbound mail to support / contact addresses needs somewhere to land.

**Decision.** Outbound transactional via Resend (configured as Supabase Auth's SMTP provider). Inbound via Cloudflare Email Routing (forwards to a personal mailbox; no inbound storage, no app integration).

**Consequences.** Two providers, one direction each. Domain DNS lives at Cloudflare so MX + DKIM coordination is straightforward. Auth deliverability is owned by Resend's sender reputation, not Supabase's shared SMTP pool. Inbound has no app-side surface — replies route to a human, the app doesn't parse them.

**Alternatives.** Single bidirectional provider (Postmark, Mailgun, AWS SES). Rejected — Cloudflare Email Routing is free at our inbound volume and we already use Cloudflare for DNS + Pages, so its marginal cost is zero. Resend handles the small monthly Auth volume well within the free tier and has the cleanest Supabase Auth docs.

---

## ADR 5: Single canonical row-action pattern (kebab menu)

**Date:** 2026-04-27 to 2026-04-29 (commits `f86ad46`, `a801a38`, `7e05387`)

**Context.** Earlier the gear and list rows had a mix of inline icon buttons (edit pencil, trash) plus a kebab menu plus an edit modal. Three visible paths to the same actions.

**Decision.** Per-row actions live in a kebab menu only. Items in order: Edit, [list-only: Remove from list], Delete from inventory (red). Bulk actions live in a multi-select toolbar on `/gear` only.

**Consequences.** Row chrome is just data + one kebab. Edit happens in modals, including the rare action of moving items between categories — that friction is acceptable because the action is rare. All five popovers in the app (HamburgerMenu, PrivacyButton, ItemRow's RowKebab, GearItemRow's GearRowKebab, list cards) share the `usePortalPopover` hook for dismiss behavior.

**Alternatives.** Visible icon buttons for the most-common action (delete) plus kebab for the rest. Rejected — splits one mental model into two and ages poorly: every new row action becomes a "should this be visible or in the kebab?" debate. Kebab-only sidesteps it, at the cost of one extra click for delete.

---

## ADR 6: `/lists` is the canonical list-management surface

**Date:** 2026-04-29 (commits `77bf989`, `c33bf79`)

**Context.** Lists were managed through a sidebar list-of-lists on `/lists/:id` — the same panel that holds the gear picker. The sidebar had its own create/import/rename/duplicate/delete affordances. This conflated "manage all my lists" and "work on this one list" into one panel.

**Decision.** `/lists` is a cards page where lists are managed (per-card kebab: rename, export CSV, duplicate, delete; New list / Import CSV at the top). The sidebar's job simplifies to "gear picker for this list." A Lists button in the top nav is the only fast-switch path.

**Consequences.** Two clean surfaces: card grid for management, detail page for working on one list. Mobile drawer became library-only (no list switcher). Items not yet in this list still get added from the in-list gear picker; gear-library editing still happens on `/gear`.

**Alternatives.** (a) Keep the sidebar list-of-lists alongside `/lists`. Rejected — two paths to the same operation drift over time. (b) Add a list-switcher dropdown in the nav. Rejected — solves "fast switching" but reintroduces the two-paths problem on rename/duplicate/delete.

---

## ADR 7: Worn / consumable / base weight is treated as a key differentiator

**Date:** 2026-04-30 (codification — UX has been this way since v1)

**Context.** Many gear-list apps either ignore worn/consumable (every gram equal) or expose them as advanced settings. Backpacking culture cares deeply about distinguishing carried-in-pack weight (base) from worn-on-body and consumed-during-trip — that's how trip planning actually works.

**Decision.** Worn and Consumable are first-class per-list-item flags surfaced directly on the row. Pack mode has a "Group Worn" toggle that flattens worn items into a trailing section. The Weight summary breaks down base / worn / consumable / total. CSV import tolerates rows that mark both worn and consumable: BOTH flags are silently cleared and the user re-applies the right one in the UI (the DB has a `worn_xor_consumable` CHECK constraint and we'd rather lose the flags than reject the whole import).

**Consequences.** Row UI is denser — two toggle slots per row, requiring tightened mobile layout. Weight summary is multi-row, not just a total. The `is_worn` and `is_consumable` columns are first-class on `list_items`, not derived.

**Alternatives.** (a) Hide worn/consumable behind an "advanced mode" settings toggle. Rejected — backpackers reading a gear list expect these breakdowns immediately; hiding them removes the app's core differentiator. (b) Treat consumable as identical to "regular" gear for weight calculations. Rejected — "fuel + food + water" is a meaningful planning category for any trip longer than a day.

---

## ADR 8: Per-list opt-in sharing

**Date:** 2026-04-30 (codification — sharing has been per-list since v1)

**Context.** Users sometimes want to show a list to a friend or post it for advice ahead of a trip. They never want their *whole* gear inventory or all of their other lists exposed. A single "make my account public" switch would over-share; no sharing at all would close off the use case the app exists for.

**Decision.** Sharing is per-list, opt-in, off by default. Each list has a 6-character `slug` generated at creation; the slug is only active when `is_shared = true`. Shared lists are read-only at `/r/:slug`; viewers don't need an account. Toggling sharing off on a list disables the link without changing the slug. There is no "regenerate slug" action — to break a leaked link, the user duplicates the list (which gets a fresh slug) and stops sharing the original.

(Renamed from `share_token` to `slug` and shortened from 8 → 6 chars on 2026-05-04; see migration `20260504000000_rename_share_token_to_slug.sql`. "Token" implied bearer credential, which doesn't fit a short, stable, public URL identifier — same shape as YouTube video IDs or Lighterpack share URLs.)

**Consequences.** Two RLS policies on `lists` and `list_items` — owner gets full access, public anon gets SELECT when the parent list has `is_shared = true`. The public share view at `/r/:slug` is its own page (`SharePage.tsx`) with no auth and no edit controls. Per-trip granularity matches how users actually share (one list at a time, with a specific person).

**Alternatives.** (a) Account-wide public profile. Rejected — over-shares; users curate which list they're proud of, not their whole closet. (b) No sharing. Rejected — sharing for advice is a real use case (the FAQ on `/help` calls this out). (c) Authenticated-only sharing (recipient signs in to view). Rejected — adds friction the recipient often doesn't accept; "send a link, no account needed" matches user expectations from Lighterpack and similar apps.

---

## ADR 9: Water (and similar liquid consumables) tracked as 1g gear with quantity = grams

**Date:** 2026-04-30

**Context.** Backpackers care about water weight precisely (it's 30%+ of pack weight on a hot day) but the data model has gear items with integer-gram weights and list items with integer quantity. There's no fractional quantity, no unit-aware weight, and no special handling for liquids. Carrying 3 L of water means 3000 g, but the schema has nowhere to put "3 L" or "3 kg" cleanly.

**Decision.** Treat water as a gear item with `weight_grams = 1` and `quantity = grams of water carried` (~1 g per mL at standard conditions). Same convention for fuel canister contents and similar dense liquid consumables. The `list_items.quantity` cap was raised from 99 to 9999 (DB CHECK + UI inputs + CSV parser clamp) to support up to ~10 L.

**Consequences.** The gear library shows entries like "Water — 1 g" without trip context, which is conceptually awkward for someone browsing inventory. The math works correctly: list weight = `sum(weight_grams × quantity)`, so `1 × 3000 = 3000 g` shows up cleanly in the rollup. CSV import/export round-trips correctly (the dedup rule keys on `category + name + weight`, so "Water" at 1g doesn't collide with a hypothetical "Water" at some other weight). Worn/consumable flags work as expected (mark water consumable).

**Alternatives.**
- Fractional `quantity` column. Rejected (for now) — schema change for one feature; ripples through every place that does qty math.
- Per-gear `weight_unit_per_unit` (e.g., a "ml of liquid" mode). Rejected — adds complexity to every weight calculation and a UI surface to explain it.
- A separate liquid tracker. Rejected — a whole new feature for what's effectively two or three items per trip.

May revisit if more "X grams of substance Y" cases pile up that don't fit the 1g+qty pattern.

---

## ADR 11: Category reorder is `/gear`-only

**Date:** 2026-04-30

**Context.** Earlier, category-level DnD worked on both `/gear` and `/lists/:id`. The list page only renders categories that have at least one item on the current list (plus Uncategorized), but reordering them on that page mutated the same global `categories.sort_order` rows used everywhere. Categories with no items on the current list — invisible from the list view — would have their relative position shift vs. dragged categories, even though the user couldn't see it happen. A Codex DnD architecture review flagged this as cognitively odd: a partial view mutating a global property in ways the user can't observe.

**Decision.** Category reorder happens only on `/gear`. The list page (`/lists/:id`) renders categories in their global `sort_order` but provides no drag affordance for category headers — no handle, no `useSortable` wrapper. Item-level DnD within categories still works on both pages.

**Consequences.** One canonical surface for managing category order, matching the pattern in ADR 5 (one row-action surface) and ADR 6 (`/lists` is the canonical list-management surface). The `SortableCategoryGroup` component, the page-level `<SortableContext>` for categories on the list page, the custom collision-detection workaround for nested-sortable category drag, and the category-reorder branch of `handleDragEnd` are all deleted (~75 lines). Users who want to rearrange categories navigate to `/gear` (one click via the existing "Back to list" affordance). The lists page handler simplifies to within-category item reorder only and can use unmodified `closestCenter`.

**Alternatives.** (a) Accept the global behavior and document it. Rejected — the partial-view-mutates-global-state oddity is exactly the class of UX surprise the app's other "two paths" decisions (ADR 5, ADR 6) avoided. (b) Restrict the list-page reorder to only categories visible on the list, leaving the rest in place. Rejected — adds new "filtered reorder" semantics to learn and a fork in the handler logic; cleaner to make `/gear` canonical and have one rule.

---

## ADR 12: Cross-owner FK enforcement via composite foreign keys

**Date:** 2026-05-06 (migration `20260506000002_add_user_id_to_list_items_composite_fks.sql`).

**Context.** Owner-keyed RLS validates that the user can write a given *row* — `auth.uid() = user_id` on the row being inserted — but doesn't by itself check that the rows that row *references* share the same owner. An authenticated attacker with a leaked id (e.g. from a public shared list before the read-path sanitization) could otherwise craft inserts threading cross-owner FK references — corrupting the data model without exposing any other user's data, but creating rows where (say) `gear_items.category_id` points at a category owned by someone else. Two FKs were vulnerable: `gear_items.category_id → categories.id` and `list_items.gear_item_id → gear_items.id`.

**Decision.** Composite foreign keys anchored on `user_id`. Each FK references the parent's `(id, user_id)` tuple, requires `UNIQUE(id, user_id)` on the parent, and ties the child's `user_id` to the FK target by structure rather than by policy. Three FKs locked down:
- `gear_items.category_id → categories.id` becomes `(category_id, user_id) → (id, user_id)`.
- `list_items.list_id → lists.id` becomes `(list_id, user_id) → (id, user_id)`.
- `list_items.gear_item_id → gear_items.id` becomes `(gear_item_id, user_id) → (id, user_id)`.

`list_items` previously had no `user_id` column (it traced ownership through `lists.user_id`). The migration adds `list_items.user_id` (NOT NULL, backfilled from the parent list) so all three composite FKs are anchored on a single column on the child side.

**Alternatives.**
- **(a) RLS WITH CHECK subquery against the FK target table.** Tried first (`20260506000000`). The `list_items_owner_all` policy's WITH CHECK clause was extended to add `EXISTS (SELECT 1 FROM gear_items WHERE gear_items.id = list_items.gear_item_id AND gear_items.user_id = auth.uid())`. **Rejected after applying** — the subquery against `gear_items` re-entered `gear_items`' own RLS policy, triggering Postgres `42P17` "infinite recursion detected in policy for relation list_items." Every `list_items` insert from the app failed silently. Reverted in `20260506000001`. **Rule learned: RLS WITH CHECK clauses can't safely reference another RLS-enabled table — they recurse.** Use schema-level constraints (composite FKs) when the goal is same-owner enforcement on a child table.
- **(b) BEFORE INSERT/UPDATE trigger** on the child table that raises if the FK target's `user_id` doesn't match. Schema-light but trigger-heavy. Rejected — composite FKs are the canonical declarative form Postgres provides; reaching for a trigger when a constraint suffices adds a control surface that's easier to forget when adding new FKs.

**Consequences.** Declarative, no per-row query overhead, no recursion risk, surfaces violations as standard FK constraint errors. Required schema additions: `UNIQUE(id, user_id)` on every parent table that's a composite-FK target — Postgres requires the FK target to match a UNIQUE/PK on the exact column tuple referenced; the PK on `id` alone isn't sufficient. The `list_items.user_id` addition propagates to TypeScript: the `ListItem` type gains the field, and every `list_items` insert site (createListFromSelection, duplicateList, importCsvRowsToList, addGearItemToList) threads `user_id` into its insert payload. The simplified `list_items_owner_all` RLS becomes `auth.uid() = user_id` direct (the previous `EXISTS (SELECT 1 FROM lists ...)` becomes redundant given the composite FK on `(list_id, user_id) → lists(id, user_id)` enforces equality structurally).

**Migration history.** `20260506000000` (RLS subquery attempt — recursion) → `20260506000001` (revert) → `20260506000002` (composite FK retry — successful) → `20260506000003` (`ON DELETE SET NULL` column-list fix; bare `SET NULL` would null all FK columns including `user_id` which is `NOT NULL`, so the PG 15+ form `ON DELETE SET NULL (category_id)` is required whenever any other FK column on the child is NOT NULL). Operational details and the per-FK rule for adding new ones live in `SECURITY.md` "Cross-owner FK enforcement".
