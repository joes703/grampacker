# Admin runbook

Common Supabase queries for operating grampacker. Use the Supabase
Studio SQL editor (signed in as project owner) or `psql` with the
service-role connection string. Anything in `auth.*` requires that
elevated access; queries on `public.*` work either way.

Placeholders in queries:

- `:user_email` — the user's email address, e.g. `'alice@example.com'`
- `:user_id` — a `public.profiles.id` / `auth.users.id` UUID
- `:list_slug` — the 8-char slug from a `/r/<slug>` share URL
- `:list_id` — a `public.lists.id` UUID

Replace inline before running, or set them as psql variables
(`\set user_email 'alice@example.com'` and reference as `:'user_email'`).

## Safety conventions

Every destructive query in this runbook is wrapped in a transaction
that **rolls back by default**. Run the block as-is to preview impact,
then change the trailing `ROLLBACK;` to `COMMIT;` once the preview
matches expectations.

```sql
BEGIN;
-- destructive query here
-- inspect affected rows
ROLLBACK;  -- change to COMMIT only after verifying
```

If you skip the wrapper, a typo'd `WHERE` clause is irreversible. The
overhead is one extra line of typing.

---

## 1. Support / incident response

### 1.1 Find a user by email

```sql
SELECT
  id,
  email,
  created_at,
  last_sign_in_at,
  email_confirmed_at,
  banned_until,
  deleted_at,            -- non-null when soft-deleted via the Admin API
  is_anonymous,
  raw_user_meta_data
FROM auth.users
WHERE email = :user_email;
```

`id` is what every `public.*` table joins on. Copy it into the
follow-up queries. `deleted_at` is populated when the user was
soft-deleted via `supabase.auth.admin.deleteUser(id, { shouldSoftDelete: true })`;
the row is still present until the soft-delete grace window expires.

### 1.2 Per-user overview (counts + last activity)

```sql
SELECT
  p.id,
  u.email,
  p.created_at AS profile_created_at,
  u.last_sign_in_at,
  (SELECT count(*) FROM public.categories  WHERE user_id = p.id) AS categories,
  (SELECT count(*) FROM public.gear_items  WHERE user_id = p.id) AS gear_items,
  (SELECT count(*) FROM public.lists       WHERE user_id = p.id) AS lists,
  (SELECT count(*) FROM public.list_items  WHERE user_id = p.id) AS list_items,
  (SELECT max(updated_at) FROM public.gear_items WHERE user_id = p.id) AS last_gear_edit,
  (SELECT max(updated_at) FROM public.list_items WHERE user_id = p.id) AS last_list_edit
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.id = :user_id;
```

### 1.3 User's lists

```sql
SELECT
  l.id,
  l.name,
  l.slug,
  l.is_shared,
  l.created_at,
  l.updated_at,
  (SELECT count(*) FROM public.list_items WHERE list_id = l.id) AS items,
  (SELECT sum(gi.weight_grams * li.quantity)
   FROM public.list_items li
   JOIN public.gear_items gi ON gi.id = li.gear_item_id
   WHERE li.list_id = l.id) AS total_weight_grams
FROM public.lists l
WHERE l.user_id = :user_id
ORDER BY l.sort_order, l.name;
```

### 1.4 User's full inventory

```sql
SELECT
  gi.id,
  c.name AS category,
  gi.name,
  gi.weight_grams,
  gi.status,
  gi.cost,
  gi.purchase_date,
  gi.updated_at
FROM public.gear_items gi
LEFT JOIN public.categories c ON c.id = gi.category_id
WHERE gi.user_id = :user_id
ORDER BY c.sort_order NULLS LAST, gi.sort_order, gi.name;
```

### 1.5 One list's contents (for a "my list looks wrong" report)

```sql
SELECT
  li.id AS list_item_id,
  li.sort_order,
  li.quantity,
  li.is_worn,
  li.is_consumable,
  li.is_packed,
  li.is_ready,
  gi.name,
  gi.weight_grams,
  gi.status,
  c.name AS category
FROM public.list_items li
JOIN public.gear_items gi ON gi.id = li.gear_item_id
LEFT JOIN public.categories c ON c.id = gi.category_id
WHERE li.list_id = :list_id
ORDER BY c.sort_order NULLS LAST, li.sort_order;
```

### 1.6 Find a list by its share slug (for a "my share link broke" report)

```sql
SELECT
  l.id,
  l.user_id,
  u.email AS owner_email,
  l.name,
  l.is_shared,
  l.created_at,
  l.updated_at
FROM public.lists l
JOIN auth.users u ON u.id = l.user_id
WHERE l.slug = :list_slug;
```

If `is_shared = false`, the share page will render "List not found"
even though the row exists. The owner has to flip sharing back on
from the app.

### 1.7 Recent auth events for a user

```sql
SELECT created_at, ip_address, payload
FROM auth.audit_log_entries
WHERE payload->>'actor_id' = :user_id::text
ORDER BY created_at DESC
LIMIT 50;
```

`payload->>'action'` reads (verified against the GoTrue source):
`login`, `logout`, `token_refreshed`, `token_revoked`,
`user_signedup`, `user_modified`, `user_updated_password`,
`user_deleted`. Use this for "I can't sign in" reports to confirm
whether the credentials ever reached the auth server.

**Caveat:** audit entries are written by GoTrue (the auth server),
not by Postgres triggers. Any account action you run as raw SQL
through the SQL editor (e.g. a direct `DELETE FROM auth.users` from
section 4.1) bypasses GoTrue and will NOT produce an audit row.
Section 4.3's `user_deleted` lookup only sees deletes performed via
the Admin API or the dashboard.

---

## 2. Product / engagement metrics

### 2.1 Total users

```sql
SELECT count(*) AS total_users FROM auth.users;
```

### 2.2 Signups by day, last 30 days

```sql
SELECT date_trunc('day', created_at)::date AS day, count(*) AS signups
FROM auth.users
WHERE created_at >= now() - interval '30 days'
GROUP BY 1
ORDER BY 1 DESC;
```

### 2.3 DAU / WAU / MAU (activity = any list-item or gear-item edit)

```sql
WITH activity AS (
  SELECT user_id, updated_at FROM public.list_items
  UNION ALL
  SELECT user_id, updated_at FROM public.gear_items
)
SELECT
  count(DISTINCT user_id) FILTER (WHERE updated_at >= now() - interval '1 day')  AS dau,
  count(DISTINCT user_id) FILTER (WHERE updated_at >= now() - interval '7 days') AS wau,
  count(DISTINCT user_id) FILTER (WHERE updated_at >= now() - interval '30 days') AS mau
FROM activity;
```

### 2.4 Onboarding drop-off (users with no content)

```sql
SELECT u.id, u.email, u.created_at
FROM auth.users u
LEFT JOIN public.gear_items gi ON gi.user_id = u.id
LEFT JOIN public.lists      l  ON l.user_id  = u.id
WHERE gi.id IS NULL AND l.id IS NULL
ORDER BY u.created_at DESC;
```

### 2.5 Share-link adoption

```sql
SELECT
  count(*) FILTER (WHERE is_shared)                                  AS shared_lists,
  count(*)                                                            AS total_lists,
  round(100.0 * count(*) FILTER (WHERE is_shared) / nullif(count(*), 0), 1) AS pct_shared
FROM public.lists;
```

### 2.6 Top engaged users (by list-item edits in last 30 days)

```sql
SELECT
  u.email,
  count(*) AS edits_last_30d
FROM public.list_items li
JOIN auth.users u ON u.id = li.user_id
WHERE li.updated_at >= now() - interval '30 days'
GROUP BY u.email
ORDER BY edits_last_30d DESC
LIMIT 20;
```

### 2.7 Average gear / list counts per active user

```sql
SELECT
  avg((SELECT count(*) FROM public.gear_items WHERE user_id = u.id)) AS avg_gear_items,
  avg((SELECT count(*) FROM public.lists      WHERE user_id = u.id)) AS avg_lists,
  avg((SELECT count(*) FROM public.list_items WHERE user_id = u.id)) AS avg_list_items
FROM auth.users u
WHERE u.id IN (
  SELECT DISTINCT user_id FROM public.list_items
  WHERE updated_at >= now() - interval '30 days'
);
```

---

## 3. Cleanup / data integrity

### 3.1 Orphan checks (should all return zero)

All `public.*` tables cascade off `profiles.id -> auth.users.id`, so a
non-zero count points to a broken constraint or a manual write.

```sql
SELECT 'profiles_without_auth_user' AS check_name,
       count(*) AS orphans
FROM public.profiles p LEFT JOIN auth.users u ON u.id = p.id
WHERE u.id IS NULL
UNION ALL
SELECT 'gear_items_without_profile', count(*)
FROM public.gear_items gi LEFT JOIN public.profiles p ON p.id = gi.user_id
WHERE p.id IS NULL
UNION ALL
SELECT 'list_items_without_gear_item', count(*)
FROM public.list_items li LEFT JOIN public.gear_items gi ON gi.id = li.gear_item_id
WHERE gi.id IS NULL
UNION ALL
SELECT 'list_items_without_list', count(*)
FROM public.list_items li LEFT JOIN public.lists l ON l.id = li.list_id
WHERE l.id IS NULL;
```

### 3.2 Empty categories (no gear_items)

Not strictly broken, but a UX smell — likely the user created and
abandoned them, or a delete left them behind.

```sql
SELECT c.id, c.user_id, c.name, c.is_default, c.created_at
FROM public.categories c
LEFT JOIN public.gear_items gi ON gi.category_id = c.id
WHERE gi.id IS NULL AND NOT c.is_default
ORDER BY c.user_id, c.sort_order;
```

### 3.3 Unused inventory (gear_items not on any list)

```sql
SELECT gi.user_id, gi.id, gi.name, gi.status, gi.created_at
FROM public.gear_items gi
LEFT JOIN public.list_items li ON li.gear_item_id = gi.id
WHERE li.id IS NULL
ORDER BY gi.user_id, gi.created_at DESC;
```

### 3.4 Empty lists

```sql
SELECT l.id, l.user_id, l.name, l.created_at, l.is_shared
FROM public.lists l
LEFT JOIN public.list_items li ON li.list_id = l.id
WHERE li.id IS NULL
ORDER BY l.created_at DESC;
```

### 3.5 profiles vs auth.users symmetry

```sql
SELECT
  (SELECT count(*) FROM auth.users)       AS auth_users,
  (SELECT count(*) FROM public.profiles)  AS profiles;
```

These should be equal — `public.profiles` is created on signup via
trigger and cascades on auth-user delete.

### 3.6 DESTRUCTIVE: delete an empty, non-default category

Use after running 3.2 to verify the target is genuinely empty.

```sql
BEGIN;
DELETE FROM public.categories
WHERE id = '00000000-0000-0000-0000-000000000000'  -- replace with the id
  AND NOT is_default
  AND NOT EXISTS (
    SELECT 1 FROM public.gear_items WHERE category_id = public.categories.id
  )
RETURNING id, user_id, name;
-- inspect the RETURNING output; one row only
ROLLBACK;  -- change to COMMIT only after verifying
```

### 3.7 DESTRUCTIVE: force a list private (kill a share link)

Use when a user reports an accidentally-shared list and can't reach
the app fast enough to toggle it themselves.

```sql
BEGIN;
UPDATE public.lists
SET is_shared = false, updated_at = now()
WHERE id = :list_id
RETURNING id, user_id, name, is_shared;
ROLLBACK;  -- change to COMMIT only after verifying
```

### 3.8 DESTRUCTIVE: rotate a list's share slug

The slug is the public URL identifier, so rotating it invalidates
every existing `/r/<old>` link. The new slug must be 8 chars (the
`char_length(share_token) = 8` check survived the rename). Generate
one out of band that matches `^[A-Za-z0-9]{8}$` — pick something the
app's `generateSlug()` would produce.

```sql
BEGIN;
UPDATE public.lists
SET slug = 'NEWSLUG8', updated_at = now()  -- replace with a fresh 8-char slug
WHERE id = :list_id
RETURNING id, user_id, name, slug;
ROLLBACK;  -- change to COMMIT only after verifying
```

If you hit a unique-constraint violation, generate another slug and
retry. The app's retry logic does the same.

---

## 4. Account deletion

The end-user flow calls `public.delete_account()` (SECURITY DEFINER,
`auth.uid()`-gated). It does exactly one thing:

```sql
DELETE FROM auth.users WHERE id = auth.uid();
```

`auth.users.id` cascades through `public.profiles.id`, which cascades
through every `public.*` table. After the RPC returns, the user's
auth row, profile, categories, gear_items, lists, and list_items are
all gone.

### 4.1 Run a deletion as admin (user can't reach the app)

Two paths, with different reproducibility characteristics:

**Preferred: Admin API.** Calling
`supabase.auth.admin.deleteUser(id)` (from a server with the
service-role key) goes through GoTrue, which writes a `user_deleted`
audit log entry, fires any configured webhooks, and supports
`{ shouldSoftDelete: true }` for a recoverable delete. Use this when
the audit trail or webhook chain matters.

**Direct SQL (this runbook).** When the user can't reach the app and
you don't need the audit/webhook chain:

```sql
BEGIN;
DELETE FROM auth.users WHERE id = :user_id RETURNING id, email;
-- one row only; inspect RETURNING
ROLLBACK;  -- change to COMMIT only after verifying
```

This bypasses GoTrue entirely: no `user_deleted` audit row, no
webhook fires, no soft-delete option. The cascade still runs.

### 4.2 Verify a deletion ran cleanly

After committing 4.1, every count should be zero. Both
`public.*` (your tables) and `auth.*` per-user tables (GoTrue's,
declared `ON DELETE CASCADE` from `auth.users` in upstream
migrations) are included:

```sql
SELECT 'auth.users'           AS table_name, count(*) FROM auth.users           WHERE id      = :user_id
UNION ALL SELECT 'auth.identities',                count(*) FROM auth.identities      WHERE user_id = :user_id
UNION ALL SELECT 'auth.sessions',                  count(*) FROM auth.sessions        WHERE user_id = :user_id
UNION ALL SELECT 'auth.refresh_tokens',            count(*) FROM auth.refresh_tokens  WHERE user_id = :user_id
UNION ALL SELECT 'auth.mfa_factors',               count(*) FROM auth.mfa_factors     WHERE user_id = :user_id
UNION ALL SELECT 'auth.one_time_tokens',           count(*) FROM auth.one_time_tokens WHERE user_id = :user_id
UNION ALL SELECT 'public.profiles',                count(*) FROM public.profiles      WHERE id      = :user_id
UNION ALL SELECT 'public.categories',              count(*) FROM public.categories    WHERE user_id = :user_id
UNION ALL SELECT 'public.gear_items',              count(*) FROM public.gear_items    WHERE user_id = :user_id
UNION ALL SELECT 'public.lists',                   count(*) FROM public.lists         WHERE user_id = :user_id
UNION ALL SELECT 'public.list_items',              count(*) FROM public.list_items    WHERE user_id = :user_id;
```

Any non-zero row signals a broken cascade. `public.*` cascades flow
through `profiles.id -> auth.users.id`; `auth.*` cascades are
defined directly on `auth.users(id)` by GoTrue migrations. If you
see a non-zero `auth.*` row, the GoTrue schema has drifted — file
an issue with Supabase support. If you see a non-zero `public.*`
row, the local schema has drifted.

### 4.3 Audit recent deletions (Admin API only)

```sql
SELECT created_at, payload
FROM auth.audit_log_entries
WHERE payload->>'action' = 'user_deleted'
ORDER BY created_at DESC
LIMIT 20;
```

Only deletes performed via `supabase.auth.admin.deleteUser()` or the
dashboard appear here. Direct SQL deletes from 4.1 do not.

---

## 5. RLS sanity check

The runbook above runs as service-role and ignores RLS. To verify the
app's policies still gate what end-users see, switch role and replay
a known-good read inside a transaction you can roll back:

```sql
BEGIN;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';  -- a real user id
SELECT auth.uid();           -- sanity: must return the same uuid
SELECT count(*) FROM public.gear_items;  -- should equal that user's gear count
ROLLBACK;
```

The `role` claim is required: `auth.uid()` reads it via
`current_setting('request.jwt.claims', true)::jsonb`, and policies
that gate on `auth.role() = 'authenticated'` will otherwise treat the
session as anonymous and the count will be zero (which looks like a
working policy but is testing the wrong thing). The leading `SELECT
auth.uid()` catches that misconfiguration before you trust the real
query.

`BEGIN; ... ROLLBACK;` is safer than `SET LOCAL` + `RESET ROLE`:
both unwind the role/claims when the transaction closes, but the
explicit ROLLBACK also guarantees no accidental writes from a
mistyped query in the middle leak out of the session.

If the count differs from section 1.2's `gear_items` value for the
same user, an RLS policy regressed. Don't run this in production
unless you're investigating a suspected leak — even with ROLLBACK,
the read patterns still load shared cache state.
