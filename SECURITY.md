# Security model

This document describes how authorisation works in grampacker, where the security boundary lives, and how to extend it safely. Audience: any engineer (human or AI) opening the codebase for the first time. The goal is that you finish this doc in ten minutes knowing what enforces what, and what to do — and not do — when adding a new table or function.

For the *why* behind specific decisions, this doc cross-references `DECISIONS.md` (ADRs) and the migration files rather than duplicating their content.

---

## Architecture

grampacker is a Backend-as-a-Service app. The browser talks directly to **PostgREST** (Supabase's auto-generated REST layer), which talks to **Postgres**. There is no backend application server in between.

```
browser → PostgREST → Postgres
```

The implication is load-bearing: **the database is the security boundary**. Every authorisation decision — who can read which row, who can write it, who can call which function — is enforced inside Postgres. If a policy is wrong, no upstream component will catch the mistake; the auto-generated REST endpoints will dutifully serve whatever the database is willing to return.

This is also what makes the model auditable: there is one place to look (the migrations) for the entire authorisation story.

---

## Authorisation lives in Row Level Security

Every table in the `public` schema has **Row Level Security** enabled. RLS is a Postgres feature that filters every query (SELECT/INSERT/UPDATE/DELETE) through a per-table policy expressed as a SQL predicate. Without a matching policy, queries return zero rows and writes are rejected.

Two policy shapes appear in this codebase:

- **Owner-keyed:** `auth.uid() = user_id`. The row carries the owner's id directly. Used on `profiles`, `categories`, `gear_items`, `lists`.
- **Joined-via-parent:** `EXISTS (SELECT 1 FROM <parent> WHERE <parent>.id = <child>.<fk> AND <parent>.user_id = auth.uid())`. The row's owner is reachable through a foreign key. Used on `list_items` (joins `lists`).

Owner policies are defined `FOR ALL` with both `USING` (read filter) and `WITH CHECK` (write filter); the `WITH CHECK` is what stops a user from updating one of their rows to belong to someone else.

| Table | Owner policy | Public-read policy |
|---|---|---|
| `profiles` | `auth.uid() = id` (self-select / self-update only — no insert by user; the `handle_new_user` trigger does that) | — |
| `categories` | `auth.uid() = user_id` (`categories_owner_all`) | `categories_public_select_via_shared_list` (transitive: only when a shared list references one of this category's gear items) |
| `gear_items` | `auth.uid() = user_id` (`gear_items_owner_all`) | `gear_items_public_select_via_shared_list` (transitive: only when a shared list references this gear item) |
| `lists` | `auth.uid() = user_id` (`lists_owner_all`) | `lists_public_select_shared` (`is_shared = true`) |
| `list_items` | join through `lists` (`list_items_owner_all`) | `list_items_public_select_shared` (join, `is_shared = true`) |

A defense-in-depth net guards against forgetting RLS on a new table. The `rls_auto_enable` event trigger (migration `20260429000000`) fires on every `CREATE TABLE` in `public` and runs `alter table … enable row level security` automatically. **This does not write the policies for you** — an RLS-enabled table without policies fails closed: nobody (including the owner) can read or write. Defense-in-depth, not autopilot.

For the precise SQL, see migrations `20260425000000`, `20260425000001`, `20260425000002`, and `20260427000000`.

---

## Roles

PostgREST authenticates incoming requests against one of three Postgres roles:

- **`anon`** — unauthenticated. Used by the public share view (`/r/:token`). Reads only via the `*_public_select_via_shared_list` and `*_public_select_shared` policies. Has no write capability anywhere.
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

**Trust model:** the `slug` is a short, unguessable, public URL handle — anyone with the URL can read the list while `is_shared = true`. We don't authenticate share-view requests (the slug IS the access mechanism), but we deliberately don't call it a credential because it isn't user-issued or password-like; it's a URL identifier in the same shape as a YouTube video ID or a Reddit post ID. Toggling `is_shared` off disables access without changing the slug; to break a leaked link, the user duplicates the list (which gets a fresh slug) and stops sharing the original. Public anon receives a 404 for both unknown slugs and inactive shared lists, deliberately indistinguishable to prevent enumeration. See `SPEC.md` "Sharing mechanics" for the user-facing behavior.

---

## SECURITY DEFINER functions

`SECURITY DEFINER` makes a Postgres function execute with the privileges of its owner (effectively a superuser, in Supabase's setup) instead of the calling user. This **bypasses RLS** for the duration of the function. We use it sparingly — four functions total — and every one of them is structured to preserve the security boundary despite the bypass.

### Why we use it

PostgREST's auto-generated upsert path (`INSERT … ON CONFLICT DO UPDATE`) evaluates the INSERT-side RLS `WITH CHECK`, NOT NULL, and FK constraints against the proposed row **before** resolving the conflict — so partial-column payloads (e.g. `[{id, sort_order}]` for a bulk reorder) fail repeatedly on whichever required column catches the missing value first. A `SECURITY DEFINER` function that issues a plain `UPDATE` sidesteps the entire INSERT path. See `DECISIONS.md` ADR 3 for the full debugging story.

### Compensating-control checklist

Every `SECURITY DEFINER` function we own MUST have all four of:

1. **`search_path` pinned** — `set search_path = public, pg_temp` (or similar). Prevents schema-shadowing attacks where a malicious temp-schema object intercepts unqualified references inside the function.
2. **`EXECUTE` revoked from `public` and `anon`**, granted to `authenticated` only (or revoked entirely for trigger-only functions).
3. **Inline ownership check** in the function body. Because RLS is bypassed, the function itself must re-assert that the caller owns the row(s) it's touching. The check is what preserves the security boundary; the `SECURITY DEFINER` flag is purely a PostgREST workaround, not a privilege grant. Forgetting this turns the function into an authorisation oracle.
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

1. **Decide whether you actually need DEFINER.** Default to `SECURITY INVOKER` (the default if you don't specify) — RLS handles the authorisation. `DEFINER` is for the narrow case where the auto-generated PostgREST path can't express what you need (the bulk-partial-column case is the canonical example).
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
| New public read path | Add a `*_public_select_*` policy. Document the trust assumption (what gates it — share token, `is_shared` flag, public-by-design data, etc.). |
| Collaboration / multi-owner | Owner-keyed policies broaden to membership-keyed (e.g. `EXISTS (SELECT 1 FROM list_members WHERE list_id = … AND user_id = auth.uid())`). Every table that participates in collaboration needs a new policy shape; this is a real review, not a checklist item. |
| Admin role | Define a Postgres role, write admin-specific policies. Prefer narrow `for select to admin using (<predicate>)` over `for all using (true)` — least privilege still applies. |
| New SECURITY DEFINER function | Full review per the section above. Inline ownership check is non-negotiable. |
| Removing a public read path | Drop the corresponding `*_public_select_*` policy. Existing share links go silently 404 — same as toggling `is_shared` off. |

---

## Reference

**Migrations** (all in `supabase/migrations/`):
- `20260425000000_initial_schema.sql` — `profiles`, `set_updated_at`, `handle_new_user`, RLS on profiles.
- `20260425000001_categories_and_gear.sql` — `categories`, `gear_items`, owner-keyed RLS, count cap.
- `20260425000002_lists_and_list_items.sql` — `lists`, `list_items`, owner-keyed RLS, shared-list RLS (gated on `is_shared`), joined-via-parent RLS, count caps.
- `20260426000000_delete_account_rpc.sql` — `delete_account()`.
- `20260427000000_public_select_via_shared_list.sql` — transitive read for the share view.
- `20260427000001_cascade_gear_item_deletion.sql` — referential cleanup (NOT NULL + CASCADE on `list_items.gear_item_id`).
- `20260429000000_function_hardening.sql` — `search_path` pinning, `handle_new_user` lockdown, `rls_auto_enable` backfill.
- `20260430000000_bulk_reorder_rpc.sql` + `20260501000000_bulk_reorder_rpc_ownership_check.sql` + `20260502000000_add_gear_items_to_bulk_reorder.sql` + `20260503000000_add_lists_to_bulk_reorder.sql` — `bulk_update_sort_order` RPC, ownership check, table whitelist extensions.

**ADRs** (in `DECISIONS.md`):
- ADR 3 — Bulk DB operations through Postgres RPCs (rationale + accepted linter warning).
- ADR 8 — Per-list opt-in sharing.

**Behavior reference** (in `SPEC.md`):
- "Row-level security" — short summary of the two policy shapes and the RPC pointer.
- "Sharing mechanics" — share token + RLS user-facing behavior.

**Codebase conventions** (in `CLAUDE.md`):
- "Database patterns" — when to use the RPC vs. single-row PATCH; the upsert trap.
