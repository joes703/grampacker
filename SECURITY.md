# Security model

This document describes how authorization works in grampacker, where the security boundary lives, and how to extend it safely. Audience: any engineer (human or AI) opening the codebase for the first time. The goal is that you finish this doc in ten minutes knowing what enforces what, and what to do (and not do) when adding a new table or function.

For the *why* behind specific decisions, this doc cross-references `DECISIONS.md` (ADRs) and the migration files rather than duplicating their content.

---

## Architecture

grampacker is a Backend-as-a-Service app. The browser talks directly to **PostgREST** (Supabase's auto-generated REST layer), which talks to **Postgres**. There is no backend application server in between.

```
browser → PostgREST → Postgres
```

The implication is load-bearing: **the database is the security boundary**. Every authorization decision (who can read which row, who can write it, who can call which function) is enforced inside Postgres. If a policy is wrong, no upstream component will catch the mistake; the auto-generated REST endpoints will dutifully serve whatever the database is willing to return.

This is also what makes the model auditable: there is one place to look (the migrations) for the entire authorization story.

---

## Authorization lives in Row Level Security

Every table in the `public` schema has **Row Level Security** enabled. RLS is a Postgres feature that filters every query (SELECT/INSERT/UPDATE/DELETE) through a per-table policy expressed as a SQL predicate. Without a matching policy, queries return zero rows and writes are rejected.

Every user-owned table currently uses the **owner-keyed** pattern: `(select auth.uid()) = user_id`. The row carries the owner's id directly. Used on `profiles`, `categories`, `gear_items`, `lists`, and `list_items` (the latter gained a direct `user_id` column in migration `20260506000002`, replacing its previous joined-via-parent policy).

A second pattern, **joined-via-parent** (`EXISTS (SELECT 1 FROM <parent> WHERE <parent>.id = <child>.<fk> AND <parent>.user_id = (select auth.uid()))`), is the option for future child tables that don't carry their own `user_id`. Not currently used by any table after the `list_items` migration. The template lives in "Adding a new table safely" below.

Owner-keyed tables carry one policy per (role, action) pair. Authenticated SELECT combines own-or-shared into a single permissive predicate (`(select auth.uid()) = user_id OR <public-share-predicate>`). Anon SELECT applies only the public-share predicate. Authenticated INSERT / UPDATE / DELETE are owner-only and gate on `(select auth.uid()) = user_id`; UPDATE additionally carries `WITH CHECK` against the same predicate so a user can't update one of their rows to belong to someone else. The `(select auth.uid())` form is a Supabase advisor recommendation: wrapping the function call in a subquery lets Postgres cache the value as an initPlan instead of re-evaluating it per row. The previous `*_owner_all` (FOR ALL) + `*_public_select_*` (FOR SELECT) pair-per-table shape was replaced in migration `20260512000000`.

| Table | Authenticated SELECT policy | Authenticated write policies | Anon SELECT policy |
|---|---|---|---|
| `profiles` | `profiles_self_select`: `(select auth.uid()) = id` | `profiles_self_update`: same predicate, USING + WITH CHECK. (No INSERT path; the `handle_new_user` trigger creates profile rows.) | — |
| `categories` | `categories_auth_select`: `(select auth.uid()) = user_id OR <transitive shared-list EXISTS>` | `categories_auth_insert` / `categories_auth_update` / `categories_auth_delete`, all gated on `(select auth.uid()) = user_id` | `categories_anon_select`: transitive shared-list EXISTS only |
| `gear_items` | `gear_items_auth_select`: same OR shape, transitive predicate via `list_items → lists.is_shared` | `gear_items_auth_insert` / `gear_items_auth_update` / `gear_items_auth_delete`, owner-keyed | `gear_items_anon_select`: transitive via `list_items → lists.is_shared` |
| `lists` | `lists_auth_select`: `(select auth.uid()) = user_id OR is_shared = true` | `lists_auth_insert` / `lists_auth_update` / `lists_auth_delete`, owner-keyed | `lists_anon_select`: `is_shared = true` |
| `list_items` | `list_items_auth_select`: `(select auth.uid()) = user_id OR EXISTS (lists where is_shared = true)` (direct since `20260506000002` added `user_id`) | `list_items_auth_insert` / `list_items_auth_update` / `list_items_auth_delete`, owner-keyed | `list_items_anon_select`: same EXISTS predicate |

A defense-in-depth net guards against forgetting RLS on a new table. The `rls_auto_enable` event trigger (migration `20260429000000`) fires on every `CREATE TABLE` in `public` and runs `alter table … enable row level security` automatically. **This does not write the policies for you.** An RLS-enabled table without policies fails closed: nobody (including the owner) can read or write. Defense-in-depth, not autopilot.

For the precise SQL of the current shape, see migration `20260512000000_advisor_cleanup_rls_policies.sql`. For the historical owner_all / public_select_* shape that preceded it, see migrations `20260425000000`, `20260425000001`, `20260425000002`, and `20260427000000`.

### Cross-owner FK enforcement

Owner-keyed RLS validates that a user can write a given *row*, but doesn't by itself check that the rows it *references* share the same owner. An authenticated attacker with leaked ids could otherwise craft inserts threading cross-owner FK references, corrupting the data model without exposing any other user's data. Three foreign keys in this codebase are now locked down via composite foreign keys, all anchored on `user_id`:

- **`gear_items.category_id → categories.id`**: composite FK `(category_id, user_id) → (id, user_id)`. Uses the PG 15+ column-list form `ON DELETE SET NULL (category_id)` so only `category_id` is nulled when the parent category is deleted; `user_id` stays intact (it's NOT NULL on `gear_items`, and the bare `ON DELETE SET NULL` would null all FK columns and fail). Future composite FKs with SET NULL semantics need this same column-list form whenever any other FK column is NOT NULL on the child.
- **`list_items.list_id → lists.id`**: composite FK `(list_id, user_id) → (id, user_id)`. ON DELETE CASCADE preserved.
- **`list_items.gear_item_id → gear_items.id`**: composite FK `(gear_item_id, user_id) → (id, user_id)`. ON DELETE CASCADE preserved.

Each composite FK requires a `UNIQUE(id, user_id)` on its parent table. Postgres requires the FK target to match a UNIQUE/PK on the exact column tuple referenced; the PK on `id` alone isn't sufficient.

`list_items` previously had no `user_id` column; ownership traced through `list_items.list_id → lists.user_id`. Migration `20260506000002` adds `list_items.user_id` (NOT NULL, backfilled from the parent list's `user_id`) and replaces the `list_items_owner_all` RLS policy's `EXISTS (SELECT 1 FROM lists ...)` with a direct `auth.uid() = user_id` check. The composite FK on `(list_id, user_id) → lists(id, user_id)` enforces that `list_items.user_id` always equals the parent list's `user_id`, so the simplified policy is equivalent to the prior subquery-based one.

**Migration history.** A first attempt at this lockdown (migration `20260506000000`) used an RLS WITH CHECK subquery on `gear_items` to enforce same-owner references on `list_items.gear_item_id`. That triggered policy recursion (Postgres error 42P17): the subquery against `gear_items` invoked `gear_items`' own RLS policy, looping. Symptom: every `list_items` insert from the app failed silently. Reverted in `20260506000001`. The retry (`20260506000002`) uses composite FKs throughout instead, since they're declarative database constraints that don't trigger RLS evaluation. Schema change > policy gymnastics when the goal is same-owner enforcement on a child table.

When adding a new FK from one user-owned table to another:
- Both tables must have `user_id` directly. If the child doesn't, add it and backfill before the FK.
- Add `UNIQUE(id, user_id)` on the parent if not already present.
- Use `FOREIGN KEY (child_fk_col, user_id) REFERENCES parent (id, user_id)`.
- Avoid WITH CHECK subqueries that reference another RLS-protected table when same-owner enforcement is the goal. The cross-policy evaluation can recurse, particularly when both policies use `auth.uid()`. Composite FKs (when both tables have `user_id`) or BEFORE-INSERT triggers move enforcement to the schema/trigger layer where recursion isn't a concern.

---

## Roles

PostgREST authenticates incoming requests against one of three Postgres roles:

- **`anon`**: unauthenticated. Used by the public share view (`/r/:slug`). Reads only via the per-table `*_anon_select` policies (`lists_anon_select`, `list_items_anon_select`, `gear_items_anon_select`, `categories_anon_select`), each carrying only the public-share predicate. Has no write capability anywhere.
- **`authenticated`**: signed-in users. Reads / writes via the owner policies. Has `EXECUTE` on the five user-callable RPCs we expose: `delete_account`, `bulk_update_sort_order`, `add_gear_item_with_list_item`, `create_list_from_selection`, `duplicate_list`. Of these, only `delete_account` is `SECURITY DEFINER`; the other four are `SECURITY INVOKER` (converted in `20260514202025`). The two trigger-only definers, `handle_new_user` and `rls_auto_enable`, have EXECUTE revoked from all roles; triggers fire regardless of EXECUTE privileges.
- **`public`** (Postgres pseudo-role): every grant defaults to this unless explicitly revoked. We **explicitly revoke `EXECUTE` from `public`** on every SECURITY DEFINER function we own, so a misconfigured grant elsewhere can't accidentally expose them.

There is no admin role today. The owner of every row is the user; there is no separate operator path.

---

## Public read paths (sharing)

Sharing is per-list and opt-in (see `DECISIONS.md` ADR 8 for the rationale). Each list has a 6-character `slug` generated at creation, and an `is_shared` boolean (default false). Public read access is granted to **`anon`** through four policies:

- `lists_anon_select`: `using (is_shared = true)`.
- `list_items_anon_select`: joins `lists` and checks `is_shared = true`.
- `gear_items_anon_select`: transitive; any gear item referenced by a `list_items` row in a shared list is readable.
- `categories_anon_select`: transitive; any category whose gear items are referenced by a shared list is readable.

**Trust model:** the `slug` is a short, unguessable, public URL handle. Anyone with the URL can read the list while `is_shared = true`. We don't authenticate share-view requests (the slug IS the access mechanism), but we deliberately don't call it a credential because it isn't user-issued or password-like; it's a URL identifier in the same shape as a YouTube video ID or a Reddit post ID. Toggling `is_shared` off disables access without changing the slug; to break a leaked link, the user duplicates the list (which gets a fresh slug) and stops sharing the original. Slugs are 6 base62 characters (~57 billion combinations), so random guessing is impractical, but the `lists_anon_select` policy doesn't restrict by slug, so an anon caller could enumerate currently-shared lists via PostgREST's generic query interface (e.g. `?is_shared=eq.true&select=slug`). We accept this: a shared list is by definition opt-in public-readable, and any user who doesn't want their list enumerable from the public surface leaves `is_shared` off. Unknown-slug requests at `/r/<slug>` 404 because of the route handler's not-found check, not because of any enumeration-defense logic in the policy layer. See `SPEC.md` "Sharing mechanics" for the user-facing behavior.

**Public read column allowlist.** Even though RLS gates which *rows* the public can see, the queries themselves use explicit column lists rather than `select('*')` so the wire response never contains owner-only metadata. The allowlist by table:

- **`lists`** (via `fetchSharedList`): `id`, `name`, `description`, `group_worn`, `is_draft`. Excluded: `user_id`, `slug` (the viewer already has it via the URL), `is_shared` (always true given RLS gating), `sort_order` (per-user list ordering, irrelevant to viewer), `ready_checks_enabled`, `created_at`, `updated_at`. `group_worn` and `is_draft` are deliberately public: the share view honors group-worn grouping and shows the draft banner.
- **`list_items`** (via `fetchSharedListItems`): `id`, `gear_item_id`, `quantity`, `is_worn`, `is_consumable`, `sort_order`. Excluded: `list_id` (viewer already has the parent list's id), `is_packed` (owner's packing state, personal workflow data), `is_ready`, `user_id`, `created_at`, `updated_at`.
- **`gear_items`** (via the `list_items` join): `id`, `name`, `description`, `weight_grams`, `category_id`. Excluded: `user_id`, `sort_order`, `cost`, `purchase_date`, `status`, `created_at`, `updated_at`.
- **`categories`** (via `fetchSharedListCategories`): `id`, `name`, `sort_order`. Excluded: `user_id`, `is_default`, `created_at`.

The `Public*` types in `src/lib/types.ts` (PublicList, PublicListItem, PublicGearItem, PublicCategory) make the wire shape explicit at the type level. SharePage maps these narrow types to the full types at one boundary point so the shared rendering components (CategoryGroup, WeightTable, ItemRow) can keep their unified type signatures across authed and share-view contexts.

---

## SECURITY DEFINER functions

`SECURITY DEFINER` makes a Postgres function execute with the privileges of its owner (effectively a superuser, in Supabase's setup) instead of the calling user. This **bypasses RLS** for the duration of the function. We use it sparingly: three functions total, and every one is structured to preserve the security boundary despite the bypass.

### Why we use it

`SECURITY DEFINER` is reserved for the three functions that act on objects the calling role provably cannot touch:

- **`delete_account()`** issues `DELETE FROM auth.users`; the `authenticated` role has no DELETE privilege there.
- **`handle_new_user()`** inserts into `public.profiles` from a trigger that fires as `supabase_auth_admin`, which has neither an INSERT grant nor an INSERT RLS policy on that table.
- **`rls_auto_enable()`** runs `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, which requires table ownership.

Four functions that were previously `SECURITY DEFINER` for historical reasons (`bulk_update_sort_order`, `add_gear_item_with_list_item`, `create_list_from_selection`, `duplicate_list`) were converted to `SECURITY INVOKER` in `20260514202025` once RLS policies plus the composite FKs (`20260506000002`) were confirmed to enforce the same ownership their inline checks do. See `DECISIONS.md` ADR 3 for the bulk-reorder case and the full debugging story behind the original RPC decision.

### Compensating-control checklist

Every `SECURITY DEFINER` function we own MUST have all of:

1. **`search_path = ''`**: every referenced object fully schema-qualified inside the body. Prevents schema-shadowing attacks where a malicious temp-schema object intercepts unqualified references. (`rls_auto_enable` is the one exception: it stays pinned to the unshadowable `pg_catalog`; see the inventory note.)
2. **`EXECUTE` revoked from `public` and `anon`**, granted to `authenticated` only (or revoked entirely for trigger-only functions).
3. **Inline ownership check** in the function body, *for user-callable definers*. Because RLS is bypassed, the function must re-assert that the caller owns the row(s) it's touching. Of the three remaining definers only `delete_account` is user-callable, and its check is `auth.uid()` scoping the `DELETE` to the caller's own row. Trigger-only definers (`handle_new_user`, `rls_auto_enable`) have no caller-supplied ids to check.
4. **Trust assumption documented** in a header comment so a future reviewer can audit the model without re-deriving it.

### Inventory

All three remaining `SECURITY DEFINER` functions:

| Function | Purpose | EXECUTE | Inline check | Migration |
|---|---|---|---|---|
| `handle_new_user()` | Trigger on `auth.users` insert; creates the `profiles` row. Needs DEFINER: fires as `supabase_auth_admin`, which has no INSERT grant or INSERT RLS policy on `public.profiles`. | Revoked from all (trigger fires regardless of EXECUTE privileges). | N/A: runs in trigger context with the new user's id from `NEW`. | `20260425000000`, hardened in `20260429000000`, `search_path` tightened to `''` in `20260514202025` |
| `delete_account()` | User-callable RPC; deletes the `auth.users` row for `auth.uid()`. ON DELETE CASCADE wipes all owned data. Needs DEFINER: `authenticated` has no DELETE on `auth.users`. | `authenticated` only. | `if auth.uid() is null then raise exception 'not authenticated'` then `delete from auth.users where id = auth.uid()`; the `where` clause scopes the delete to the caller's own row. | `20260426000000`, `search_path` tightened to `''` in `20260514202025` |
| `rls_auto_enable()` | Event trigger on `CREATE TABLE` in `public`; auto-enables RLS. Needs DEFINER: `ALTER TABLE … ENABLE RLS` requires table ownership. | Revoked from all (event trigger fires regardless). | N/A: defense-in-depth net, not user-callable. | `20260429000000` |

`rls_auto_enable` keeps `set search_path = 'pg_catalog'` rather than `''`: its body depends on `pg_event_trigger_ddl_commands()` and `format()`, `pg_catalog` cannot be shadowed, and re-testing an event trigger to tighten it further is high-risk and low-value. `20260514202025` left it untouched on purpose.

Four formerly-DEFINER RPCs (`bulk_update_sort_order`, `add_gear_item_with_list_item`, `create_list_from_selection`, `duplicate_list`) were converted to `SECURITY INVOKER` in `20260514202025`. They remain `EXECUTE`-granted to `authenticated` only, run with `search_path = ''`, and keep their inline `auth.uid()` ownership checks (now defense-in-depth on top of RLS, and preserving the exact `42501` / `P0002` error contracts). Under INVOKER their writes are gated by the `*_auth_*` RLS policies plus the composite FKs from `20260506000002`, which enforce the same ownership the inline checks do.

---

## SECURITY DEFINER linter warning

Supabase's database linter raises `authenticated_security_definer_function_executable` on every SECURITY DEFINER function granted to `authenticated`. The linter is generic and flags the *class* of risk; it doesn't know whether the function is constrained.

After the `20260514202025` audit, the only function this applies to is **`delete_account()`**. It must stay `SECURITY DEFINER` (the `authenticated` role has no DELETE on `auth.users`) and must stay `EXECUTE`-granted to `authenticated` (it's user-callable from Settings), so the warning is **accepted deliberately for `delete_account()` alone**. Its safety comes from its constraints: `search_path = ''`, `EXECUTE` revoked from `public`/`anon`, the `auth.uid() is null` guard, and the `where id = auth.uid()` clause that scopes the delete to the caller's own auth row.

The four RPCs this section previously covered (`bulk_update_sort_order`, `add_gear_item_with_list_item`, `create_list_from_selection`, `duplicate_list`) were converted to `SECURITY INVOKER` in `20260514202025`, which **resolves** the warning for them rather than accepting it. When the linter raises this warning on a new function, default to converting to `INVOKER`; accept only when the function genuinely needs owner privileges the caller lacks, and document why alongside `DECISIONS.md` ADR 3's pattern. Don't silently leave it.

---

## Defense-in-depth extras

These don't carry the primary security load (RLS does), but they catch mistakes that would otherwise be silent.

- **`search_path` pinning** on every public function (migration `20260429000000`; tightened to `search_path = ''` with fully-qualified bodies for the DEFINER functions and the four converted RPCs in `20260514202025`). Prevents schema-shadowing.
- **`rls_auto_enable` event trigger.** Already covered above. Stops a forgotten `enable row level security` from silently exposing a new table.
- **`ON DELETE CASCADE` chains.** `auth.users` → `profiles` → `categories` / `gear_items` / `lists`; `gear_items` → `list_items`; `lists` → `list_items`. The cascade is what makes account deletion comprehensive: `delete_account()` performs cleanup by removing the `auth.users` row, and the cascade does the rest. (`delete_account()` itself is a SECURITY DEFINER RPC whose only auth check is `auth.uid() is null`. See "Accepted residual risks" for what that does and does not gate against.)
- **Per-user resource caps via `BEFORE INSERT` triggers:** 100 lists per user, 500 gear items per user, 300 list items per list. Stops a runaway client from filling the database. Each cap is enforced both client-side (for friendly errors) and database-side (the source of truth).
- **In-app password change requires current-password re-authentication.** The change-password form in Settings calls `supabase.auth.signInWithPassword({ email, password: currentPassword })` before `supabase.auth.updateUser({ password: newPassword })`. An attacker with a leaked session token can't change the password without also knowing the current one. The verification call surfaces a generic "Current password is incorrect" rather than Supabase's verbatim error so rate-limit / account-state details don't leak. Supabase Auth's own throttling on `signInWithPassword` covers brute-force attempts.
- **Forgot-password recovery uses email-link verification.** The signed-out flow at `/forgot-password` calls `supabase.auth.resetPasswordForEmail` with a redirect to `/reset-password`. The recovery token in the email link IS the auth proof, equivalent in role to the current-password requirement on the in-app change flow. After a successful PKCE code exchange via `exchangeCodeForSession`, the page calls `updateUser({ password })`. Anti-enumeration: the request page shows the same success message regardless of whether the email exists. The redirect URL must be allowlisted in the Supabase dashboard's Auth → URL Configuration. **Recovery-only**: `/reset-password` requires the recovery code as proof; a normal authenticated session without the code is NOT sufficient. Signed-in users navigating directly to `/reset-password` without a `?code=` param redirect to `/settings` (where the in-app change-password flow's current-password challenge applies). Without this guard, a signed-in user could bypass the current-password proof.
- **Query-level owner scoping.** Every private query helper (`fetchLists`, `fetchGearItems`, `fetchCategories`, `fetchListItems`) explicitly filters by `user_id = <auth uid>` even though RLS would gate ownership anyway. The redundant filter prevents cross-user data from being returned through normal `select('*')` queries because the authenticated SELECT policy is itself permissive about sharing: each `*_auth_select` policy is `(select auth.uid()) = user_id OR <public-share-predicate>`, so it matches the caller's own rows PLUS every row with `is_shared = true` (including other users'). The dedicated `*_anon_select` policies are scoped `TO anon` and don't affect authenticated reads; the leak channel into authenticated queries is the `OR <share-predicate>` inside `*_auth_select` itself. Without the query-level filter, a signed-in user's `select('*')` on `lists` would return their own lists PLUS every other user's shared lists. The `fetchAllUserListItems` helper (Settings → Download all data) has carried this pattern from day one with its `.eq('list.user_id', userId)` join filter; this rule generalizes that approach to all private helpers. Public read paths use dedicated helpers (`fetchSharedList`, `fetchSharedListItems`, `fetchSharedListCategories`) that don't filter by `user_id`; they intentionally rely on the public RLS policy. New private query helpers must filter by `user_id`; new public helpers must not. The `OR <public-share-predicate>` inside each `*_auth_select` policy is intentional: a signed-in user opening a friend's share link at `/r/<slug>` should still see the list, which requires the authenticated SELECT policy to match shared rows the caller doesn't own. The query-level owner scoping is what keeps that channel from leaking into private query results.

---

## Accepted residual risks

These are threats with no in-app mitigation today. Each is documented so a future reviewer can see what's been considered vs. what's been overlooked. If the threat model changes, the linked work moves into scope.

### Auth tokens in `localStorage`

The Supabase JS client uses `window.localStorage` for the JWT and refresh token by default (`src/lib/supabase.ts` calls `createClient` with no storage override). Any successful XSS in the authenticated app exfiltrates both tokens, granting the attacker the user's session for as long as the access token is valid (capped by the access-token TTL; see operational checklist) and indefinitely if the refresh token is also taken (until refresh-token rotation invalidates it).

**What we rely on instead:**

- **Content-Security-Policy** (`public/_headers`): `script-src 'self'` plus the absence of `'unsafe-eval'`/`'unsafe-inline'` on `script-src` is the practical XSS mitigation. The CSP is the load-bearing control here, not the storage choice.
- **No XSS surfaces in the source tree today**: no `dangerouslySetInnerHTML`, no `innerHTML` writes, no `eval`, no `document.write`, no raw `fetch` to user-controlled URLs. `react-markdown` runs without `rehype-raw`. `MarkdownPage` carries a header comment pinning the safe configuration.
- **In-app password change requires current-password re-auth**: `ChangePasswordForm` calls `supabase.auth.signInWithPassword` with the current password before `updateUser({ password })`. This is a real protection: rotating the password requires knowing the current one, not just holding a session token. (The forgot-password recovery path requires the email-link recovery code instead; see "Defense-in-depth extras".)
- **Short access-token TTL** with refresh-token rotation (operational checklist) shrinks the window in which a stolen access token is useful.

**Where the localStorage assumption leaks beyond what the UI controls.** The Delete-account UI also re-auths with current password (`SettingsPage.tsx`'s `DeleteAccount` component), but that gate is client-side friction only. The `delete_account()` RPC itself only checks `auth.uid() is null` (`supabase/migrations/20260426000000_delete_account_rpc.sql`); a stolen authenticated JWT can call it directly through PostgREST and skip the UI entirely. The same property applies to every PostgREST endpoint and every authenticated SECURITY DEFINER RPC: the JWT itself is the access proof, not the UI flow that obtained it. Adding a server-enforced recent-auth proof to `delete_account()` (e.g. require a fresh `signInWithPassword` token signature passed as an RPC argument and verified server-side) would close this gap; it's deferred because (a) the BaaS architecture has no server-side place to verify a freshness claim other than another RPC roundtrip the attacker would also be holding the token for, and (b) the practical control is still "make XSS not happen" via CSP. Documented here so future reviewers see what the UI re-auth does and does not cover.

**Password change does not invalidate previously-issued JWTs.** A successful `supabase.auth.updateUser({ password })` rotates the user's password and refreshes the caller's session in place, but it does NOT revoke any other JWT that was minted before the change. An attacker holding an exfiltrated access token keeps that token's read/write capability until its TTL expires (operational checklist caps it at ≤1 hour); a held refresh token keeps minting new access tokens until rotation invalidates it. The user-facing "Password updated" toast therefore means "future logins need the new password," not "all sessions across the world are now locked out." This is a BaaS-architecture consequence (PostgREST trusts the JWT, with no per-request password-state check) and matches the broader localStorage residual-risk model above. The practical mitigations are unchanged: keep access-token TTL short, keep CSP strict so XSS can't exfiltrate tokens in the first place, and require current-password re-auth on the in-app change flow so a stolen *token* alone can't rotate the password.

**Why we don't switch to cookie-based session storage.** A cookie-based store is only meaningfully more secure when there's a server-side component that can read the cookie and proxy to the database. grampacker is BaaS; the browser talks directly to PostgREST. Moving the session into a cookie under that architecture buys cookie-handling complexity without removing the XSS-exfiltration class (an attacker with script execution in the page can still call PostgREST as the user). The architecturally honest mitigation is "make XSS not happen" (CSP + no XSS surfaces in code), which we have.

**What would change this acceptance:**

- A `dangerouslySetInnerHTML` site or `rehype-raw` enable lands without removing the localStorage assumption: XSS surface reopens, residual risk converts to active risk.
- A backend service is introduced that could hold the session in an HttpOnly cookie. At that point cookie-based storage becomes the obvious choice.
- The CSP weakens (e.g. `'unsafe-inline'` on `script-src`, or a third-party script source added without subresource integrity).

The 2026-05-04 security audit accepted this residual risk because the CSP in
`public/_headers` keeps script execution tightly scoped to this app.

---

## Operational checklist (Supabase dashboard)

These are configuration knobs in the Supabase project dashboard. Code can't enforce them; engineers should verify them periodically (and during onboarding) since drift is silent.

- [ ] **Access token TTL ≤ 1 hour.** Project → Authentication → Sessions.
- [ ] **Refresh token rotation enabled.** Same panel.
- [ ] **Refresh token "reuse interval" short** (10–30 seconds is typical). Same panel.
- [ ] **Redirect URL allowlist** contains only known origins (production domain + `localhost` ports used in dev). Project → Authentication → URL Configuration. The forgot-password flow at `ForgotPasswordPage.tsx` uses `redirectTo: ${origin}/reset-password`, so every origin you sign in from must be allowlisted.
- [ ] **"Confirm email" enabled.** Project → Authentication → Providers → Email. The login flow at `LoginPage.tsx` already handles the "email not confirmed" error path; if this gets disabled, the dead branch becomes a security gap (unverified emails would bypass the implicit ownership proof).

Last verified: _<YYYY-MM-DD by name>_. Re-verify after any Supabase plan/project migration, when adding a new redirect URL, or at least quarterly.

---

## Adding a new table safely

1. **Reference `auth.users(id)`** on user-owned data, either directly via a `user_id` column or transitively through a parent that has one. `ON DELETE CASCADE` so account deletion cleans up.
2. **Grant explicit Data API table privileges** to `authenticated`, `service_role`, and (only if the table participates in a public-share path) `anon`. Supabase is dropping the implicit "all public-schema tables are reachable through the Data API" default (2026-05-30 for new projects, 2026-10-30 for existing). The GRANT controls Data API reachability; RLS still gates which rows are visible. Pick the template that matches the table:
   - **Private owner table:**
     ```sql
     grant select, insert, update, delete on table public.<table> to authenticated;
     grant select, insert, update, delete on table public.<table> to service_role;
     alter table public.<table> enable row level security;
     ```
   - **Public-share readable table:**
     ```sql
     grant select on table public.<table> to anon;
     grant select, insert, update, delete on table public.<table> to authenticated;
     grant select, insert, update, delete on table public.<table> to service_role;
     alter table public.<table> enable row level security;
     ```
   See `20260514000000_explicit_data_api_table_grants.sql` for the backfill on existing tables, and `20260514000001_normalize_data_api_table_grants.sql` for the follow-up normalization. When normalizing a table that already exists in production, do not just add the new grants — historical Supabase defaults granted broad table privileges (INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES) to API roles and to the `public` pseudo-role. Revoke them first, then re-grant the narrow matrix:
     ```sql
     revoke all privileges on table public.<table>
       from public, anon, authenticated, service_role;
     -- ...then the GRANT block above.
     ```
     Verify with the query at the bottom of `20260514000001_*.sql`. The expected matrix has no `TRUNCATE`, `TRIGGER`, or `REFERENCES`, and `anon` is absent for private tables.
3. **Enable RLS explicitly** in the migration: `alter table <name> enable row level security` (already shown in the GRANT templates above). The `rls_auto_enable` trigger also handles this, but writing it explicitly makes the migration self-documenting and removes the dependency on the trigger being installed.
4. **Write policies** for SELECT/INSERT/UPDATE/DELETE. Use one policy per (role, action) pair. Two patterns:
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
   - **Joined-via-parent (child table without its own `user_id`):** swap each `(select auth.uid()) = user_id` predicate above with the joined form:
     ```sql
     exists (select 1 from <parent>
             where <parent>.id = <table>.<fk>
             and <parent>.user_id = (select auth.uid()))
     ```
   - **Owner-keyed plus public-share read:** add an anon SELECT policy carrying only the public-share predicate, and combine the public-share predicate with the owner check inside the authenticated SELECT policy:
     ```sql
     create policy <name>_anon_select on <table>
       for select to anon
       using (<public-share-predicate>);

     create policy <name>_auth_select on <table>
       for select to authenticated
       using ((select auth.uid()) = user_id or <public-share-predicate>);

     -- writes unchanged from the owner-keyed pattern above
     <auth_insert / auth_update / auth_delete>
     ```
5. **`WITH CHECK` is mandatory** on policies that govern INSERT or UPDATE. Without it, a user could update a row they own to belong to someone else.
6. **Always wrap `auth.uid()` in `(select auth.uid())`.** Direct calls trigger the Supabase `auth_rls_initplan` advisor warning and re-evaluate the function per row; the subquery form lets Postgres cache the value as an initPlan.
7. **Always pass `TO authenticated` or `TO anon`** explicitly, even for self-only tables. Without a `TO` clause the policy applies to every role inheriting from `public` (`anon`, `authenticated`, plus Supabase internals like `authenticator`, `dashboard_user`, `supabase_privileged_role`) and shows up in `multiple_permissive_policies` warnings on every role that doesn't actually need access.
8. **If the table participates in sharing,** use the third sub-pattern above. The public-share predicate is the same one the anon policy carries, OR'd into the authenticated SELECT so signed-in users opening a friend's share link still see the row. See `gear_items_anon_select` / `gear_items_auth_select` for the canonical transitive shape.
9. **Do not rely on the legacy default public-schema grants for Data API access.** Every new public-schema table migration must include the explicit table grants from step 2 plus the RLS policies above. Never grant table privileges to the `public` role or to `anon` beyond what step 2 prescribes (anon gets `SELECT` and only on tables with a public-share predicate). Function `EXECUTE` grants follow the separate rules in "Adding a SECURITY DEFINER function safely" below.

---

## Adding a SECURITY DEFINER function safely

1. **Decide whether you actually need DEFINER.** Default to `SECURITY INVOKER` (the default if you don't specify); RLS plus table grants handle the authorization. `DEFINER` is only for the narrow case where the function needs privileges the calling role genuinely lacks: `delete_account` (DELETE on `auth.users`), `handle_new_user` (INSERT into `profiles` as `supabase_auth_admin`), `rls_auto_enable` (ALTER TABLE ownership). If RLS and grants already permit what the function does, use `INVOKER`; see `20260514202025` for four functions that were moved off `DEFINER` once that was confirmed.
2. **Set `search_path = ''`:** and fully schema-qualify every referenced object in the body (`public.<table>`, `auth.uid()`, etc.). `pg_catalog` is always searched implicitly, so builtins need no qualification. An empty `search_path` with qualified references is the strict form; do not rely on a `public, pg_temp` path.
3. **Lock down EXECUTE:**
   ```sql
   revoke execute on function <name>(<args>) from public, anon;
   grant execute on function <name>(<args>) to authenticated;
   ```
   For trigger-only functions, revoke from all roles including `authenticated`; the trigger fires regardless of EXECUTE privileges.
4. **Add an inline `auth.uid()` ownership check** at the top of the function body. The check is the compensating control for bypassing RLS. Without it, `DEFINER` becomes a privilege escalation primitive.
5. **Document the trust assumption** in a header comment: what the function does, why it needs `DEFINER`, what the inline check enforces, and what would have to change to break the model.
6. **Reference the inline-ownership pattern** in `add_gear_item_with_list_item` / `create_list_from_selection` / `duplicate_list` (migration `20260514202025`). Those functions are now `SECURITY INVOKER`, but the inline `auth.uid()` checks they kept are exactly the compensating-control shape a new `DEFINER` function needs: `auth.uid() <> p_user_id` raising `42501`, plus per-id `EXISTS` ownership checks raising `P0002` before any write.
7. **Expect the Supabase linter warning.** Default to refactor-to-INVOKER (`20260514202025` has four worked examples). Accept-with-rationale only when the function genuinely needs owner privileges the caller lacks, documented alongside `DECISIONS.md` ADR 3. Don't silently leave it.

---

## When the model needs to change

| Situation | Required change |
|---|---|
| New user-owned table | Standard owner-keyed policies (or joined-via-parent if there's no direct `user_id`). No security review needed beyond the checklist above. |
| New public read path | Add an anon SELECT policy (`*_anon_select`) carrying the public-share predicate, and OR that predicate into the table's `*_auth_select`. Document the trust assumption (what gates it: slug + `is_shared` flag, public-by-design data, etc.). |
| Collaboration / multi-owner | Owner-keyed policies broaden to membership-keyed (e.g. `EXISTS (SELECT 1 FROM list_members WHERE list_id = … AND user_id = auth.uid())`). Every table that participates in collaboration needs a new policy shape; this is a real review, not a checklist item. |
| Admin role | Define a Postgres role, write admin-specific policies. Prefer narrow `for select to admin using (<predicate>)` over `for all using (true)`; least privilege still applies. |
| New SECURITY DEFINER function | Full review per the section above. Inline ownership check is non-negotiable. |
| Removing a public read path | Drop the corresponding `*_anon_select` policy and remove the `OR <public-share-predicate>` from the table's `*_auth_select`. Existing share links go silently 404, same as toggling `is_shared` off. |

---

## Reference

**Migrations** (all in `supabase/migrations/`):
- `20260425000000_initial_schema.sql`: `profiles`, `set_updated_at`, `handle_new_user`, RLS on profiles.
- `20260425000001_categories_and_gear.sql`: `categories`, `gear_items`, owner-keyed RLS, count cap.
- `20260425000002_lists_and_list_items.sql`: `lists`, `list_items`, owner-keyed RLS, shared-list RLS (gated on `is_shared`), joined-via-parent RLS on `list_items` (later replaced; see `20260506000002`), count caps.
- `20260426000000_delete_account_rpc.sql`: `delete_account()`.
- `20260427000000_public_select_via_shared_list.sql`: transitive read for the share view.
- `20260427000001_cascade_gear_item_deletion.sql`: referential cleanup (NOT NULL + CASCADE on `list_items.gear_item_id`).
- `20260429000000_function_hardening.sql`: `search_path` pinning, `handle_new_user` lockdown, `rls_auto_enable` backfill.
- `20260430000000_bulk_reorder_rpc.sql` + `20260501000000_bulk_reorder_rpc_ownership_check.sql` + `20260502000000_add_gear_items_to_bulk_reorder.sql` + `20260503000000_add_lists_to_bulk_reorder.sql`: `bulk_update_sort_order` RPC, ownership check, table whitelist extensions.
- `20260504000000_rename_share_token_to_slug.sql`: share-token → slug rename + length 8 → 6.
- `20260505000000_fix_delete_account_search_path.sql`: `search_path` pin on `delete_account()` (drift fix from the function-hardening sweep).
- `20260505000001_profiles_self_update_with_check.sql`: adds the missing `WITH CHECK` clause to the profiles update policy.
- `20260506000000_composite_fks_for_same_owner.sql` + `20260506000001_revert_composite_fks_for_same_owner.sql`: first cross-owner-FK lockdown attempt (RLS WITH CHECK subquery), reverted after triggering policy recursion (Postgres 42P17). Kept in history for the lesson; see "Cross-owner FK enforcement" above.
- `20260506000002_add_user_id_to_list_items_composite_fks.sql`: composite FKs for cross-owner enforcement; adds `list_items.user_id`; simplifies `list_items_owner_all` to direct `auth.uid() = user_id`.
- `20260506000003_fix_category_delete_set_null_columns.sql`: fixes the composite FK on `gear_items.category_id` to use the PG 15+ `ON DELETE SET NULL (category_id)` column-list form so `user_id` (NOT NULL) doesn't get nulled on category deletion.
- `20260512000000_advisor_cleanup_rls_policies.sql`: Supabase advisor cleanup. Replaces `*_owner_all` (FOR ALL) + `*_public_select_*` (FOR SELECT) per-table with role-and-action-specific policies on every owner-keyed table; wraps every `auth.uid()` reference in `(select auth.uid())`. Closes 26 advisor warnings (`auth_rls_initplan` * 6 + `multiple_permissive_policies` * ~20) without changing behavior.
- `20260514000000_explicit_data_api_table_grants.sql`: explicit table GRANTs for `profiles`, `categories`, `gear_items`, `lists`, `list_items` to `authenticated`, `service_role`, and (the four content tables only) `anon`. Backfill ahead of Supabase removing the implicit "public-schema tables are reachable through the Data API" default (2026-10-30 for existing projects). RLS unchanged.
- `20260514000001_normalize_data_api_table_grants.sql`: follow-up that revokes the historical broad defaults (INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES leaked to `anon`/`authenticated` and to the `public` pseudo-role) on the five tables, then re-grants the same narrow matrix as 20260514000000. RLS unchanged.
- `20260514202025_reduce_security_definer.sql`: function-security audit. Converts `bulk_update_sort_order`, `add_gear_item_with_list_item`, `create_list_from_selection`, and `duplicate_list` from `SECURITY DEFINER` to `SECURITY INVOKER` (RLS + composite FKs enforce the same ownership; inline checks kept as defense-in-depth). Tightens `delete_account` and `handle_new_user` to `search_path = ''` (both stay DEFINER). Leaves `rls_auto_enable` untouched.

**ADRs** (in `DECISIONS.md`):
- ADR 3: Bulk DB operations through Postgres RPCs (rationale + accepted linter warning).
- ADR 8: Per-list opt-in sharing.

**Behavior reference** (in `SPEC.md`):
- "Row-level security": short summary of the two policy shapes and the RPC pointer.
- "Sharing mechanics": slug + RLS user-facing behavior.

**Codebase conventions** (in `CLAUDE.md`):
- "Database patterns": when to use the RPC vs. single-row PATCH; the upsert trap.
