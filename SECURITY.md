# Security model

This document describes how authorization works in grampacker, where the security boundary lives, and how to extend it safely. Audience: any engineer (human or AI) opening the codebase for the first time. The goal is that you finish this doc in ten minutes knowing what enforces what, and what to do — and not do — when adding a new table or function.

For the *why* behind specific decisions, this doc cross-references `DECISIONS.md` (ADRs) and the migration files rather than duplicating their content.

---

## Architecture

grampacker is a Backend-as-a-Service app. The browser talks directly to **PostgREST** (Supabase's auto-generated REST layer), which talks to **Postgres**. There is no backend application server in between.

```
browser → PostgREST → Postgres
```

The implication is load-bearing: **the database is the security boundary**. Every authorization decision — who can read which row, who can write it, who can call which function — is enforced inside Postgres. If a policy is wrong, no upstream component will catch the mistake; the auto-generated REST endpoints will dutifully serve whatever the database is willing to return.

This is also what makes the model auditable: there is one place to look (the migrations) for the entire authorization story.

---

## Authorization lives in Row Level Security

Every table in the `public` schema has **Row Level Security** enabled. RLS is a Postgres feature that filters every query (SELECT/INSERT/UPDATE/DELETE) through a per-table policy expressed as a SQL predicate. Without a matching policy, queries return zero rows and writes are rejected.

Every user-owned table currently uses the **owner-keyed** pattern: `auth.uid() = user_id`. The row carries the owner's id directly. Used on `profiles`, `categories`, `gear_items`, `lists`, and `list_items` (the latter gained a direct `user_id` column in migration `20260506000002`, replacing its previous joined-via-parent policy).

A second pattern — **joined-via-parent** (`EXISTS (SELECT 1 FROM <parent> WHERE <parent>.id = <child>.<fk> AND <parent>.user_id = auth.uid())`) — is the option for future child tables that don't carry their own `user_id`. Not currently used by any table after the `list_items` migration. The template lives in "Adding a new table safely" below.

Owner policies are defined `FOR ALL` with both `USING` (read filter) and `WITH CHECK` (write filter); the `WITH CHECK` is what stops a user from updating one of their rows to belong to someone else.

| Table | Owner policy | Public-read policy |
|---|---|---|
| `profiles` | `auth.uid() = id` (self-select / self-update only — no insert by user; the `handle_new_user` trigger does that) | — |
| `categories` | `auth.uid() = user_id` (`categories_owner_all`) | `categories_public_select_via_shared_list` (transitive: only when a shared list references one of this category's gear items) |
| `gear_items` | `auth.uid() = user_id` (`gear_items_owner_all`) | `gear_items_public_select_via_shared_list` (transitive: only when a shared list references this gear item) |
| `lists` | `auth.uid() = user_id` (`lists_owner_all`) | `lists_public_select_shared` (`is_shared = true`) |
| `list_items` | `auth.uid() = user_id` (`list_items_owner_all`; direct since migration `20260506000002`) | `list_items_public_select_shared` (joins `lists` and checks `is_shared = true`) |

A defense-in-depth net guards against forgetting RLS on a new table. The `rls_auto_enable` event trigger (migration `20260429000000`) fires on every `CREATE TABLE` in `public` and runs `alter table … enable row level security` automatically. **This does not write the policies for you** — an RLS-enabled table without policies fails closed: nobody (including the owner) can read or write. Defense-in-depth, not autopilot.

For the precise SQL, see migrations `20260425000000`, `20260425000001`, `20260425000002`, and `20260427000000`.

### Cross-owner FK enforcement

Owner-keyed RLS validates that a user can write a given *row*, but doesn't by itself check that the rows it *references* share the same owner. An authenticated attacker with leaked ids could otherwise craft inserts threading cross-owner FK references — corrupting the data model without exposing any other user's data. Three foreign keys in this codebase are now locked down via composite foreign keys, all anchored on `user_id`:

- **`gear_items.category_id → categories.id`** — composite FK `(category_id, user_id) → (id, user_id)`. Uses the PG 15+ column-list form `ON DELETE SET NULL (category_id)` so only `category_id` is nulled when the parent category is deleted; `user_id` stays intact (it's NOT NULL on `gear_items`, and the bare `ON DELETE SET NULL` would null all FK columns and fail). Future composite FKs with SET NULL semantics need this same column-list form whenever any other FK column is NOT NULL on the child.
- **`list_items.list_id → lists.id`** — composite FK `(list_id, user_id) → (id, user_id)`. ON DELETE CASCADE preserved.
- **`list_items.gear_item_id → gear_items.id`** — composite FK `(gear_item_id, user_id) → (id, user_id)`. ON DELETE CASCADE preserved.

Each composite FK requires a `UNIQUE(id, user_id)` on its parent table. Postgres requires the FK target to match a UNIQUE/PK on the exact column tuple referenced; the PK on `id` alone isn't sufficient.

`list_items` previously had no `user_id` column — ownership traced through `list_items.list_id → lists.user_id`. Migration `20260506000002` adds `list_items.user_id` (NOT NULL, backfilled from the parent list's `user_id`) and replaces the `list_items_owner_all` RLS policy's `EXISTS (SELECT 1 FROM lists ...)` with a direct `auth.uid() = user_id` check. The composite FK on `(list_id, user_id) → lists(id, user_id)` enforces that `list_items.user_id` always equals the parent list's `user_id`, so the simplified policy is equivalent to the prior subquery-based one.

**Migration history.** A first attempt at this lockdown (migration `20260506000000`) used an RLS WITH CHECK subquery on `gear_items` to enforce same-owner references on `list_items.gear_item_id`. That triggered policy recursion (Postgres error 42P17) — the subquery against `gear_items` invoked `gear_items`' own RLS policy, looping. Symptom: every `list_items` insert from the app failed silently. Reverted in `20260506000001`. The retry (`20260506000002`) uses composite FKs throughout instead, since they're declarative database constraints that don't trigger RLS evaluation. Schema change > policy gymnastics when the goal is same-owner enforcement on a child table.

When adding a new FK from one user-owned table to another:
- Both tables must have `user_id` directly. If the child doesn't, add it and backfill before the FK.
- Add `UNIQUE(id, user_id)` on the parent if not already present.
- Use `FOREIGN KEY (child_fk_col, user_id) REFERENCES parent (id, user_id)`.
- Avoid WITH CHECK subqueries that reference another RLS-protected table when same-owner enforcement is the goal — the cross-policy evaluation can recurse, particularly when both policies use `auth.uid()`. Composite FKs (when both tables have `user_id`) or BEFORE-INSERT triggers move enforcement to the schema/trigger layer where recursion isn't a concern.

---

## Roles

PostgREST authenticates incoming requests against one of three Postgres roles:

- **`anon`** — unauthenticated. Used by the public share view (`/r/:slug`). Reads only via the `*_public_select_via_shared_list` and `*_public_select_shared` policies. Has no write capability anywhere.
- **`authenticated`** — signed-in users. Reads / writes via the owner policies. Has `EXECUTE` on the SECURITY DEFINER RPCs we expose (`delete_account`, `bulk_update_sort_order`).
- **`public`** (Postgres pseudo-role) — every grant defaults to this unless explicitly revoked. We **explicitly revoke `EXECUTE` from `public`** on every SECURITY DEFINER function we own, so a misconfigured grant elsewhere can't accidentally expose them.

There is no admin role today. The owner of every row is the user; there is no separate operator path.

---

## Public read paths (sharing)

Sharing is per-list and opt-in (see `DECISIONS.md` ADR 8 for the rationale). Each list has a 6-character `slug` generated at creation, and an `is_shared` boolean (default false). Public read access is granted to **`anon`** through four policies:

- `lists_public_select_shared` — `using (is_shared = true)`.
- `list_items_public_select_shared` — joins `lists` and checks `is_shared = true`.
- `gear_items_public_select_via_shared_list` — transitive: any gear item referenced by a `list_items` row in a shared list is readable.
- `categories_public_select_via_shared_list` — transitive: any category whose gear items are referenced by a shared list is readable.

**Trust model:** the `slug` is a short, unguessable, public URL handle — anyone with the URL can read the list while `is_shared = true`. We don't authenticate share-view requests (the slug IS the access mechanism), but we deliberately don't call it a credential because it isn't user-issued or password-like; it's a URL identifier in the same shape as a YouTube video ID or a Reddit post ID. Toggling `is_shared` off disables access without changing the slug; to break a leaked link, the user duplicates the list (which gets a fresh slug) and stops sharing the original. Slugs are 6 base62 characters (~57 billion combinations), so random guessing is impractical — but the `lists_public_select_shared` policy doesn't restrict by slug, so an anon caller could enumerate currently-shared lists via PostgREST's generic query interface (e.g. `?is_shared=eq.true&select=slug`). We accept this: a shared list is by definition opt-in public-readable, and any user who doesn't want their list enumerable from the public surface leaves `is_shared` off. Unknown-slug requests at `/r/<slug>` 404 because of the route handler's not-found check, not because of any enumeration-defense logic in the policy layer. See `SPEC.md` "Sharing mechanics" for the user-facing behavior.

**Public read column allowlist.** Even though RLS gates which *rows* the public can see, the queries themselves use explicit column lists rather than `select('*')` so the wire response never contains owner-only metadata. The allowlist by table:

- **`lists`** (via `fetchSharedList`): `id`, `name`, `description`. Excluded: `user_id`, `slug` (the viewer already has it via the URL), `is_shared` (always true given RLS gating), `sort_order` (per-user list ordering, irrelevant to viewer), `created_at`, `updated_at`.
- **`list_items`** (via `fetchSharedListItems`): `id`, `gear_item_id`, `quantity`, `is_worn`, `is_consumable`, `sort_order`. Excluded: `list_id` (viewer already has the parent list's id), `is_packed` (owner's packing state — personal workflow data), `created_at`, `updated_at`.
- **`gear_items`** (via the `list_items` join): `id`, `name`, `description`, `weight_grams`, `category_id`. Excluded: `user_id`, `sort_order`, `created_at`, `updated_at`.
- **`categories`** (via `fetchSharedListCategories`): `id`, `name`, `sort_order`. Excluded: `user_id`, `is_default`, `created_at`.

The `Public*` types in `src/lib/types.ts` (PublicList, PublicListItem, PublicGearItem, PublicCategory) make the wire shape explicit at the type level. SharePage maps these narrow types to the full types at one boundary point so the shared rendering components (CategoryGroup, WeightTable, ItemRow) can keep their unified type signatures across authed and share-view contexts.

---

## SECURITY DEFINER functions

`SECURITY DEFINER` makes a Postgres function execute with the privileges of its owner (effectively a superuser, in Supabase's setup) instead of the calling user. This **bypasses RLS** for the duration of the function. We use it sparingly — four functions total — and every one of them is structured to preserve the security boundary despite the bypass.

### Why we use it

PostgREST's auto-generated upsert path (`INSERT … ON CONFLICT DO UPDATE`) evaluates the INSERT-side RLS `WITH CHECK`, NOT NULL, and FK constraints against the proposed row **before** resolving the conflict — so partial-column payloads (e.g. `[{id, sort_order}]` for a bulk reorder) fail repeatedly on whichever required column catches the missing value first. A `SECURITY DEFINER` function that issues a plain `UPDATE` sidesteps the entire INSERT path. See `DECISIONS.md` ADR 3 for the full debugging story.

### Compensating-control checklist

Every `SECURITY DEFINER` function we own MUST have all four of:

1. **`search_path` pinned** — `set search_path = public, pg_temp` (or similar). Prevents schema-shadowing attacks where a malicious temp-schema object intercepts unqualified references inside the function.
2. **`EXECUTE` revoked from `public` and `anon`**, granted to `authenticated` only (or revoked entirely for trigger-only functions).
3. **Inline ownership check** in the function body. Because RLS is bypassed, the function itself must re-assert that the caller owns the row(s) it's touching. The check is what preserves the security boundary; the `SECURITY DEFINER` flag is purely a PostgREST workaround, not a privilege grant. Forgetting this turns the function into an authorization oracle.
4. **Trust assumption documented** in a header comment so a future reviewer can audit the model without re-deriving it.

### Inventory

| Function | Purpose | EXECUTE | Inline check | Migration |
|---|---|---|---|---|
| `handle_new_user()` | Trigger on `auth.users` insert; creates the `profiles` row. | Revoked from all (trigger fires regardless of EXECUTE privileges). | N/A — runs in trigger context with the new user's id from `NEW`. | `20260425000000`, hardened in `20260429000000` |
| `delete_account()` | User-callable RPC; deletes `auth.users` row for `auth.uid()`. ON DELETE CASCADE wipes all owned data. | `authenticated` only. | `if auth.uid() is null then raise exception 'not authenticated'` then `delete from auth.users where id = auth.uid()`. | `20260426000000` |
| `bulk_update_sort_order(p_table, p_ids, p_orders)` | Bulk `sort_order` rewrite for whitelisted tables. | `authenticated` only. | Per-table branch enforces ownership inline (`user_id = auth.uid()` for direct-owned tables; join filter on `lists` for `list_items`). | `20260430000000` (function shape), `20260501000000` (ownership check), `20260502000000` (gear_items), `20260503000000` (lists) |
| `rls_auto_enable()` | Event trigger on `CREATE TABLE` in `public`; auto-enables RLS. | Revoked from all (event trigger fires regardless). | N/A — defense-in-depth net, not user-callable. | `20260429000000` |

---

## Accepted linter warning

Supabase's database linter raises `authenticated_security_definer_function_executable` on every SECURITY DEFINER function granted to `authenticated`. The linter is generic and flags the *class* of risk; it doesn't know whether the function is constrained.

We accept the warning deliberately on `delete_account()` and `bulk_update_sort_order()`. The full reasoning — including why each of the linter's three suggested remediations (revoke EXECUTE, switch to `SECURITY INVOKER`, move out of the `public` schema) breaks the feature without addressing a real risk — lives in `DECISIONS.md` ADR 3 under "Accepted linter warning". When the linter raises this warning on a new function, decide between accepting (and document the rationale alongside ADR 3's pattern) or refactoring away from `DEFINER`. Don't silently leave it.

---

## Defense-in-depth extras

These don't carry the primary security load — RLS does — but they catch mistakes that would otherwise be silent.

- **`search_path` pinning** on every public function (migration `20260429000000`). Prevents schema-shadowing.
- **`rls_auto_enable` event trigger.** Already covered above. Stops a forgotten `enable row level security` from silently exposing a new table.
- **`ON DELETE CASCADE` chains.** `auth.users` → `profiles` → `categories` / `gear_items` / `lists`; `gear_items` → `list_items`; `lists` → `list_items`. Account deletion is comprehensive — `delete_account()` only needs to remove the `auth.users` row, the cascade does the rest.
- **Per-user resource caps via `BEFORE INSERT` triggers:** 100 lists per user, 500 gear items per user, 300 list items per list. Stops a runaway client from filling the database. Each cap is enforced both client-side (for friendly errors) and database-side (the source of truth).
- **In-app password change requires current-password re-authentication.** The change-password form in Settings calls `supabase.auth.signInWithPassword({ email, password: currentPassword })` before `supabase.auth.updateUser({ password: newPassword })`. An attacker with a leaked session token can't change the password without also knowing the current one. The verification call surfaces a generic "Current password is incorrect" rather than Supabase's verbatim error so rate-limit / account-state details don't leak. Supabase Auth's own throttling on `signInWithPassword` covers brute-force attempts.
- **Forgot-password recovery uses email-link verification.** The signed-out flow at `/forgot-password` calls `supabase.auth.resetPasswordForEmail` with a redirect to `/reset-password`. The recovery token in the email link IS the auth proof — equivalent in role to the current-password requirement on the in-app change flow. After a successful PKCE code exchange via `exchangeCodeForSession`, the page calls `updateUser({ password })`. Anti-enumeration: the request page shows the same success message regardless of whether the email exists. The redirect URL must be allowlisted in the Supabase dashboard's Auth → URL Configuration. **Recovery-only**: `/reset-password` requires the recovery code as proof — a normal authenticated session without the code is NOT sufficient. Signed-in users navigating directly to `/reset-password` without a `?code=` param redirect to `/settings` (where the in-app change-password flow's current-password challenge applies). Without this guard, a signed-in user could bypass the current-password proof.
- **Query-level owner scoping.** Every private query helper (`fetchLists`, `fetchGearItems`, `fetchCategories`, `fetchListItems`) explicitly filters by `user_id = <auth uid>` even though RLS would gate ownership anyway. The redundant filter prevents cross-user data from being returned through normal `select('*')` queries when a public RLS policy is also in scope: the `*_public_select_*` policies (used by the share view) match anyone with `is_shared = true`, and they don't carry an explicit `TO` clause — so they apply to the `authenticated` role too, not just `anon`. Without the query-level filter, a signed-in user's `select('*')` on `lists` would return their own lists PLUS every other user's shared lists. The `fetchAllUserListItems` helper (Settings → Download all data) has carried this pattern from day one with its `.eq('list.user_id', userId)` join filter; this rule generalizes that approach to all private helpers. Public read paths use dedicated helpers (`fetchSharedList`, `fetchSharedListItems`, `fetchSharedListCategories`) that don't filter by `user_id` — they intentionally rely on the public RLS policy. New private query helpers must filter by `user_id`; new public helpers must not. The four `*_public_select_*` policies' lack of `TO` scope is intentional: a signed-in user opening a friend's share link at `/r/<slug>` should still see the list, which requires the policy to match the `authenticated` role too. The query-level owner scoping is what keeps that channel from leaking into private query results.

---

## Adding a new table safely

1. **Reference `auth.users(id)`** on user-owned data, either directly via a `user_id` column or transitively through a parent that has one. `ON DELETE CASCADE` so account deletion cleans up.
2. **Enable RLS explicitly** in the migration: `alter table <name> enable row level security`. The `rls_auto_enable` trigger already does this, but writing it explicitly makes the migration self-documenting and removes the dependency on the trigger being installed.
3. **Write policies** for SELECT/INSERT/UPDATE/DELETE. Use one of the two patterns:
   - **Owner-keyed:**
     ```sql
     create policy <name>_owner_all on <table>
       for all using (auth.uid() = user_id)
       with check (auth.uid() = user_id);
     ```
   - **Joined-via-parent:**
     ```sql
     create policy <name>_owner_all on <table>
       for all using (
         exists (select 1 from <parent>
                 where <parent>.id = <table>.<fk>
                 and <parent>.user_id = auth.uid())
       )
       with check (
         exists (select 1 from <parent>
                 where <parent>.id = <table>.<fk>
                 and <parent>.user_id = auth.uid())
       );
     ```
4. **`WITH CHECK` is mandatory** on policies that govern INSERT or UPDATE. Without it, a user could update a row they own to belong to someone else.
5. **If the table participates in sharing,** add a `*_public_select_*` policy that gates on the shared parent's `is_shared = true` flag (or the transitive equivalent — see `gear_items_public_select_via_shared_list` for the shape).
6. **Don't grant** anything to `public` or `anon` directly. The default Supabase grants on the role plus your RLS policies handle access. Extra grants are how leaks happen.

---

## Adding a SECURITY DEFINER function safely

1. **Decide whether you actually need DEFINER.** Default to `SECURITY INVOKER` (the default if you don't specify) — RLS handles the authorization. `DEFINER` is for the narrow case where the auto-generated PostgREST path can't express what you need (the bulk-partial-column case is the canonical example).
2. **Pin `search_path`:** `set search_path = public, pg_temp` (or whatever schemas the function actually references; pin them all explicitly).
3. **Lock down EXECUTE:**
   ```sql
   revoke execute on function <name>(<args>) from public, anon;
   grant execute on function <name>(<args>) to authenticated;
   ```
   For trigger-only functions, revoke from all roles including `authenticated` — the trigger fires regardless of EXECUTE privileges.
4. **Add an inline `auth.uid()` ownership check** at the top of the function body. The check is the compensating control for bypassing RLS. Without it, `DEFINER` becomes a privilege escalation primitive.
5. **Document the trust assumption** in a header comment: what the function does, why it needs `DEFINER`, what the inline check enforces, and what would have to change to break the model.
6. **Reference `bulk_update_sort_order`** (migrations `20260501000000` + `20260502000000` + `20260503000000`) as the canonical pattern. Each table branch in that function is a concrete example of the inline-ownership pattern in both shapes (direct user_id and joined-via-parent).
7. **Expect the Supabase linter warning.** Decide between accept-with-rationale (alongside `DECISIONS.md` ADR 3) and refactor-to-INVOKER. Don't silently leave it.

---

## When the model needs to change

| Situation | Required change |
|---|---|
| New user-owned table | Standard owner-keyed policies (or joined-via-parent if there's no direct `user_id`). No security review needed beyond the checklist above. |
| New public read path | Add a `*_public_select_*` policy. Document the trust assumption (what gates it — slug + `is_shared` flag, public-by-design data, etc.). |
| Collaboration / multi-owner | Owner-keyed policies broaden to membership-keyed (e.g. `EXISTS (SELECT 1 FROM list_members WHERE list_id = … AND user_id = auth.uid())`). Every table that participates in collaboration needs a new policy shape; this is a real review, not a checklist item. |
| Admin role | Define a Postgres role, write admin-specific policies. Prefer narrow `for select to admin using (<predicate>)` over `for all using (true)` — least privilege still applies. |
| New SECURITY DEFINER function | Full review per the section above. Inline ownership check is non-negotiable. |
| Removing a public read path | Drop the corresponding `*_public_select_*` policy. Existing share links go silently 404 — same as toggling `is_shared` off. |

---

## Reference

**Migrations** (all in `supabase/migrations/`):
- `20260425000000_initial_schema.sql` — `profiles`, `set_updated_at`, `handle_new_user`, RLS on profiles.
- `20260425000001_categories_and_gear.sql` — `categories`, `gear_items`, owner-keyed RLS, count cap.
- `20260425000002_lists_and_list_items.sql` — `lists`, `list_items`, owner-keyed RLS, shared-list RLS (gated on `is_shared`), joined-via-parent RLS on `list_items` (later replaced — see `20260506000002`), count caps.
- `20260426000000_delete_account_rpc.sql` — `delete_account()`.
- `20260427000000_public_select_via_shared_list.sql` — transitive read for the share view.
- `20260427000001_cascade_gear_item_deletion.sql` — referential cleanup (NOT NULL + CASCADE on `list_items.gear_item_id`).
- `20260429000000_function_hardening.sql` — `search_path` pinning, `handle_new_user` lockdown, `rls_auto_enable` backfill.
- `20260430000000_bulk_reorder_rpc.sql` + `20260501000000_bulk_reorder_rpc_ownership_check.sql` + `20260502000000_add_gear_items_to_bulk_reorder.sql` + `20260503000000_add_lists_to_bulk_reorder.sql` — `bulk_update_sort_order` RPC, ownership check, table whitelist extensions.
- `20260504000000_rename_share_token_to_slug.sql` — share-token → slug rename + length 8 → 6.
- `20260505000000_fix_delete_account_search_path.sql` — `search_path` pin on `delete_account()` (drift fix from the function-hardening sweep).
- `20260505000001_profiles_self_update_with_check.sql` — adds the missing `WITH CHECK` clause to the profiles update policy.
- `20260506000000_composite_fks_for_same_owner.sql` + `20260506000001_revert_composite_fks_for_same_owner.sql` — first cross-owner-FK lockdown attempt (RLS WITH CHECK subquery), reverted after triggering policy recursion (Postgres 42P17). Kept in history for the lesson; see "Cross-owner FK enforcement" above.
- `20260506000002_add_user_id_to_list_items_composite_fks.sql` — composite FKs for cross-owner enforcement; adds `list_items.user_id`; simplifies `list_items_owner_all` to direct `auth.uid() = user_id`.
- `20260506000003_fix_category_delete_set_null_columns.sql` — fixes the composite FK on `gear_items.category_id` to use the PG 15+ `ON DELETE SET NULL (category_id)` column-list form so `user_id` (NOT NULL) doesn't get nulled on category deletion.

**ADRs** (in `DECISIONS.md`):
- ADR 3 — Bulk DB operations through Postgres RPCs (rationale + accepted linter warning).
- ADR 8 — Per-list opt-in sharing.

**Behavior reference** (in `SPEC.md`):
- "Row-level security" — short summary of the two policy shapes and the RPC pointer.
- "Sharing mechanics" — slug + RLS user-facing behavior.

**Codebase conventions** (in `CLAUDE.md`):
- "Database patterns" — when to use the RPC vs. single-row PATCH; the upsert trap.
