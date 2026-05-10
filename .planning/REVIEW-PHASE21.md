# Phase 21 — Supabase advisor cleanup: RLS policy shape (2026-05-06)

> **Status (locked):** spec for Codex review. Do not execute until the user gives the go-ahead.

## Goal

Resolve the 26 Supabase performance-advisor warnings on RLS policies for `profiles`, `categories`, `gear_items`, `lists`, and `list_items`, without changing any user-visible authorization behavior. Two warning families are in scope:

- **`auth_rls_initplan`** — `auth.uid()` called directly inside policy `USING` / `WITH CHECK` is re-evaluated per row. Wrapping in `(select auth.uid())` lets the planner cache the value as an initPlan (one evaluation per query). Pure perf, no behavior change.
- **`multiple_permissive_policies`** — when 2+ PERMISSIVE policies cover the same role+action, Postgres ORs their predicates together. Slightly slower than one combined predicate, and a maintenance hazard. Currently every table except `profiles` has two SELECT-applicable PERMISSIVE policies (`*_owner_all` FOR ALL + `*_public_select_*` FOR SELECT). Neither carries a `TO` clause, so both apply through `public` and inherit to **every role that inherits from public** — `anon`, `authenticated`, plus Supabase's internal roles (`authenticator`, `dashboard_user`, `supabase_privileged_role`, etc., depending on the project version). The advisor flags the overlap once per (role, action) pair, so the same two-policy overlap on a single table fans out into ~5 warnings instead of 2. Across the four affected tables that's the ~20 multiple_permissive_policies warnings the user observed. Adding explicit `TO anon` / `TO authenticated` to the new policies clears the extra roles too: those internal roles no longer have any directly matching policy on the rewritten tables, so they fall through to the default-deny.

`auth_leaked_password_protection` is **out of scope** per the user's brief — that's an intentionally-unenabled auth setting, not a policy issue.

---

## Why this phase is small

This is housekeeping, not a behavior change. Every preserved-behavior bullet from the user's brief is a property the new policies must continue to express:

- Signed-out anons can read public shared lists and the rows they transitively reach (list_items, gear_items, categories).
- Signed-in users can also read someone else's public shared list at `/r/:slug`.
- Signed-in users querying their private surfaces still see only their own rows. The codebase's query-level `user_id = auth.uid()` filters (documented in `SECURITY.md` "Defense-in-depth extras → Query-level owner scoping") provide the narrow filter; the database-level policy is allowed to be permissive on owner-or-shared without leaking into private queries.
- Writes (INSERT/UPDATE/DELETE) remain owner-only.

The new policy shape collapses today's two-policy-per-table SELECT into one role-and-action-specific policy per role, with separate INSERT / UPDATE / DELETE policies on `authenticated`. The shipped predicates are exactly the OR of today's `*_owner_all` + `*_public_select_*` predicates, with `auth.uid()` substituted for `(select auth.uid())`.

---

## Current state (verbatim, for reference)

Quoted from the migrations so the executor doesn't have to chase them down. Predicate bodies must be preserved exactly into the new policies.

### profiles (`20260425000000` + `20260505000001`)

```sql
create policy profiles_self_select on public.profiles
  for select using (auth.uid() = id);

create policy profiles_self_update on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
```

No INSERT policy — the only insert path is the `handle_new_user` trigger (`SECURITY DEFINER`, bypasses RLS).
No public-share policy — profiles are private only.

### categories (`20260425000001` + `20260427000000`)

```sql
create policy categories_owner_all on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy categories_public_select_via_shared_list on public.categories
  for select using (
    exists (
      select 1
      from gear_items g
      join list_items li on li.gear_item_id = g.id
      join lists l on l.id = li.list_id
      where g.category_id = categories.id and l.is_shared = true
    )
  );
```

### gear_items (`20260425000001` + `20260427000000`)

```sql
create policy gear_items_owner_all on public.gear_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy gear_items_public_select_via_shared_list on public.gear_items
  for select using (
    exists (
      select 1
      from list_items li
      join lists l on l.id = li.list_id
      where li.gear_item_id = gear_items.id and l.is_shared = true
    )
  );
```

### lists (`20260425000002`)

```sql
create policy lists_owner_all on public.lists
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy lists_public_select_shared on public.lists
  for select using (is_shared = true);
```

### list_items (`20260425000002`, reshaped in `20260506000002`)

```sql
create policy list_items_owner_all on public.list_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy list_items_public_select_shared on public.list_items
  for select using (
    exists (select 1 from lists where lists.id = list_items.list_id and lists.is_shared = true)
  );
```

---

## Target state

Per-table-per-role-per-action policies. Naming convention `<table>_<role>_<action>` for the new policies; `profiles_self_*` keeps its existing names since it's the special case (one user, no anon, no public share).

### profiles — replace 2 → 2 (same shape, with `(select auth.uid())`)

```sql
create policy profiles_self_select on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy profiles_self_update on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
```

### categories — replace 2 → 5

```sql
-- anon can read categories transitively reachable through any shared list
create policy categories_anon_select on public.categories
  for select to anon
  using (
    exists (
      select 1
      from gear_items g
      join list_items li on li.gear_item_id = g.id
      join lists l on l.id = li.list_id
      where g.category_id = categories.id and l.is_shared = true
    )
  );

-- authenticated callers see their own categories OR public-share-reachable
create policy categories_auth_select on public.categories
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from gear_items g
      join list_items li on li.gear_item_id = g.id
      join lists l on l.id = li.list_id
      where g.category_id = categories.id and l.is_shared = true
    )
  );

create policy categories_auth_insert on public.categories
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy categories_auth_update on public.categories
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy categories_auth_delete on public.categories
  for delete to authenticated
  using ((select auth.uid()) = user_id);
```

### gear_items — replace 2 → 5

```sql
create policy gear_items_anon_select on public.gear_items
  for select to anon
  using (
    exists (
      select 1
      from list_items li
      join lists l on l.id = li.list_id
      where li.gear_item_id = gear_items.id and l.is_shared = true
    )
  );

create policy gear_items_auth_select on public.gear_items
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from list_items li
      join lists l on l.id = li.list_id
      where li.gear_item_id = gear_items.id and l.is_shared = true
    )
  );

create policy gear_items_auth_insert on public.gear_items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy gear_items_auth_update on public.gear_items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy gear_items_auth_delete on public.gear_items
  for delete to authenticated
  using ((select auth.uid()) = user_id);
```

### lists — replace 2 → 5

```sql
create policy lists_anon_select on public.lists
  for select to anon
  using (is_shared = true);

create policy lists_auth_select on public.lists
  for select to authenticated
  using ((select auth.uid()) = user_id or is_shared = true);

create policy lists_auth_insert on public.lists
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy lists_auth_update on public.lists
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy lists_auth_delete on public.lists
  for delete to authenticated
  using ((select auth.uid()) = user_id);
```

### list_items — replace 2 → 5

```sql
create policy list_items_anon_select on public.list_items
  for select to anon
  using (
    exists (select 1 from lists where lists.id = list_items.list_id and lists.is_shared = true)
  );

create policy list_items_auth_select on public.list_items
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (select 1 from lists where lists.id = list_items.list_id and lists.is_shared = true)
  );

create policy list_items_auth_insert on public.list_items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy list_items_auth_update on public.list_items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy list_items_auth_delete on public.list_items
  for delete to authenticated
  using ((select auth.uid()) = user_id);
```

---

## Why this shape eliminates both advisor families

**`auth_rls_initplan` resolved:** every `auth.uid()` reference is wrapped in `(select auth.uid())`. The optimizer pulls the subquery out as an initPlan and evaluates it once per query instead of once per row.

**`multiple_permissive_policies` resolved:** every new policy carries an explicit `TO` clause, so each (role, action) pair sees at most one PERMISSIVE policy. Coverage:

| Table | role=anon | role=authenticated | every other role (`public` membership: `authenticator`, `dashboard_user`, `supabase_privileged_role`, etc.) |
|---|---|---|---|
| `profiles` | (no policy → deny) | self select + self update only | (no policy → deny) |
| `categories`, `gear_items`, `list_items`, `lists` | one SELECT policy | one policy per action: SELECT / INSERT / UPDATE / DELETE | (no policy → deny) |

The advisor counts per (role, action). With the old shape, the missing `TO` clause made every `*_owner_all` and `*_public_select_*` policy apply through `public`, so the SELECT overlap fanned out across every role inheriting public — anon, authenticated, and the Supabase internals — producing ~5 overlapping-SELECT warnings per table × 4 tables ≈ the 20 warnings the user observed. With the new shape: anon-SELECT has one policy, authenticated-SELECT has one (the OR'd own-or-shared predicate replacing the previous two-policy combination), authenticated-{INSERT, UPDATE, DELETE} each get one, anon-{INSERT, UPDATE, DELETE} have none and stay denied, and every other role has none on these tables and falls through to the default-deny. No (role, action) pair is hit by more than one policy.

---

## Behavior preservation matrix

| Scenario | Today | After Phase 21 |
|---|---|---|
| anon hits `/r/:slug` for public list | `lists_public_select_shared` permits, transitive policies permit list_items/gear_items/categories | `lists_anon_select` permits, transitive `*_anon_select` permit |
| anon hits `/r/:slug` for non-shared list | `is_shared = true` predicate fails → 0 rows → 404 in route handler | same — `lists_anon_select` predicate is identical |
| anon raw `select * from lists?is_shared=eq.true` | Returns all currently-shared slugs (accepted residual risk per `SECURITY.md` "Public read paths") | identical — predicate unchanged |
| authenticated user hits `/lists` (own private lists) | `lists_owner_all` matches own + `lists_public_select_shared` matches every public list; query helper narrows via `user_id = auth.uid()` | `lists_auth_select` matches own + every public list (combined predicate); same query helper narrows |
| authenticated user hits `/r/:slug` for friend's shared list | `lists_public_select_shared` permits (no TO clause, applies to authenticated too) | `lists_auth_select`'s `is_shared = true` branch permits |
| authenticated user inserts a list with someone else's user_id | Blocked by `lists_owner_all` WITH CHECK | Blocked by `lists_auth_insert` WITH CHECK |
| authenticated user updates a list to belong to someone else | Blocked by `lists_owner_all` WITH CHECK | Blocked by `lists_auth_update` WITH CHECK |
| authenticated user deletes someone else's list | Blocked by `lists_owner_all` USING | Blocked by `lists_auth_delete` USING |
| `delete_account()` cascade wipes user's rows | Cascades bypass RLS | unchanged |
| `bulk_update_sort_order()` / Phase 8 RPCs | SECURITY DEFINER bypasses RLS | unchanged |
| Composite-FK cross-owner enforcement | Schema-level FK constraint | unchanged |

---

## Active commits

### C1 — Migration: replace owner_all + public_select_* with role-and-action-specific policies

**File:** `supabase/migrations/20260512000000_advisor_cleanup_rls_policies.sql`

Migration body: a header comment block explaining the rewrite (advisor cleanup; preserves behavior; references the prior owner_all/public_select shape and the migrations that created it), followed by per-table sections each consisting of `DROP POLICY IF EXISTS` for the old policies and `CREATE POLICY` for the new shape. Bodies exactly as quoted in "Target state" above.

Suggested header:

```sql
-- Phase 21: Supabase advisor cleanup — replace owner_all + public_select_*
-- with role-and-action-specific policies. Closes 26 advisor warnings:
--   * auth_rls_initplan (6) — auth.uid() called directly per row; wrapped
--     in (select auth.uid()) for initPlan caching.
--   * multiple_permissive_policies on SELECT (~20 across the four tables).
--     The old policies had no TO clause and applied through public, which
--     fanned the SELECT-policy overlap (FOR ALL owner_all + FOR SELECT
--     public_select_*) out across every role that inherits from public:
--     anon, authenticated, and Supabase internals (authenticator,
--     dashboard_user, supabase_privileged_role, …). Explicit TO anon / TO
--     authenticated on every new policy collapses each overlap to one
--     policy per (role, action) and clears the internal roles too.
--
-- Behavior preserved exactly:
--   - anon can read public shared rows (lists.is_shared = true) and the
--     transitively-reachable list_items / gear_items / categories.
--   - authenticated users can read their own rows OR public shared rows
--     (so opening a friend's /r/:slug while signed in still works).
--   - Writes (INSERT/UPDATE/DELETE) remain owner-only.
--
-- Migration history this supersedes:
--   - 20260425000000 (profiles policies)
--   - 20260425000001 (categories_owner_all, gear_items_owner_all)
--   - 20260425000002 (lists_owner_all, lists_public_select_shared,
--                     list_items_owner_all, list_items_public_select_shared)
--   - 20260427000000 (gear_items_public_select_via_shared_list,
--                     categories_public_select_via_shared_list)
--   - 20260505000001 (profiles_self_update WITH CHECK)
--   - 20260506000002 (list_items_owner_all reshape after user_id added)
--
-- query-level owner scoping (per SECURITY.md "Defense-in-depth extras")
-- is what keeps the OR'd authenticated SELECT predicate from leaking
-- public-shared rows into private query results — fetchLists / fetchGear
-- Items / fetchCategories / fetchListItems all carry an explicit
-- user_id = <auth uid> filter. Do not weaken those.
```

Then per-table sections (literal SQL bodies are above in "Target state"):

```sql
-- ============================================================
-- profiles
-- ============================================================
drop policy if exists profiles_self_select on public.profiles;
drop policy if exists profiles_self_update on public.profiles;

<create policy profiles_self_select … (TO authenticated, (select auth.uid()) = id)>
<create policy profiles_self_update … (TO authenticated, USING + WITH CHECK)>

-- ============================================================
-- categories
-- ============================================================
drop policy if exists categories_owner_all on public.categories;
drop policy if exists categories_public_select_via_shared_list on public.categories;

<create policy categories_anon_select … (transitive predicate)>
<create policy categories_auth_select … ((select auth.uid()) = user_id OR transitive)>
<create policy categories_auth_insert … >
<create policy categories_auth_update … >
<create policy categories_auth_delete … >

-- ============================================================
-- gear_items
-- ============================================================
drop policy if exists gear_items_owner_all on public.gear_items;
drop policy if exists gear_items_public_select_via_shared_list on public.gear_items;

<five policies>

-- ============================================================
-- lists
-- ============================================================
drop policy if exists lists_owner_all on public.lists;
drop policy if exists lists_public_select_shared on public.lists;

<five policies>

-- ============================================================
-- list_items
-- ============================================================
drop policy if exists list_items_owner_all on public.list_items;
drop policy if exists list_items_public_select_shared on public.list_items;

<five policies>
```

**Acceptance for C1:**

- The migration file exists at the path above with exactly these DROP+CREATE pairs and the policy bodies quoted in "Target state".
- Local syntax check via `supabase migration up` (or equivalent) succeeds.
- After application: `pg_policies` returns exactly the 22 policies named in "Target state" for the five tables (2 for profiles + 5 each for categories, gear_items, lists, list_items).
- No `auth.uid()` reference remains unwrapped — every occurrence is `(select auth.uid())`.
- Application happens via `supabase db push` (or your normal migration deploy path) — local agent can't run that. Mark as user-side step.

**Commit message for C1:**

```
fix(db): consolidate RLS policies into role-and-action-specific shape

Closes 26 Supabase advisor performance warnings:
- auth_rls_initplan (6): auth.uid() now wrapped in (select auth.uid())
  on every policy so the planner caches the value as an initPlan
  rather than re-evaluating per row.
- multiple_permissive_policies (~20): the previous *_owner_all (FOR ALL)
  + *_public_select_* (FOR SELECT) pair-per-table had no TO clause, so it
  applied through public and overlapped on SELECT across every role that
  inherits from public — anon, authenticated, and Supabase internals
  (authenticator, dashboard_user, supabase_privileged_role, …) — fanning
  out into ~5 warnings per table × 4 tables. Replaced with one policy
  per (role, action), each carrying explicit TO anon / TO authenticated:
  *_anon_select, *_auth_select (own OR public-shared), *_auth_insert,
  *_auth_update, *_auth_delete. Internal roles no longer match any
  policy on these tables and fall through to the default-deny.

profiles is the special case (no public-share path) — kept self-select
and self-update, role-scoped to authenticated, with the same
(select auth.uid()) wrapping.

Behavior preserved: signed-out anons can read public shared lists +
transitive rows; signed-in users can read their own rows OR public
shared rows (so /r/:slug for a friend's list works while logged in);
writes stay owner-only via WITH CHECK clauses on INSERT/UPDATE.

Public-share predicate bodies copied verbatim from migrations
20260425000002 (lists_public_select_shared, list_items_public_select_
shared) and 20260427000000 (categories/gear_items _public_select_via_
shared_list). Query-level owner scoping in fetchLists / fetchGear
Items / fetchCategories / fetchListItems is what keeps the OR'd
authenticated SELECT predicate from leaking shared rows into private
query results — see SECURITY.md "Defense-in-depth extras".
```

### C2 — Docs: refresh SECURITY.md to describe the new policy shape

**File:** `SECURITY.md`. Three edits.

**Edit 1 — Per-table policy table at SECURITY.md:33-39.** Currently lists `*_owner_all` policies and a single public-read policy per row. After Phase 21 the shape is different. Replace the table with:

```markdown
| Table | Authenticated SELECT policy | Authenticated write policies | Anon SELECT policy |
|---|---|---|---|
| `profiles` | `profiles_self_select` — `(select auth.uid()) = id` | `profiles_self_update` — same predicate, USING + WITH CHECK. (No INSERT path; the `handle_new_user` trigger creates profile rows.) | — |
| `categories` | `categories_auth_select` — `(select auth.uid()) = user_id OR <transitive shared-list EXISTS>` | `categories_auth_insert` / `categories_auth_update` / `categories_auth_delete`, all gated on `(select auth.uid()) = user_id` | `categories_anon_select` — transitive shared-list EXISTS only |
| `gear_items` | `gear_items_auth_select` — same OR shape, transitive predicate via `list_items → lists.is_shared` | `gear_items_auth_insert` / `gear_items_auth_update` / `gear_items_auth_delete`, owner-keyed | `gear_items_anon_select` — transitive via `list_items → lists.is_shared` |
| `lists` | `lists_auth_select` — `(select auth.uid()) = user_id OR is_shared = true` | `lists_auth_insert` / `lists_auth_update` / `lists_auth_delete`, owner-keyed | `lists_anon_select` — `is_shared = true` |
| `list_items` | `list_items_auth_select` — `(select auth.uid()) = user_id OR EXISTS (lists where is_shared = true)` (direct since `20260506000002` added `user_id`) | `list_items_auth_insert` / `list_items_auth_update` / `list_items_auth_delete`, owner-keyed | `list_items_anon_select` — same EXISTS predicate |
```

**Edit 2 — Rewrite the surrounding paragraph at SECURITY.md:31-32**, which currently reads:

> Owner policies are defined `FOR ALL` with both `USING` (read filter) and `WITH CHECK` (write filter); the `WITH CHECK` is what stops a user from updating one of their rows to belong to someone else.

Replace with:

> Owner-keyed tables carry one policy per (role, action) pair. Authenticated SELECT combines own-or-shared into a single permissive predicate (`(select auth.uid()) = user_id OR <public-share-predicate>`). Anon SELECT applies only the public-share predicate. Authenticated INSERT / UPDATE / DELETE are owner-only and gate on `(select auth.uid()) = user_id`; UPDATE additionally carries `WITH CHECK` against the same predicate so a user can't update one of their rows to belong to someone else. The `(select auth.uid())` form is a Supabase advisor recommendation — wrapping the function call in a subquery lets Postgres cache the value as an initPlan instead of re-evaluating it per row. The previous `*_owner_all` (FOR ALL) + `*_public_select_*` (FOR SELECT) pair-per-table shape was replaced in migration `20260512000000`.

**Edit 3 — "Adding a new table safely" section at SECURITY.md:165-193.** Currently prescribes the `*_owner_all` template. Replace the SQL templates with the role-and-action-specific shape:

```markdown
3. **Write policies** for SELECT/INSERT/UPDATE/DELETE. Use one policy per (role, action) pair. Two patterns:
   - **Owner-keyed (no public-share path):**
     ```sql
     create policy <name>_auth_select on <table>
       for select to authenticated
       using ((select auth.uid()) = user_id);

     create policy <name>_auth_insert on <table>
       for insert to authenticated
       with check ((select auth.uid()) = user_id);

     create policy <name>_auth_update on <table>
       for update to authenticated
       using ((select auth.uid()) = user_id)
       with check ((select auth.uid()) = user_id);

     create policy <name>_auth_delete on <table>
       for delete to authenticated
       using ((select auth.uid()) = user_id);
     ```
   - **Owner-keyed plus public-share read:**
     ```sql
     -- anon can read shared-reachable rows
     create policy <name>_anon_select on <table>
       for select to anon
       using (<public-share-predicate>);

     -- authenticated combines own + shared-reachable into one predicate
     create policy <name>_auth_select on <table>
       for select to authenticated
       using ((select auth.uid()) = user_id or <public-share-predicate>);

     -- writes unchanged from the owner-keyed pattern
     <auth_insert / auth_update / auth_delete as above>
     ```
4. **`WITH CHECK` is mandatory** on policies that govern INSERT or UPDATE.
5. **Always wrap `auth.uid()` in `(select auth.uid())`.** Direct calls trigger the Supabase `auth_rls_initplan` advisor warning and re-evaluate the function per row.
6. **Always pass `TO authenticated` or `TO anon`** explicitly, even for self-only tables. Without a TO clause the policy applies to every role and shows up in `multiple_permissive_policies` warnings on roles that don't actually need access.
```

(The numbered list continues with the existing items 7+.)

**Update the migration reference list at SECURITY.md:228+** to include `20260512000000_advisor_cleanup_rls_policies.sql` with the one-line description "Replaces *_owner_all + *_public_select_* with role-and-action-specific policies; advisor cleanup."

**Acceptance for C2:**

- The per-table policy table reflects the new shape.
- The `*_owner_all` term appears only in historical / explanatory context — Edit 2's paragraph naming the pre-Phase-21 shape that was replaced, the historical migration-reference list at the bottom of the doc, and any cross-references those introduce. It does **not** appear as the current recommended policy pattern (Edit 1's table and Edit 3's "Adding a new table safely" templates use the new role-and-action-specific shape).
- The "Adding a new table safely" section prescribes the new shape with `(select auth.uid())` and explicit `TO` clauses.
- The new migration is named in the migration-reference list at the bottom of the doc.
- `git diff SECURITY.md` shows only these intentional edits.

**Commit message for C2:**

```
docs(security): describe role-and-action-specific RLS policy shape

After 20260512000000 the *_owner_all (FOR ALL) + *_public_select_*
(FOR SELECT) pair-per-table is gone, replaced with one policy per
(role, action) pair. Updates the per-table policy summary table,
the surrounding paragraph, and the "Adding a new table safely"
templates so future tables follow the new shape and don't reintroduce
the auth_rls_initplan / multiple_permissive_policies advisor
warnings. Adds the new migration to the reference list.
```

### C3 — Ledger entry in REVIEW-FIX.md (small, post-campaign housekeeping)

**File:** `.planning/REVIEW-FIX.md`. Append a Phase 21 section.

The campaign deck is empty as of Phase 20; this isn't a review-artifact closure but it is in the same ledger style and worth recording for the same audit-trail reasons (commit refs, advisor delta, behavior-preservation reasoning). Keep it short — the substantive work is in C1 + C2.

Section content:

```markdown
---

# grampacker — Phase 21 fix summary (2026-05-06)

## Shipped

- **C1 — `<sha>`** — Migration `20260512000000_advisor_cleanup_rls_policies.sql`. Drops the per-table `*_owner_all` (FOR ALL) + `*_public_select_*` (FOR SELECT) pair on profiles / categories / gear_items / lists / list_items, replaces with role-and-action-specific policies. Every `auth.uid()` reference now wrapped in `(select auth.uid())` for initPlan caching. Authenticated SELECT combines own-or-shared into one permissive predicate (matches today's combined behavior); anon SELECT carries only the public-share predicate; INSERT/UPDATE/DELETE are owner-only on authenticated, gated on `(select auth.uid()) = user_id` with WITH CHECK on UPDATE.
- **C2 — `<sha>`** — `SECURITY.md` updated: per-table policy table, surrounding paragraph, and "Adding a new table safely" templates rewritten to describe the new shape. New migration added to the reference list. The term `*_owner_all` survives only in historical / explanatory context (the paragraph naming the pre-Phase-21 shape that was replaced, plus the migration-reference list); the current recommended pattern is the role-and-action-specific shape.

## Advisor delta

- `auth_rls_initplan` (6 warnings on profiles_self_select, profiles_self_update, categories_owner_all, gear_items_owner_all, lists_owner_all, list_items_owner_all) → 0.
- `multiple_permissive_policies` on SELECT for categories / gear_items / list_items / lists (~20 warnings, fanned across every role inheriting from public — anon, authenticated, and Supabase internals like `authenticator`, `dashboard_user`, `supabase_privileged_role` — because the old policies had no `TO` clause) → 0. Explicit `TO anon` / `TO authenticated` on every new policy collapses each (role, action) cell to one policy and leaves the internal roles with no matching policy on these tables.
- `auth_leaked_password_protection` left intentionally as-is — the auth setting is unenabled by product decision.

## Behavior preservation

Verified by manual smoke (see Phase 21 spec for full checklist):
- Signed-out `/r/:slug` works for shared lists.
- Signed-in user opening a non-owner's `/r/:slug` works.
- Signed-in user's own `/lists`, `/gear`, list-detail, settings still show only own rows (the database policy is permissive on owner-or-shared, but the query-level `user_id = auth.uid()` filters in fetchLists/fetchGearItems/fetchCategories/fetchListItems narrow the results — see SECURITY.md "Defense-in-depth extras → Query-level owner scoping").
- Create / update / delete / reorder still works for lists, list_items, gear_items, categories.

## Notes

This is post-campaign housekeeping rather than a review-artifact closure. The three review campaigns (`REVIEW-quality.md`, `REVIEW-security.md`, `REVIEW-performance.md`) closed at Phase 17 / 19 / 20 respectively. Recorded here in the same ledger for traceability of advisor-driven schema changes.
```

**Acceptance for C3:**

- Appended at the end of `REVIEW-FIX.md` (after Phase 20's section).
- Two `<sha>` placeholders filled in with the actual commit SHAs from C1 and C2.

**Commit message for C3:**

```
docs(review-fix): append Phase 21 advisor cleanup summary

Records the Phase 21 RLS policy reshape (commit <C1 sha>) and the
SECURITY.md update (commit <C2 sha>) in the project ledger for
audit traceability. Documents the advisor-warning delta (26 → 0)
and the manual smoke checklist that confirmed behavior preservation.
```

---

## Verification SQL (run after applying C1)

Two of these are advisor queries; the third is a direct `pg_policies` listing.

### V1 — `auth_rls_initplan` advisor check

The Supabase advisor doesn't expose its lints as a single SQL query in the `public` schema; the typical inspection path is the dashboard's "Database → Advisors" panel. After applying the migration, verify there: the six `auth_rls_initplan` warnings on `profiles_self_select`, `profiles_self_update`, `categories_owner_all`, `gear_items_owner_all`, `lists_owner_all`, `list_items_owner_all` should all be gone (the policies they cite no longer exist; the new policies use the wrapped form).

If you want a SQL-level proxy: search `pg_policies.qual` and `pg_policies.with_check` for any unwrapped `auth.uid()` reference on the rewritten tables.

```sql
-- Should return 0 rows. Any row indicates a policy still calls auth.uid()
-- directly. The grep is a substring-and-not-substring approximation; tune
-- if a future policy intentionally writes "(select auth.uid())" with
-- different whitespace.
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'categories', 'gear_items', 'lists', 'list_items')
  and (
    (qual like '%auth.uid()%' and qual not like '%(select auth.uid())%')
    or (with_check like '%auth.uid()%' and with_check not like '%(select auth.uid())%')
  );
```

### V2 — `multiple_permissive_policies` advisor check

Dashboard advisor should report 0 remaining warnings on these tables. SQL proxy:

```sql
-- For each (table, role, action) pair, count permissive policies. Any
-- count > 1 reproduces what the advisor flags. Expected: every row
-- returns count = 1 (or 0 for combinations with no policy, which the
-- query naturally omits since pg_policies only lists existing rows).
with role_unnest as (
  select schemaname, tablename, policyname, cmd, permissive,
         unnest(roles) as role
  from pg_policies
  where schemaname = 'public'
    and tablename in ('profiles', 'categories', 'gear_items', 'lists', 'list_items')
)
select tablename, role, cmd, count(*) as permissive_policy_count
from role_unnest
where permissive = 'PERMISSIVE'
group by tablename, role, cmd
having count(*) > 1
order by tablename, role, cmd;
-- Expected: 0 rows.
```

### V3 — List current policies

Sanity check that the new policy set is the one we intended.

```sql
select schemaname, tablename, policyname, permissive, roles, cmd,
       qual as using_expr,
       with_check as with_check_expr
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'categories', 'gear_items', 'lists', 'list_items')
order by tablename, policyname;
```

Expected row count: 22 (2 profiles + 5 each for categories, gear_items, lists, list_items). Each row's `roles` array should be exactly `{anon}` or `{authenticated}` (no `{public}` or empty arrays). Each `qual` containing `auth.uid` should contain `(select auth.uid())` literally.

---

## Manual smoke checklist (run after applying C1)

Each row matches a behavior-preservation bullet from the user's brief. Test in this order so failures fail loudly at the cheapest step.

- [ ] **Signed-out public share link.** Sign out → open `/r/<slug>` for a list whose owner has `is_shared = true`. List name, items, and category groupings render. (Hits `lists_anon_select`, `list_items_anon_select`, `gear_items_anon_select`, `categories_anon_select`.)
- [ ] **Signed-out non-shared link.** Open `/r/<slug>` for a list with `is_shared = false`. Page renders the not-found state, no list data leaks. (Confirms anon-select predicate gating.)
- [ ] **Signed-in owner of own data.** Sign in. Open `/lists`, `/gear`, an owned list-detail. Each shows only the signed-in user's rows. (Hits `*_auth_select` with `(select auth.uid()) = user_id` branch winning; query-level filters narrow.)
- [ ] **Signed-in non-owner public share link.** While signed in, open another user's `/r/<slug>`. Renders the shared list. (Confirms the `is_shared = true` branch of `*_auth_select` works for non-owners while signed in.)
- [ ] **Signed-in private write paths.** Sign in. Create a list, edit a gear item, reorder list items, delete a category, bulk-move items between categories, duplicate a list, create-list-from-selection. All succeed. (Hits `*_auth_insert` / `_auth_update` / `_auth_delete` plus the SECURITY DEFINER RPCs which bypass RLS.)
- [ ] **Signed-in cross-owner write attempt (negative).** Open DevTools → Network and craft a `PATCH /rest/v1/lists?id=eq.<other-users-list-id>` body. Expect 403 / no rows updated. Same for `DELETE`. (Confirms WITH CHECK + USING on auth_update / auth_delete.)
- [ ] **Hard refresh after a write.** CLAUDE.md flags this — optimistic UI hides server rejections. After each write category above, hard-refresh and confirm the database accepted.
- [ ] **Account deletion still works.** In settings, walk through the Delete-account flow. Cascade still removes profile + categories + gear_items + lists + list_items. (Cascades bypass RLS, so this is mostly a regression check that nothing else broke.)

If any step fails, stop — do not continue smoke. The migration is reversible by reverting to the prior policy bodies (the predicates are documented in this spec under "Current state").

---

## Out of scope

- **`auth_leaked_password_protection`** — intentionally unenabled per the user's brief. No action.
- **TO-clause additions to the SECURITY DEFINER functions.** They already revoke from `public, anon` and grant to `authenticated`. Unrelated to the policy advisors.
- **Composite-FK reshape.** The cross-owner enforcement via composite FKs (`20260506000002`) is unchanged.
- **F4 full path** (the `fetch_shared_list` RPC + four-policy reshape from `REVIEW-security.md`). That's a different threat-model-driven change; this phase is purely advisor cleanup.
- **`profiles_anon_select` policy.** No public-share path for profiles, so no anon policy is needed. Profiles stay anon-denied by lack of policy.

---

## Verification gates

After C1 (migration applied, locally if you have a Supabase local stack, or via `supabase db push` to the project):

- `npm run build` — pass (no source changes; sanity check).
- `npm run lint` — pass.
- `npm test --run` — full suite green; the bulk-reorder integration suite (4 currently-skipped tests) will exercise the new policies if you set `TEST_USER_EMAIL` + `TEST_USER_PASSWORD` and run `npm test --run src/lib/queries.bulk-reorder.test.ts`. Worth running once during smoke to confirm the new INSERT/UPDATE policies don't break the RPC's owner check.
- V1, V2, V3 SQL queries return as described.
- Manual smoke checklist green.

After C2:

- `git diff SECURITY.md` shows only the three intentional edits.
- `grep -n "owner_all" SECURITY.md` matches only historical / explanatory context: Edit 2's paragraph naming the pre-Phase-21 shape that was replaced and the migration-reference list at the bottom. None of the matches sit in the current-recommended-pattern surfaces (Edit 1's per-table table or Edit 3's "Adding a new table safely" templates).

After C3:

- Phase 21 section appended to `.planning/REVIEW-FIX.md`. C1 and C2 SHAs filled in.

---

## Risk register

- **Risk:** the OR'd `_auth_select` predicate accidentally widens what authenticated callers see vs. today. Mitigation: today's behavior is already "own + every public-shared row" because `*_public_select_*` policies have no TO clause, so they apply to authenticated too. The new combined predicate is the OR of those two, evaluated against the same data. Identical behavior. The behavior-preservation matrix in this spec lists every scenario explicitly.
- **Risk:** the transitive EXISTS predicates trigger RLS recursion (the lesson from `20260506000000`/`00001`). Mitigation: the transitive predicates here only USE other tables in `EXISTS` subqueries, not `WITH CHECK` subqueries — the `20260506000000` recursion was specifically about a WITH CHECK subquery against another RLS table during INSERT. The current `*_public_select_*` predicates have been working in production unchanged for weeks; the new `_auth_select` is the same EXISTS shape OR'd with a non-recursive own-row check, which is cheaper for the planner, not riskier.
- **Risk:** dropping `lists_owner_all` etc. with the migration partially applied leaves a window where private rows are unprotected. Mitigation: Postgres applies migration files inside a transaction by default. DROP + CREATE in the same transaction means there's no intermediate-state visible to other sessions. (Verify your migration tool runs in a transaction; Supabase's CLI does.)
- **Risk:** `pg_policies` advisor SQL proxy in V1/V2 differs from what the dashboard reports. Mitigation: V1/V2 SQL is a sanity proxy only — the dashboard advisor is the source of truth. Post-migration, refresh the dashboard's advisor view; both warning families should hit zero on the named tables.
- **Risk:** I miss a policy on a table that's already in scope. Mitigation: `pg_policies` query in V3 is the post-application catalog; if any unexpected policy survives, it appears as an extra row. The expected count is 22.
- **Risk:** the new policies prevent `add_gear_item_with_list_item` / `create_list_from_selection` / `duplicate_list` from working. Mitigation: those run as SECURITY DEFINER and bypass RLS entirely. Their inline `auth.uid()` ownership checks are unchanged; behavior is identical pre/post.
- **Risk:** `delete_account()` cascade is affected. Mitigation: cascades run as the constraint owner and bypass RLS. Unaffected.
- **Risk:** `bulk_update_sort_order` UPDATE path stops working because the new `*_auth_update` policy fires. Mitigation: the RPC is SECURITY DEFINER; RLS is bypassed inside it. The function's inline ownership check (`user_id = auth.uid()`) is the actual gate. No change.

---

## Pre-execution checklist

- [ ] User has approved this spec.
- [ ] Codex review of this spec is complete and any findings have been patched into this file.
- [ ] No staged or unstaged changes outside this file.
- [ ] Working from `main` with the recent push verified, OR confirmed the migration sequence is locally consistent.
- [ ] User has access to the Supabase advisor dashboard to confirm the post-migration warning-count delta.

---

## Notes for the executor

- The migration touches authorization. Treat it like a security commit: read each `CREATE POLICY` body twice against the predicates quoted in "Current state" before applying.
- The `(select auth.uid())` form is whitespace-sensitive in the advisor's grep — keep the literal form `(select auth.uid())` consistently across every policy.
- DROP order doesn't strictly matter (policies don't depend on each other), but doing all the DROPs first followed by all the CREATEs makes the diff easier to read.
- If applying via `supabase db push`, you may need to run `supabase db pull` first to confirm local state matches remote — the local Supabase stack may have drifted from the deployed schema during the campaign.
