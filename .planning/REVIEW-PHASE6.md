# grampacker — Phase 6 fixes (2026-05-05)

**Source:** `REVIEW-performance.md` H1 (High) and M1 (Medium) — DB index gaps.
**Scope:** add the four missing covering indexes on `list_items` and `lists`. One migration, one commit (plus docs).
**Why this is one phase:** schema changes are atomic by nature. Splitting H1 and M1 across two migrations buys nothing — both are append-only `CREATE INDEX` statements with no ordering coupling, no data migration, and no downtime risk. One migration, one commit, one entry in the audit ledger.

> **Note on file paths:** all paths are repo-relative.
> **Phase 5 baseline:** main bundle = **186.86 KB gzip**. Bundle delta expected: zero (DB-only changes).
> **Risk profile:** very low. `CREATE INDEX` (non-concurrent) on tables with current row counts in the low thousands is sub-second; even at 100k rows it's seconds. RLS policies, FK constraints, and existing query plans are unchanged — Postgres just gets new index options for the planner.

---

## How to execute this file

Two commits — one schema migration + one docs summary append. The migration file is the unit of work; the docs commit is the audit-ledger update.

For the migration:
1. Create the file at the path specified.
2. Apply it locally via `supabase db push` (or whatever the project's standard application command is — verify by reading prior migration commits' messages).
3. Confirm the four indexes exist via `psql` (or Supabase Studio's SQL editor): `select indexname from pg_indexes where tablename in ('list_items', 'lists') order by indexname;`. Expect to see the four new index names plus any pre-existing ones.
4. Run `npm run build` and `npm test --run`. Both must stay green. Bundle size unchanged.
5. Manual smoke: load a list page (`/lists/<id>`), confirm fetch works. Load `/lists` index, confirm. The query plans change but the results don't — manual smoke is just sanity.
6. Commit with the suggested message.

After the migration: append to `REVIEW-FIX.md` with one entry covering the four new indexes.

---

## Commit 1 — Add `list_items` and `lists` indexes (H1 + M1)

**Origin:** REVIEW-performance.md H1 (High) and M1 (Medium).

**Why:**

`list_items` (the per-trip rows joining `lists` and `gear_items`) was created in `20260425000002_lists_and_list_items.sql` with NO indexes. After `20260506000002` added `user_id` to the table, the four indexable columns (`list_id`, `gear_item_id`, `user_id`, `sort_order`) all appear in production query plans:

| Query | Predicate | Order | File |
|---|---|---|---|
| `fetchListItems` (authed) | `user_id = ? AND list_id = ?` | `sort_order` | `src/lib/queries/list-items.ts:12-21` |
| `fetchAllUserListItems` | `list.user_id = ?` (via FK) | `sort_order` | `list-items.ts:27-37` |
| `fetchSharedListItems` (anon) | `list_id = ?` | `sort_order` | `list-items.ts:43-49` |
| `resetPackedForList` | `list_id = ? AND is_packed = true` | n/a | `list-items.ts:100-107` |
| Cascading delete | from `gear_items.id` and `lists.id` | n/a | implicit FK |

Without indexes, every query above seq-scans the entire `list_items` table per request. At small data volumes the seq scan is fast enough to hide the issue, but the cost grows linearly with total list_items rows across all users (since `list_items` is shared across the whole user base). The `ON DELETE CASCADE` paths are the silent-but-deadly part: deleting a gear item triggers a seq scan of `list_items` for matching `gear_item_id`, then deletes those rows — the cascade is correct but unnecessarily slow.

`lists` is missing a covering `user_id` index. `fetchLists` does `WHERE user_id = ? ORDER BY sort_order, name` on every authed page load (`src/lib/queries/lists.ts:30-39`); the existing `categories_user_sort_idx` (`(user_id, sort_order, name)`) and `gear_items_user_idx` (`(user_id, sort_order, name)`) are the template — `lists` deserves the same.

**Indexes to add (four total):**

For `list_items`:

1. `list_items_user_list_sort_idx (user_id, list_id, sort_order)` — covers the AUTHED `fetchListItems` end-to-end (predicate + order). Composite over the two predicate columns lets the planner do an index range scan with no extra sort step.
2. `list_items_list_sort_idx (list_id, sort_order)` — covers the ANON `fetchSharedListItems` (which has no `user_id` predicate, so the leftmost prefix of #1 doesn't help it), the `lists.id → list_items.list_id` cascade, `resetPackedForList`, and the per-list cap trigger. Adding `sort_order` as a second column gives the share-view query an index-ordered scan, avoiding a sort step on read. We don't include `is_packed` because the column has low cardinality and `resetPackedForList` writes (not reads) — the planner needs the list_id range to find rows; the is_packed filter is then applied post-fetch on a small set. (The original audit recommended `(list_id, sort_order)` — switching from a `(list_id)`-only shape per Codex review.)
3. `list_items_gear_item_id_idx (gear_item_id)` — covers the `gear_items.id → list_items.gear_item_id` cascade. Without this, deleting a gear_item degrades to a seq scan on every cascade.

For `lists`:

4. `lists_user_sort_idx (user_id, sort_order, name)` — covers `fetchLists`. Mirrors `categories_user_sort_idx` exactly.

**File:**
- Create: `supabase/migrations/20260509000000_list_items_and_lists_indexes.sql`

**What to do:**

### Step 1 — Verify the latest migration filename for sequence consistency

Run:

```sh
ls supabase/migrations/ | tail -3
```

If the latest is dated 2026-05-08 or earlier, use `20260509000000_list_items_and_lists_indexes.sql`. If a newer migration has landed (e.g. another patch on 2026-05-09 today), bump to `20260509000001_...` or whatever produces a strictly-increasing timestamp. **Do NOT reuse an existing timestamp** — Supabase orders migrations lexicographically by filename and a collision is a hard error.

### Step 2 — Write the migration

```sql
-- Phase 6: cover the four missing indexes on list_items and lists.
--
-- list_items was created in 20260425000002 with no indexes; user_id was
-- added in 20260506000002. Every query that reads or cascades through
-- list_items currently seq-scans the whole table.
--
-- lists has no covering user_id index; fetchLists scans the whole table
-- on every page load. Mirrors categories_user_sort_idx / gear_items_user_idx.
--
-- These are pure CREATE INDEX statements: no data migration, no policy
-- change, no constraint change. RLS, FKs, and query results are unchanged
-- — only the planner's options improve.

-- ============================================================
-- list_items
-- ============================================================

-- Covers fetchListItems(user_id, list_id) ORDER BY sort_order.
-- Composite over the two predicate columns + sort column lets the planner
-- do an index range scan with no extra sort step.
create index list_items_user_list_sort_idx
  on public.list_items (user_id, list_id, sort_order);

-- Covers fetchSharedListItems (anon, no user_id predicate — so the
-- leftmost prefix of list_items_user_list_sort_idx is unusable here),
-- the lists.id -> list_items.list_id cascade, resetPackedForList, and the
-- per-list-item-cap trigger. Adding sort_order as a second column gives
-- the share-view query an index-ordered scan and avoids a sort step.
-- is_packed isn't included — low cardinality, and resetPackedForList
-- writes (not reads).
create index list_items_list_sort_idx
  on public.list_items (list_id, sort_order);

-- Covers the gear_items.id -> list_items.gear_item_id cascade. Without this,
-- deleting a gear_item degrades to a seq scan to find matching list_items.
create index list_items_gear_item_id_idx
  on public.list_items (gear_item_id);

-- ============================================================
-- lists
-- ============================================================

-- Covers fetchLists(user_id) ORDER BY sort_order, name. Mirrors
-- categories_user_sort_idx and gear_items_user_idx in shape.
create index lists_user_sort_idx
  on public.lists (user_id, sort_order, name);
```

**Note on `CREATE INDEX` vs `CREATE INDEX CONCURRENTLY`:** the project's existing migrations all use plain `CREATE INDEX` (non-concurrent). Plain `CREATE INDEX` takes a `SHARE` lock on the table, which **blocks concurrent writes but permits reads** — not `ACCESS EXCLUSIVE`. At current row counts the build is sub-second, so write-blocking is not user-visible. `CREATE INDEX CONCURRENTLY` would avoid the write lock at the cost of being non-atomic with the rest of the migration (it can't run inside a transaction), and Supabase's migration runner doesn't always support it cleanly. Stay with the project's existing pattern. If row counts grow such that the write lock becomes user-visible (likely tens of thousands of `list_items` rows or more), the upgrade path is a separate `CONCURRENTLY` migration on its own.

**Note on UNIQUE constraints:** none of these indexes are unique. We're not enforcing new constraints, only adding query-plan options. Keep them non-unique to avoid surfacing accidental duplicates as migration failures.

**Note on partial indexes:** considered for `list_items_list_id_idx (list_id) WHERE is_packed = true` to optimize `resetPackedForList` further. Skipped because (a) the cascade path also benefits from the simple `list_id` index, (b) partial indexes complicate maintenance, and (c) `resetPackedForList` is a low-frequency mutation. The simple index is the right shape.

### Step 3 — Apply locally

The standard Supabase project workflow is `supabase db push` (writes to the linked project) or `supabase db reset` (rebuilds local from migrations). Read the project's CLAUDE.md or recent migration commits for the canonical apply step. **Do not skip the apply** — the test suite doesn't exercise the new indexes, so without applying we can't verify the migration is syntactically and semantically valid.

### Step 4 — Verify the indexes exist

After applying, run:

```sql
select indexname from pg_indexes
where tablename in ('list_items', 'lists')
order by tablename, indexname;
```

Expected output includes:

```
list_items | list_items_gear_item_id_idx
list_items | list_items_list_sort_idx
list_items | list_items_pkey
list_items | list_items_user_list_sort_idx
lists      | lists_pkey
lists      | lists_slug_key (or whatever the existing unique-slug index is named)
lists      | lists_user_sort_idx
```

If any of the four new indexes are absent, the migration didn't apply — debug before continuing.

### Step 5 — Verification

- `npm run build` — pass; bundle gzip flat (DB-only change).
- `npm run lint` — pass; no source files changed.
- `npm test --run` — 31/31 pass.
- Manual smoke (REQUIRED): load `/lists` (uses `fetchLists` → `lists_user_sort_idx`), then load `/lists/:id` (uses `fetchListItems` → `list_items_user_list_sort_idx`). Both should render normally. Mutate a list (e.g. add an item, delete an item, reorder) — confirm no query failures in the network panel. The cascade indexes only matter for delete throughput; nothing visible to the user.
- **Optional perf check (not required, but the satisfying part):** before and after the migration, run `EXPLAIN ANALYZE` on the canonical query for each index in Supabase Studio's SQL editor:
  - `EXPLAIN ANALYZE SELECT * FROM list_items WHERE user_id = '<your-uid>' AND list_id = '<some-list-id>' ORDER BY sort_order;` — pre: Seq Scan; post: Index Scan using `list_items_user_list_sort_idx`.
  - Same shape for the other three indexes against their canonical predicates.
  - Capture the planner-reported timings and paste them into the commit message body.

**Acceptance criteria:** four new indexes exist in the database, build + lint + tests pass, manual smoke clean. Optional but encouraged: `EXPLAIN ANALYZE` traces in the commit body.

**Suggested commit:** `perf(db): add covering indexes on list_items and lists (H1, M1)`

---

## Commit 2 — Append Phase 6 summary to REVIEW-FIX.md

**File:** `.planning/REVIEW-FIX.md`

Append below the Phase 5 section (including the two follow-ups already there). Structure:

```markdown
# grampacker — Phase 6 fix summary (2026-05-05)

## Shipped

- **Commit 1 (H1 + M1) — `<hash>`** — four covering indexes added in `supabase/migrations/20260509000000_list_items_and_lists_indexes.sql`:
  - `list_items_user_list_sort_idx (user_id, list_id, sort_order)` — covers AUTHED `fetchListItems` end-to-end.
  - `list_items_list_sort_idx (list_id, sort_order)` — covers ANON `fetchSharedListItems`, `lists.id` cascade, `resetPackedForList`, list-item cap trigger.
  - `list_items_gear_item_id_idx (gear_item_id)` — covers `gear_items.id` cascade.
  - `lists_user_sort_idx (user_id, sort_order, name)` — covers `fetchLists`. Mirrors `categories_user_sort_idx`.

  Pre/post `EXPLAIN ANALYZE`: <fill in or "not measured locally">.

## Verification results

- `npm run build`: pass; bundle gzip unchanged at 186.86 KB.
- `npm run lint`: pass.
- `npm test --run`: 31/31 pass.
- Manual smoke (load /lists, load /lists/:id, mutate list_items): pending user verification.

## Blockers / surprises

- (fill in or "none")

## Next phase

Phase 7 candidates:
- **M2** — `addNewItemMut` two-round-trip collapse (single RPC).
- **M3** — `duplicateList` / `createListFromSelection` 2-3 round-trip collapse.
- **Small perf nits cluster** (real L9 = `formatPurchaseDate`, M9 = `formatRelativeDate`, M4 = `RootRedirect`, L3-L4 = DnD memo, M13 = `lucide-react` tree-shaking audit).
- **Quality refactors** (W-1 useAnchoredMenu, W-7 CategoryGroup name shadow, W-2…W-13 type/clarity nits).
- **Security hardening** (F4, F5, F8).
- **Test-coverage cluster** (T-3…T-9; needs jsdom + @testing-library install).

Recommend Phase 7 as the small-perf-nits cluster — cheap wins that ride together — OR jump to RPC collapse (M2/M3) if the user-creation flow latency is the higher priority. DB indexes (this phase) and RPC collapse compose well; both are backend-perf work.
```

**Suggested commit:** `docs(review-fix): append Phase 6 summary`

---

## Out of scope for Phase 6

Explicitly NOT in this phase:

- **Online index builds (`CREATE INDEX CONCURRENTLY`)** — defer until row counts make the lock user-visible.
- **Partial indexes** — defer; the simple indexes cover the audit's predicates.
- **Index on `list_items (is_packed)` or `(list_id, is_packed)`** — `resetPackedForList` is low-frequency; the simple `list_id` index is sufficient.
- **Index changes on `categories`, `gear_items`** — those tables already have appropriate indexes.
- **Vacuuming / analyze tuning** — Supabase autovacuum handles this; manual tuning is not in audit scope.

If the migration fails to apply (constraint conflict, permission issue) or `EXPLAIN ANALYZE` shows the planner ignoring the new indexes, **stop and surface as a blocker** rather than rewriting the indexes inline.
