# grampacker — Phase 8 fixes (2026-05-05)

**Source:** `REVIEW-performance.md` M2 + M3 — RPC consolidation to collapse multi-round-trip mutations.
**Scope:** three new SECURITY DEFINER Postgres functions + three client refactors. Five commits (one migration + three client swaps + one docs).
**Why this is one phase:** all three RPCs share a pattern (single transaction wrapping inserts that the client previously chained), the migration is one append-only file, and the client refactors are independent but mechanically similar. Bundling them keeps the audit ledger entry coherent.

> **Note on file paths:** all paths are repo-relative.
> **Phase 7 baseline:** main bundle = **187.26 KB gzip**. Bundle delta expected: small drop (~0.1 KB) — the client code shrinks slightly when it stops chaining helpers.
> **Risk profile:** medium. Wire-protocol changes on three mutation paths. Each RPC is a single-transaction equivalent of what the client did before, so semantics are preserved, but error codes and edge cases (slug conflict retry, RLS denial) need explicit verification.

---

## How to execute this file

Five commits, **strict ordering: Commit 1 (migration) MUST land before Commits 2-4 (client refactors).** Without the RPCs, the client refactors can't compile. Commits 2, 3, 4 are independent of each other and can land in any order.

For each commit:
1. Make the change.
2. Run `npm run build` — pass.
3. Run `npm run lint` — pass.
4. Run `npm test --run` — 31/31 pass.
5. Manual smoke per the commit's verification section.

After Commit 1: apply via `supabase db push` (or paste into Supabase Studio's SQL editor) and verify with `select proname from pg_proc where proname like 'add_gear%' or proname like 'create_list%' or proname like 'duplicate_list';`.

---

## Commit 1 — Add three SECURITY DEFINER RPCs

**Origin:** prerequisite for M2 + M3.

**Why:**

The existing client functions chain multiple PostgREST calls inside one user-perceived action:

| Mutation | Current shape | Round-trips |
|---|---|---|
| `addNewItemMut` (`ListDetailPage.tsx:436-464`) | `createGearItem` then `addGearItemToList` | 2 |
| `createListFromSelection` (`lists.ts:97-117`) | `createList` (with slug retry) then bulk insert into `list_items` | 2 |
| `duplicateList` (`lists.ts:119-172`) | insert into `lists` (with slug retry), select `list_items` from source, bulk insert copies | 3 |

Each chain is a single user gesture ("Add new item", "Create list from selection", "Duplicate"); the round-trip multiplication is invisible until you hit a slow connection. Collapsing each into a SECURITY DEFINER RPC saves the wall-clock time of N-1 RTTs per gesture and gives transactional atomicity (no half-finished list on a network failure between calls).

**Slug retry stays client-side.** The RPC takes a `p_slug` parameter; if the insert raises `23505` (unique violation), the client's existing `withSlugRetry` wrapper catches it and retries with a fresh slug. The alternative — server-side retry inside the RPC — would force PL/pgSQL exception handling per insert and complicate auditing. The client wrapper already exists and works; passing the slug as a parameter is the minimal change.

**RLS / SECURITY DEFINER pattern:** every function asserts `auth.uid() = p_user_id` at the top and bails with an exception if not, then uses `SET search_path = public, pg_temp`. Pattern matches the existing `bulk_update_sort_order` RPC (see `CLAUDE.md`'s "bulk partial-column updates" section and `20260430000000_bulk_reorder_rpc.sql` for the template).

**Important — RLS does NOT apply inside `SECURITY DEFINER`.** Inside these functions every `select`/`insert`/`update` runs as the function owner with RLS bypassed. That means:
- Ownership of any user-controlled id parameter (`p_list_id`, `p_gear_item_ids`, `p_source_list_id`) MUST be verified explicitly inside the function before we use it. FK + composite-FK checks would catch some violations on insert via rollback, but explicit checks fail fast with a clear error and avoid doing partial work before rejection.
- The previous spec's comment claiming `duplicate_list` source ownership is "also enforced by RLS on SELECT" was wrong inside SECURITY DEFINER. The `where ... and user_id = p_user_id` clause is the actual (and only) protection. Comment is corrected below.

**Hardened revoke/grant shape:** matches `bulk_update_sort_order` migration exactly:
```sql
revoke execute on function public.<name> from public, anon;
grant  execute on function public.<name> to   authenticated;
```
The `, anon` is load-bearing — otherwise an anonymous client could call the RPC and auth.uid() would be NULL, falling through to the unauthorized-exception branch but still incurring a server round-trip per attempt.

**Transactional atomicity is a visible behavior change.** Previously, `createListFromSelection` ran two PostgREST calls: list-create could succeed and list_items insert could then fail mid-flight, leaving an empty list behind. After this change, the whole gesture rolls back if any insert fails (cap trigger, FK violation on a stale gear_item_id, etc.). That's the desired semantics — surface this as an intentional improvement in commit message bodies, and explicitly smoke a forced-rollback case (e.g. include a non-existent gear_item_id in the array and verify no orphan list row appears).

**Files:**
- Create: `supabase/migrations/20260510000000_add_consolidated_mutation_rpcs.sql`

**What to do:**

### Step 1 — Verify the latest migration filename for sequence consistency

```sh
ls supabase/migrations/ | tail -3
```

If 2026-05-09 (Phase 6's index migration) is the latest, use `20260510000000_...`. If anything newer has landed today, bump the timestamp accordingly. Lexicographic ordering must stay strictly increasing.

### Step 2 — Write the migration

```sql
-- Phase 8: consolidated mutation RPCs to collapse multi-round-trip flows.
--
-- All three functions are SECURITY DEFINER + auth.uid() guarded. Pattern
-- matches bulk_update_sort_order (20260430000000) — hard-coded user
-- check at the top, set search_path, return the row(s) the client
-- previously got from the chained PostgREST calls.
--
-- Slug retry stays CLIENT-SIDE: each function takes p_slug as a
-- parameter; the client's withSlugRetry wrapper catches 23505 and
-- retries with a fresh slug. Server-side retry would complicate
-- auditing without saving meaningful round-trips (collisions are rare).

-- ============================================================
-- add_gear_item_with_list_item
-- ============================================================
-- Used by /lists/:id "+ Add new item" flow. Creates a gear_items row
-- AND a list_items row referencing it, in one transaction.
-- Returns: { gear_item_id uuid, list_item_id uuid }
create or replace function public.add_gear_item_with_list_item(
  p_user_id uuid,
  p_name text,
  p_description text,
  p_weight_grams integer,
  p_category_id uuid,
  p_gear_sort_order integer,
  p_list_id uuid,
  p_list_item_sort_order integer,
  p_quantity integer,
  p_is_worn boolean,
  p_is_consumable boolean
)
returns table (gear_item_id uuid, list_item_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gear_id uuid;
  v_list_item_id uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- Defense in depth (RLS is bypassed inside SECURITY DEFINER): verify
  -- the caller owns the target list before writing anything. Without
  -- this, a forged p_list_id pointing at another user's list would be
  -- caught only by the (user_id, list_id) composite FK on list_items —
  -- a clear error here is preferable to relying on FK rollback.
  if not exists (
    select 1 from public.lists where id = p_list_id and user_id = p_user_id
  ) then
    raise exception 'list not found' using errcode = 'P0002';
  end if;

  insert into public.gear_items (
    user_id, name, description, weight_grams, category_id,
    cost, purchase_date, sort_order
  )
  values (
    p_user_id, p_name, p_description, p_weight_grams, p_category_id,
    null, null, p_gear_sort_order
  )
  returning id into v_gear_id;

  insert into public.list_items (
    user_id, list_id, gear_item_id, quantity,
    is_worn, is_consumable, sort_order
  )
  values (
    p_user_id, p_list_id, v_gear_id, p_quantity,
    p_is_worn, p_is_consumable, p_list_item_sort_order
  )
  returning id into v_list_item_id;

  return query select v_gear_id, v_list_item_id;
end;
$$;

revoke execute on function public.add_gear_item_with_list_item from public, anon;
grant  execute on function public.add_gear_item_with_list_item to   authenticated;

-- ============================================================
-- create_list_from_selection
-- ============================================================
-- Used by /gear "Create list from selection" multi-select flow.
-- Inserts a lists row and (optionally) bulk-inserts list_items
-- referencing the supplied gear_item_ids.
-- Returns: the inserted lists row.
--
-- Slug retry: client passes p_slug; on 23505 the client's withSlugRetry
-- catches and retries with a fresh slug.
create or replace function public.create_list_from_selection(
  p_user_id uuid,
  p_name text,
  p_description text,
  p_slug text,
  p_sort_order integer,
  p_gear_item_ids uuid[]
)
returns public.lists
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_list public.lists;
  v_owned_count integer;
  v_input_count integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- Defense in depth (RLS is bypassed inside SECURITY DEFINER): verify
  -- the caller owns every gear_item id supplied. Without this, a forged
  -- array could reference another user's gear_items — the (user_id,
  -- gear_item_id) composite FK on list_items would catch it on insert
  -- via rollback, but an up-front check fails fast and avoids creating
  -- the parent list row inside a transaction that's about to abort.
  v_input_count := coalesce(array_length(p_gear_item_ids, 1), 0);
  if v_input_count > 0 then
    select count(*) into v_owned_count
    from public.gear_items
    where id = any(p_gear_item_ids) and user_id = p_user_id;
    if v_owned_count <> v_input_count then
      raise exception 'one or more gear items not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.lists (user_id, name, description, slug, sort_order)
  values (p_user_id, p_name, p_description, p_slug, p_sort_order)
  returning * into v_list;

  if v_input_count > 0 then
    insert into public.list_items (user_id, list_id, gear_item_id, sort_order)
    select p_user_id, v_list.id, gid, ordinality - 1
    from unnest(p_gear_item_ids) with ordinality as t(gid, ordinality);
  end if;

  return v_list;
end;
$$;

revoke execute on function public.create_list_from_selection from public, anon;
grant  execute on function public.create_list_from_selection to   authenticated;

-- ============================================================
-- duplicate_list
-- ============================================================
-- Used by /lists "Duplicate" kebab action. Inserts a copy of the source
-- list (name suffixed " (copy)") and copies every list_items row from
-- source to new in one transaction.
-- Returns: the new lists row.
--
-- Source ownership is enforced ONLY by the explicit
-- `where id = p_source_list_id and user_id = p_user_id` clause below.
-- RLS does NOT apply inside SECURITY DEFINER, so it cannot be relied on
-- here — the explicit check is the actual protection.
create or replace function public.duplicate_list(
  p_user_id uuid,
  p_source_list_id uuid,
  p_slug text,
  p_sort_order integer
)
returns public.lists
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_list public.lists;
  v_source public.lists;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- Verify source ownership directly. RLS does NOT apply inside
  -- SECURITY DEFINER, so this clause is the only thing preventing a
  -- forged p_source_list_id from copying another user's list.
  select * into v_source
  from public.lists
  where id = p_source_list_id and user_id = p_user_id;
  if not found then
    raise exception 'source list not found' using errcode = 'P0002';
  end if;

  insert into public.lists (user_id, name, description, slug, sort_order)
  values (p_user_id, v_source.name || ' (copy)', v_source.description, p_slug, p_sort_order)
  returning * into v_list;

  insert into public.list_items (
    user_id, list_id, gear_item_id, quantity,
    is_worn, is_consumable, is_packed, sort_order
  )
  select
    p_user_id, v_list.id, gear_item_id, quantity,
    is_worn, is_consumable, is_packed, sort_order
  from public.list_items
  where list_id = p_source_list_id and user_id = p_user_id;

  return v_list;
end;
$$;

revoke execute on function public.duplicate_list from public, anon;
grant  execute on function public.duplicate_list to   authenticated;
```

### Step 3 — Apply locally and verify

```sh
supabase db push
```

Then in Supabase Studio's SQL editor:

```sql
select proname, prosrc is not null as has_body
from pg_proc
where proname in (
  'add_gear_item_with_list_item',
  'create_list_from_selection',
  'duplicate_list'
)
order by proname;
```

Expect three rows, all `has_body = true`.

**Verification:**

- `npm run build` — pass; bundle gzip flat.
- `npm run lint` — pass; no source files changed.
- `npm test --run` — 31/31 pass.
- Migration apply: pending user-side. The local agent can't run `supabase db push`. After apply, paste the `pg_proc` query output into the commit message body for the audit ledger.

**Acceptance criteria:** three RPCs exist in the database, build + lint + tests pass, migration committed (apply is a user step).

**Suggested commit:** `feat(db): add consolidated mutation RPCs for M2 + M3 (Phase 8)`

---

## Commit 2 — M2: rewire `addNewItemMut` to the RPC

**Origin:** REVIEW-performance.md M2 (Medium).

**Why:**

`src/lists/ListDetailPage.tsx:436-464` does:

```ts
const newGear = await createGearItem(userId, {...}, gearItems.length)
await addGearItemToList(listId, userId, newGear.id, listItems.length, {...})
```

Two PostgREST calls per click. After Commit 1's RPC, this collapses to one `supabase.rpc('add_gear_item_with_list_item', {...})` call.

**Files:**
- Modify: `src/lists/ListDetailPage.tsx` — the `addNewItemMut` block.

**What to do:**

### Step 1 — Replace the chained-call body

```ts
const addNewItemMut = useMutation({
  mutationFn: async ({ categoryId, data }: { categoryId: string | null; data: AddItemData }) => {
    const { error } = await supabase.rpc('add_gear_item_with_list_item', {
      p_user_id: userId,
      p_name: data.name,
      p_description: data.description,
      p_weight_grams: data.weight_grams,
      p_category_id: categoryId,
      p_gear_sort_order: gearItems.length,
      p_list_id: listId,
      p_list_item_sort_order: listItems.length,
      p_quantity: data.quantity,
      p_is_worn: data.is_worn,
      p_is_consumable: data.is_consumable,
    })
    if (error) throw error
  },
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
    qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
  },
})
```

Drop the `createGearItem` import if it's no longer used elsewhere in the file (likely is — check `git grep createGearItem src/lists/ListDetailPage.tsx`). `addGearItemToList` similarly — verify before removing.

`supabase` should already be imported via the existing query helpers; if not, add `import { supabase } from '../lib/supabase'`.

### Step 2 — Type the RPC return

The RPC returns `{ gear_item_id, list_item_id }` but the mutation doesn't use the return value (the success handler is a pure cache-invalidate). Treat as `void` — Supabase's `rpc()` typed return inferred from the `Database` types should resolve correctly once the migration is applied and types are regenerated. If types haven't been regenerated, leave a `// TODO: regenerate types` comment and the call still works at runtime.

**KNOWN RISK:** if the project uses generated Supabase types (`supabase gen types typescript`), a fresh type pull is required after the migration applies. Without it, `supabase.rpc('add_gear_item_with_list_item', ...)` may type-error because the function name isn't in the union. Two options:
- Regenerate types and commit the resulting `database.types.ts` change in this same commit.
- If the project doesn't use generated types (verify by checking for any `database.types.ts` or similar), no action needed.

Verify by `grep -r "Database['public']" src/lib/` — if it's there, types are generated; if not, the project uses ad-hoc typing.

**Verification:**

- `npm run build` — pass.
- `npm run lint` — pass.
- `npm test --run` — 31/31 pass.
- Manual smoke (REQUIRED — wire-protocol change):
  1. Open `/lists/<id>`. Click "+ Add new item" inside any category.
  2. Fill name, description, weight, quantity. Submit.
  3. Item appears in the list AND in the gear library.
  4. Repeat in the Uncategorized section (`categoryId=null`).
  5. DevTools Network tab: confirm a single POST to `/rest/v1/rpc/add_gear_item_with_list_item` per add (was two: one POST `/rest/v1/gear_items` then one POST `/rest/v1/list_items`).
  6. Hard-refresh; confirm both rows persisted server-side.
  7. Test error path: temporarily change `p_user_id` to a different uuid in DevTools (or sign out and back in mid-session) — should get a 401-equivalent error and a toast (the existing onError handling).

**Acceptance criteria:** one network call per "+ Add new item" gesture, both rows appear, hard-refresh confirms persistence.

**Suggested commit:** `perf(list): collapse addNewItemMut into single RPC (M2)`

---

## Commit 3 — M3a: rewire `createListFromSelection` to the RPC

**Origin:** REVIEW-performance.md M3 (Medium).

**Why:**

`src/lib/queries/lists.ts:97-117` does `createList` (with slug retry) then bulk insert into `list_items`. Two round-trips. After Commit 1's RPC, one call wrapped in `withSlugRetry`.

**Files:**
- Modify: `src/lib/queries/lists.ts` — the `createListFromSelection` function.

**What to do:**

```ts
export async function createListFromSelection(
  userId: string,
  name: string,
  description: string | null,
  gearItemIds: string[],
  sortOrder: number,
): Promise<List> {
  return withSlugRetry(async (slug) => {
    const { data, error } = await supabase.rpc('create_list_from_selection', {
      p_user_id: userId,
      p_name: name,
      p_description: description,
      p_slug: slug,
      p_sort_order: sortOrder,
      p_gear_item_ids: gearItemIds,
    })
    if (error) throw error
    return data as List
  })
}
```

`withSlugRetry` catches `23505` and retries with a fresh slug. The RPC's INSERT into `lists` will raise `23505` on slug collision; the wrapper handles it transparently. **Verify the error code propagates through `supabase.rpc()`** — Supabase typically wraps Postgres errors in a `PostgrestError` object with `.code` matching the original PG code. The existing `withSlugRetry` reads `(err as { code?: string })?.code === '23505'`, which should match.

**KNOWN RISK:** if `supabase.rpc()` wraps the error such that the `.code` property is hidden behind a different shape (e.g. nested under `.cause` or `.details`), `withSlugRetry` will fail to detect collisions and the retry won't fire. If the manual smoke shows that creating a list with an artificially-forced slug collision (rare in practice) doesn't retry, surface as a blocker — the wrapper may need to be widened.

**Semantics change (intentional improvement):** previously, the chained calls could leave an empty list behind if the bulk `list_items` insert failed after the parent list was created. The RPC wraps both inserts in one transaction, so any failure (cap trigger, FK violation on a stale gear_item_id, ownership-check rejection) rolls back the whole gesture. **Document in the commit message body.** Verify with the rollback-smoke step below.

**Verification:**

- Build + lint + tests pass.
- Manual smoke:
  1. On `/gear`, multi-select 2-3 items. "Create list from selection". Fill a name. Submit.
  2. New list appears on `/lists` with the selected items pre-populated.
  3. DevTools Network: single POST to `/rest/v1/rpc/create_list_from_selection` (was: one POST `/rest/v1/lists` + one POST `/rest/v1/list_items`).
  4. Hard-refresh; confirm both list and items persisted.
  5. **Pre-write ownership-rejection smoke.** Run this through the authenticated client, NOT Supabase Studio's SQL editor — `auth.uid()` is null in the editor by default (no browser JWT), so a direct call would short-circuit on the `unauthorized` check (42501) before reaching the ownership validation. From the app: in DevTools console on a signed-in session, paste:
     ```js
     await window.supabase /* or whatever the export is — adapt */
       .rpc('create_list_from_selection', {
         p_user_id: (await window.supabase.auth.getUser()).data.user.id,
         p_name: 'rejection test', p_description: null,
         p_slug: 'rejection-test-' + Date.now(),
         p_sort_order: 0,
         p_gear_item_ids: ['00000000-0000-0000-0000-000000000000'],
       })
     ```
     Expect a PostgrestError with `code === 'P0002'`, message "one or more gear items not found". Then confirm no `lists` row was created (refresh `/lists` or query Supabase Studio: `select id, name from public.lists where name = 'rejection test';`) — should return zero rows. This validates the **pre-write ownership check** rejects bogus ids before any insert; a true post-insert rollback test would need a failure that fires *after* the list row is written (e.g. a cap trigger violation on the bulk insert), which is harder to set up and out of scope for this smoke.
  6. **Duplicate-ids note (informational, not a smoke step).** The ownership check uses `count(*) ... where id = any(p_gear_item_ids)` compared to `array_length(p_gear_item_ids, 1)`. If the array contains duplicate valid uuids, the count comes in lower than the input length and the RPC raises `P0002`. The current UI assembles selections as a `Set`, so duplicates can't reach the wire under normal flows; documenting here so a future caller knows to dedupe (or change the check to `count(distinct ...)`) if a duplicate-tolerant code path is introduced.

**Suggested commit:** `perf(lists): collapse createListFromSelection into single RPC (M3)`

---

## Commit 4 — M3b: rewire `duplicateList` to the RPC

**Origin:** REVIEW-performance.md M3 (Medium).

**Why:**

`src/lib/queries/lists.ts:119-172` does insert into `lists` (with slug retry), then SELECT all source `list_items`, then bulk INSERT copies. Three round-trips. After Commit 1's RPC, one call wrapped in `withSlugRetry`.

**Files:**
- Modify: `src/lib/queries/lists.ts` — the `duplicateList` function.

**What to do:**

```ts
export async function duplicateList(source: List, userId: string, sortOrder: number): Promise<List> {
  return withSlugRetry(async (slug) => {
    const { data, error } = await supabase.rpc('duplicate_list', {
      p_user_id: userId,
      p_source_list_id: source.id,
      p_slug: slug,
      p_sort_order: sortOrder,
    })
    if (error) throw error
    return data as List
  })
}
```

The `name` suffix `' (copy)'` and `description` copy are now done server-side inside the RPC, so the client function takes `source` only for the id — the rest is unused. (The `source: List` parameter signature is preserved for compatibility with callers; passing the whole row is harmless.)

**KNOWN RISK 1:** the source-list ownership check in the RPC raises a custom exception (`P0002` "source list not found") if the user doesn't own the source. The client's existing error handling on duplicate failures may not recognize this code as gracefully as a 23505. If the toast shape needs adjustment, surface and patch.

**KNOWN RISK 2:** `is_packed` is copied from source. The pre-fix client also copied `is_packed`, so this is unchanged behavior. Worth flagging because UX-wise, "duplicating a fully-packed list" preserves the packing state — that's the existing convention, not a Phase 8 decision.

**Verification:**

- Build + lint + tests pass.
- Manual smoke:
  1. On `/lists` cards, click the kebab on any list with items → "Duplicate". (If "Duplicate" lives elsewhere, find it.)
  2. New "<source name> (copy)" card appears with the same items.
  3. DevTools Network: single POST to `/rest/v1/rpc/duplicate_list` (was: one POST `/rest/v1/lists`, one GET `/rest/v1/list_items`, one POST `/rest/v1/list_items`).
  4. Hard-refresh; confirm copy persisted with all items.

**Acceptance criteria:** single network call per duplicate, copy contains all source items, hard-refresh confirms persistence.

**Suggested commit:** `perf(lists): collapse duplicateList into single RPC (M3)`

---

## Commit 5 — Append Phase 8 summary to REVIEW-FIX.md

**File:** `.planning/REVIEW-FIX.md`

```markdown
# grampacker — Phase 8 fix summary (2026-05-05)

## Shipped

- **Commit 1 (RPCs) — `<hash>`** — three SECURITY DEFINER functions added in `supabase/migrations/20260510000000_add_consolidated_mutation_rpcs.sql`: `add_gear_item_with_list_item`, `create_list_from_selection`, `duplicate_list`. Pattern matches the existing `bulk_update_sort_order` (auth.uid() guard + `set search_path = public, pg_temp` + revoke-from-public + grant-to-authenticated). Slug retry stays client-side via the existing `withSlugRetry` wrapper.
- **Commit 2 (M2) — `<hash>`** — `addNewItemMut` in `ListDetailPage.tsx` now does one `supabase.rpc('add_gear_item_with_list_item', ...)` call instead of `createGearItem` + `addGearItemToList` chain. Two RTT → one.
- **Commit 3 (M3a) — `<hash>`** — `createListFromSelection` in `lib/queries/lists.ts` now wraps a single RPC call in `withSlugRetry`. Two RTT → one.
- **Commit 4 (M3b) — `<hash>`** — `duplicateList` similarly. Three RTT → one. The `' (copy)'` name suffix and source-row copy now happen server-side inside the RPC.

## Verification results

- `npm run build`: pass; bundle gzip <before> → <after>.
- `npm run lint`: pass.
- `npm test --run`: 31/31 pass.
- Migration applied to production: <pending or verified date>.
- Manual smoke (single network call per gesture, hard-refresh persistence): <pending or notes>.

## Blockers / surprises

- (fill in or "none")

## Next phase

Phase 9 candidates:
- **Quality refactors** — W-1 (`useAnchoredMenu` extraction), W-7 (CategoryGroup name-shadow rename), W-2…W-13 (type/clarity nits). Several small commits, low risk, no perf payoff.
- **Security hardening** — F4 (anon enumeration), F5 (ESLint rule), F8 (SW cache auth-keying decision).
- **Test-coverage cluster** — T-3…T-9; needs jsdom + @testing-library install.

After Phase 8, the `REVIEW-performance.md` audit will be substantially closed: H1-H6 done, M1-M13 done, L1-L9 done (or audit-stale dropped). Remaining perf items would be either backend/infrastructure (Cloudflare cache headers, etc.) or speculative (sub-millisecond memo wins).
```

**Suggested commit:** `docs(review-fix): append Phase 8 summary`

---

## Out of scope for Phase 8

Explicitly NOT in this phase:

- **Optimistic updates for the three flows.** Audit asks for round-trip collapse; optimistic UI is a separate UX commit. Each of these gestures has a brief "saving..." period today; collapsing the wire calls helps but doesn't add optimism. If desired, follow-up phase.
- **Type regeneration via `supabase gen types`.** If the project uses generated types and they need refreshing, that's a tooling step outside the audit. Verify and surface as a blocker if it's load-bearing.
- **`createGearItem` / `addGearItemToList` removal.** Those helpers may still be used elsewhere (csv import, etc.). Audit before removing; out of scope for round-trip collapse.
- **Slug-generation server-side.** Considered and rejected — the client retry pattern works and moving generation server-side complicates auditing.
- **Async cap-trigger / FK cascade behavior under RPC.** Triggers fire per-row inside the RPC's transaction same as outside; no change. If smoke testing surfaces a trigger issue, surface as a blocker.

If a commit reveals scope expansion (e.g. type regeneration is required and produces a 5000-line diff), **stop and surface as a blocker** rather than rewriting the spec inline.
