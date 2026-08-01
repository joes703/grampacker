# Remediation plan for the 2026-07-31 reviews

Source: `docs/review-2026-07-31-combined.md` (union of the Claude and Codex
reviews, deduplicated and ranked).

**Revision 7.** Revisions 1-5 were each BLOCKed by Codex at GATE 1; revision 6
narrowed the blockers to two Phase 2 items. Revision 7 closes those two, and it
closes them by **prototyping them against the repo's real 19 migrations rather
than asserting them** - which is how revisions 4-6 kept failing. Every SQL
statement in Phase 2 below has been executed. The evidence tables are results,
not intentions.

Two things that only showed up under test, both of which changed the design:

- The reorder guard's scratch range has to be **negative**, and reserved by an
  asymmetric trigger pair. Putting it in a band *above* `PACK_RANK_MAX` looked
  right and is broken: every arrival computes `max + 1` through an UPDATE, and
  import may legitimately create a row at exactly `PACK_RANK_MAX`, so an
  ordinary move **commits** into the supposed band and the guard counts it.
  Reproduced. The first prototype missed it because it only tested INSERT -
  vacuous in exactly the way the 2-row container fixture was.
- Offsetting orphan ranks does not merely risk overflow; with a correct
  backstop it **silently strands a rank above `PACK_RANK_MAX`** that the client
  can never resubmit. Dropping offsetting for one uniform dense renumbering
  removed a whole class of failure and made the trigger simpler.

Phase 1 shipped in PR #137 (GATE 2: MERGE).

The most consequential thing this plan records was in neither review:
**`reorderPack` returns 204 after losing a concurrent reorder.** When another
request rewrites the cohort's ranks first, every park predicate and every settle
predicate matches zero rows, the batch commits as a no-op, and the route reports
success. Verified against the real schema on the CURRENT shipped code, so it is
a pre-existing defect rather than one Phase 2 introduces - but Phase 2 rewrites
exactly this code, so it is fixed there.

Corrections carried forward, so they are not re-litigated:

- Revision 2 claimed the trigger algorithm was "settled" on a two-row test. It
  was not; the matrix broke it.
- Revision 3's two-phase parking algorithm worked only while every rank was
  nonnegative, which the schema does not enforce. It is **superseded** by the
  design in Phase 2 below.
- Revision 4 claimed Release 2A was "behavior-preserving" and that "every
  finding in the combined review is scheduled". Both were false. Nonnegative
  parking silently broke `reorderPack`'s settle precondition under a concurrent
  cohort change (demonstrated below), and P2.2's URL/method contract tests,
  P3.8's coverage threshold, P3.9's spelling cleanup, and P3.10's unmetered
  endpoints were all absent. Revision 5 does not repeat the "everything is
  scheduled" claim as an assertion; the coverage table at the bottom of this
  file is the evidence.

## Guiding constraints (from AGENTS.md and CLAUDE.md)

- A merge to `main` IS a deploy and applies remote D1 migrations. Every
  schema-touching PR needs explicit human approval framed as a deploy approval.
- Feature branch, one logical change per PR, no unrelated cleanups folded in.
- Full verify is `npm run build` plus `npm run test:unit`; API tests via
  `npm run test:api` or CI. `npm run test:migrations` for migrations.
- Never edit an applied migration. Always add a new one.
- New triggers and tables mean updating `scripts/check-migration-safety.mjs`
  fixtures.
- No route ships without a row in `docs/authz-matrix.md`.
- Never merge a deliberately red PR to `main`. Red-then-green commits live on
  the feature branch; the PR lands green.

## Phase order

1. Deploy gate
2. **P0.1 pack-rank fix**, in two releases
3. Expand/contract enforcement (before the next *incompatible* schema change)
4. Client failure states and observability
5. Correctness batch
6. Browser/E2E layer
7. Hygiene
8. Food conflict detection (two releases; see "Resolved items")

---

## Phase 1 - Deploy gate (P0.2, first half)

Phase 1 closes the *gating* half of P0.2. The *ordering* half - a destructive
migration reaching production ahead of compatible code - is Phase 3.

### PR 1.1 - the gate, the staleness check, and recovery (ONE PR)

**These cannot be split.** Revision 4 had the trigger in PR 1.1 and the SHA
comparison in PR 1.2. That sequence is unsafe: PR 1.1 alone always checks out
`refs/heads/main` but has nothing tying the checked-out commit to the run that
triggered it. If commit A's CI succeeds, commit B lands and is red or still
running, and A's completion event then fires the deploy, PR 1.1 deploys B -
unverified. The window is open for exactly as long as PR 1.2 takes to land.
The trigger, the exact-SHA comparison, and the fail-closed dispatch recovery
are one atomic change.

```yaml
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
  workflow_dispatch:

permissions:
  contents: read
  actions: read      # REQUIRED: querying workflow runs via the Actions API.
                     # Unspecified permissions default to none, so without this
                     # the manual recovery path fails with 403.

jobs:
  deploy:
    if: >-
      github.event_name == 'workflow_dispatch' ||
      (github.event.workflow_run.event == 'push' &&
       github.event.workflow_run.head_branch == 'main' &&
       github.event.workflow_run.conclusion == 'success' &&
       github.event.workflow_run.head_repository.full_name == github.repository)
    concurrency:
      group: deploy-production
      cancel-in-progress: false
```

Properties this relies on, stated so a future edit cannot silently break them:

- A `workflow_run` definition only takes effect from the default branch, so a
  fork cannot modify the privileged workflow itself.
- `event == 'push'` plus `head_branch == 'main'` excludes every `pull_request`
  run; `head_repository.full_name == github.repository` excludes fork-origin
  runs. Neither is expressible on the trigger, which is why the whole condition
  is a job-level `if`.
- **The checkout never uses an event-supplied ref.** Always
  `ref: refs/heads/main`. Never `head_sha`, never the dispatch ref.

Still in PR 1.1, after checking out `refs/heads/main`, before any remote
mutation:

- Resolve the checked-out SHA and compare with
  `github.event.workflow_run.head_sha`. On mismatch the run is stale (a newer
  commit landed, or an old run was re-run) - exit success without deploying.
  This turns an out-of-order or re-run completion into a no-op instead of a
  production rollback.
- For `workflow_dispatch` there is no `head_sha`. Query CI status for the
  checked-out SHA with a **fail-closed** query that pins all of: the CI
  workflow id (not its name), `event=push`, the exact SHA, and
  `conclusion=success`. Reject missing, ambiguous, queued, or in-progress
  results. The dispatch ref is a trigger only, never a deploy input.
- Main advancing after checkout is not itself unsafe, because the checked SHA
  is immutable and was verified green, and the concurrency group serializes
  deploys. Both controls must stay explicit.

Because the listener is name-based, renaming `CI` silently stops deployment.
And because a stale-SHA run exits success without deploying, a bug in the
comparison would also fail silently. Both failure modes are invisible without a
watchdog, so the watchdog is part of this PR, specified concretely:

- **Deployed-SHA source.** A **GitHub Deployment record**, created by the
  deploy job with `permissions: deployments: write`, and marked `success` as
  the final step after `wrangler deploy` returns. The watchdog reads the latest
  successful deployment's `sha`.

  Revision 5 specified a `deployed-sha` Actions *variable* written with
  `gh variable set`. That does not work: the repository-variables API requires
  a `Variables: write` scope that **is not an available `GITHUB_TOKEN`
  workflow permission at all**, so the call 403s. The failure mode was
  particularly bad - production would already have changed, the job would turn
  red *after* a successful deploy, the marker would stay stale, and the
  watchdog would then report a permanent false incident. Deployments are the
  purpose-built mechanism and `GITHUB_TOKEN` can write them.

- **Marker failure is distinct from deploy failure.** If `wrangler deploy`
  succeeds but the deployment record cannot be written, the job must **not**
  simply go red as though the deploy failed. It records the distinction in the
  step summary and exits non-zero with a message naming the marker as the
  failure, so the operator is not misled into re-running a deploy that already
  landed. The watchdog's alert text likewise distinguishes "main is ahead of
  production" from "marker is stale".
- **Schedule.** `on: schedule: cron: '0 */6 * * *'` plus `workflow_dispatch`.
  Six hours is chosen deliberately: this is a single-user app where a missed
  deploy is an inconvenience, not an outage, and a tighter loop would only add
  noise.
- **Condition.** Alert when `main`'s head SHA differs from `deployed-sha` AND
  the commit behind `main`'s head is older than 2 hours (so a deploy in
  progress is never reported).
- **Alert channel.** The job opens (or updates, if one is already open) a
  GitHub issue titled `deploy liveness: main is ahead of production`, labeled
  `deploy-liveness`. An issue is the channel because it needs no secret, no
  external service, and it is idempotent. This requires
  `permissions: issues: write` on the watchdog job, stated here because
  unspecified permissions default to none and the omission would only surface
  the first time the watchdog actually had something to report.
- **Failure behavior.** The watchdog is advisory and never mutates production.
  If the watchdog itself errors, it fails the scheduled run, which surfaces in
  the Actions tab as a red scheduled workflow.

### PR 1.2 - build first, scope the token

(Renumbered from revision 4's PR 1.3, since 1.1 and 1.2 are now one PR.)

- Build the artifact before any remote change: build, then
  `wrangler d1 migrations apply --remote`, then `wrangler deploy` of that same
  artifact.
- Scope `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` onto only the two
  wrangler steps (P3.10).

**Scope limit:** this removes one failure source, it does not close the window.
`wrangler deploy` is networked and can fail after a successful migration.
Phase 3 is what remediates that.

### PR 1.3 - bootstrap the pack-rank audit workflow

`audit-pack-ranks.yml` lands here, in Phase 1, **not** in Release 2B where it
is used. Revision 5 introduced it as part of 2B, which cannot work: GitHub only
offers `workflow_dispatch` for a workflow file that already exists **on the
default branch**, so a workflow shipped by 2B cannot gate 2B's own merge. It
has to be on `main` first.

Landing it early is harmless - it is `workflow_dispatch`-only, read-only, and
does nothing until someone runs it - and it means that by the time 2B is a
candidate, the gate is a button that already exists.

- **Credential.** A Cloudflare API token scoped to **D1 read** only, stored as
  a repository secret distinct from `CLOUDFLARE_API_TOKEN`. Confirm the D1 read
  scope exists when creating the token; if Cloudflare offers no read-only D1
  permission, the audit uses the existing token and that fact gets written down
  here rather than silently assumed.
- **No environment protection rule.** Revision 5 gated this on a GitHub
  Environment with required reviewers. Dropped: required reviewers and
  environment secrets are not available on private repositories under the free
  plan, and this repository is private. The gate is the **human deploy approval
  that already governs every schema-touching merge** - the audit's job is to
  give that human a green or red answer, not to be a second independent gate.
- **SHA binding, honestly scoped.** A database query cannot be "bound" to a
  commit - the database has no SHA. So the workflow takes a `sha` input,
  **validates that it exists and is the current head of the PR being merged**,
  and writes the audit result as a commit status on that SHA. That makes the
  result attributable and reviewable; it does not make it a property of the
  data, and this plan does not claim otherwise. The fail-closed re-check inside
  `deploy.yml`, immediately before `migrations apply`, is what actually
  guarantees freshness, and it gets the same read-only credential.

---

## Phase 2 - Fix the pack-rank cascade collision (P0.1)

`DELETE /api/lists/:id`, account deletion, and container-item deletion all fail
with a UNIQUE constraint violation in ordinary Pack-mode state.

### The design

**Do not transform ranks in place.** Freeze the destination base in a helper
table, then change `packing_location_id` and `pack_sort_order` **together in
one row update**, so no row is ever in a half-moved state that can collide.
This supersedes revision 3's two-phase parking entirely.

**Materialize the whole target mapping, then apply it.** The helper table holds
one row per orphan - its *final* rank - not a single shared base:

```sql
CREATE TABLE `_packing_location_delete_state` (
  `list_item_id` text PRIMARY KEY,
  `new_rank` integer NOT NULL
) WITHOUT ROWID;
```

Revisions 4-6 keyed this table on `packing_location_id` holding one `base_rank`,
and computed each row's new rank as `base + li.pack_sort_order` inside the
`UPDATE`. That works for a pure offset but **cannot express compaction**, which
2A.4 requires when a list runs out of rank headroom. The obvious compaction
shape - a correlated `count(*)` over the orphan set as a dense ordinal - is a
self-referencing `UPDATE`: rows already updated in the same statement have had
their `packing_location_id` set to `NULL`, so they drop out of the count and
the remaining rows collide. Verified, it fails with
`UNIQUE constraint failed: list_items.list_id, list_items.pack_sort_order`.

Computing every final rank *before* any row moves fixes that, and it makes the
offset and compaction paths the same code with one different expression.
Verified against the real schema:

| Mode | Source `5,9,40` into Unassigned holding `0` | Helper rows left |
| --- | --- | --- |
| offset (gaps preserved) | `0, 6, 10, 41` | 0 |
| dense (compaction) | `0, 1, 2, 3` | 0 |

`ROW_NUMBER()` is usable here because it sits in an `INSERT ... SELECT`, which
trigger bodies do allow - unlike in an `UPDATE ... SET`, where it is not
available at all.

**RESOLVED in revision 7 - prototyped, and the design got simpler.**

Offsetting orphans above the destination maximum needs headroom that may not
exist. With an Unassigned row already at `PACK_RANK_MAX` - reachable today,
since import copies an allowed `sort_order` straight into `pack_sort_order` -
deleting a location with even one item needs `PACK_RANK_MAX + 1`.

The prototype showed this is **worse than an abort**: with a correct backstop,
the offset design does not fail at all. It silently writes a rank above
`PACK_RANK_MAX`, which `sortOrderSchema` will never accept back - a list that
renders fine and can never be reordered again. That control case is in the
suite.

So offsetting is dropped entirely. **One uniform path: renumber the entire
resulting cohort densely, destination rows first then orphans, each by their
own rank.** Two phases through the reserved band, because a dense renumbering
moves rows *down* and a single `UPDATE` collides mid-statement.

This is strictly simpler than what it replaces. Dense means the top rank is
`cohort_size - 1`, bounded by the 300-item list cap, so `pack_sort_order` never
approaches `PACK_RANK_MAX` and **overflow stops being a case to handle and
becomes impossible**. The `RAISE(ABORT)` backstop stays, but it now guards
`count(*) - 1 > PACK_RANK_MAX` and cannot fire - it exists so a future change
to either cap fails loudly instead of silently corrupting ranks.

**The deliberate cost: sparse gaps are no longer preserved.** Revisions 4-6
sold gap preservation as a feature ("relative order and sparse gaps are
preserved exactly"). It is given up on purpose. Gaps carry no user-visible
meaning - the UI renders order, not rank values - they exist only as insertion
headroom, and migration 0018's own backfill already renumbers densely with
`ROW_NUMBER()`. Trading them for a single code path with no reachable overflow
is the better deal. Two matrix rows change accordingly: source `0,2,7` now
yields `[0,1,2,3]` rather than `[0,1,3,8]`.

Verified against the real 19 migrations: 19/19 on the cascade matrix
re-derived for this design, plus destination at exactly `PACK_RANK_MAX`, order
preserved with destination rows ahead of orphans, worn rows keeping their
reserved slot, an empty destination cohort, and the offset-only control above.

```sql
CREATE TRIGGER `packing_locations_rerank_orphans`
BEFORE DELETE ON `packing_locations`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM `list_items` AS `li`
  WHERE `li`.`list_id` = OLD.`list_id` AND `li`.`packing_location_id` = OLD.`id`
)
BEGIN
  SELECT CASE
    WHEN (SELECT count(*) FROM `list_items` AS `c`
           WHERE `c`.`list_id` = OLD.`list_id`
             AND (`c`.`packing_location_id` IS NULL OR `c`.`packing_location_id` = OLD.`id`)) - 1
         > 1000000000
    THEN RAISE(ABORT, 'pack_sort_order exhausted while deleting packing location')
  END;

  INSERT INTO `_packing_location_delete_state` (`list_item_id`, `new_rank`)
  SELECT * FROM (
    SELECT `x`.`id`,
           row_number() OVER (
             ORDER BY CASE WHEN `x`.`packing_location_id` IS NULL THEN 0 ELSE 1 END,
                      `x`.`pack_sort_order`, `x`.`id`) - 1
      FROM `list_items` AS `x`
     WHERE `x`.`list_id` = OLD.`list_id`
       AND (`x`.`packing_location_id` IS NULL OR `x`.`packing_location_id` = OLD.`id`)
  );

  UPDATE `list_items`
     SET `pack_sort_order` = 1000000001 + (
           SELECT `s`.`new_rank` FROM `_packing_location_delete_state` AS `s`
            WHERE `s`.`list_item_id` = `list_items`.`id`)
   WHERE `list_items`.`id` IN (SELECT `list_item_id` FROM `_packing_location_delete_state`);

  UPDATE `list_items`
     SET `packing_location_id` = NULL,
         `pack_sort_order` = (
           SELECT `s`.`new_rank` FROM `_packing_location_delete_state` AS `s`
            WHERE `s`.`list_item_id` = `list_items`.`id`)
   WHERE `list_items`.`id` IN (SELECT `list_item_id` FROM `_packing_location_delete_state`);

  DELETE FROM `_packing_location_delete_state`
   WHERE `list_item_id` IN (SELECT `id` FROM `list_items` WHERE `list_id` = OLD.`list_id`);
END;
```

Why it is safe: the base is frozen before mutation; existing Unassigned ranks
are all below it; adding one base to unique nonnegative source ranks is
injective; relative order and sparse gaps are preserved exactly; moving both
columns in one update avoids source- and destination-cohort transient
collisions; the FK `SET NULL` then has nothing left to do; multiple locations
in one cascade are handled sequentially, each recomputing its base;
`packingLocations.remove()` stays compatible because it has already unassigned
its rows, so `WHEN EXISTS` is false.

### The precondition, and why it forces two releases

The trigger assumes source ranks are nonnegative. **The schema does not enforce
that** - `migrations/0018` declares `pack_sort_order integer NOT NULL DEFAULT 0`
with no CHECK, and adding one would require rebuilding `list_items`, which on
D1 fires cascades and destroys data.

Enforce it with triggers instead:

```sql
CREATE TRIGGER list_items_pack_rank_nonneg_ins
BEFORE INSERT ON list_items FOR EACH ROW WHEN NEW.pack_sort_order < 0
BEGIN SELECT RAISE(ABORT, 'pack_sort_order must be nonnegative'); END;

CREATE TRIGGER list_items_pack_rank_nonneg_upd
BEFORE UPDATE OF pack_sort_order ON list_items FOR EACH ROW WHEN NEW.pack_sort_order < 0
BEGIN SELECT RAISE(ABORT, 'pack_sort_order must be nonnegative'); END;
```

**These would break `reorderPack()` today.** `server/repos/list-items.ts:584`
parks touched rows at `-1 - i` as its scratch phase, and `:595` requires the
row to still be sitting at that scratch value in order to settle. Shipping
enforcement in the same release as the delete fix would trade a broken delete
for broken drag-and-drop.

Hence two releases, in this order:

**Release 2A - tighten the settle precondition, THEN move parking nonnegative.**

Revision 4 described only the parking change and called it
"behavior-preserving". It is not, and the order matters. Two commits on one
branch, landing as one PR:

*2A.1 - tighten settle. This is a latent-bug fix in its own right.*

`server/repos/list-items.ts:592-596` settles on `(id, userId, packSortOrder)`
only, while park re-asserts list, cohort, worn, and rank. Today that asymmetry
is safe purely because a negative rank cannot exist in committed state, so a
row sitting at `-1 - i` must have been put there by this batch's own park. The
precondition is therefore *globally* correct and *locally* meaningless - it
depends on an invariant enforced nowhere near it.

Make settle re-assert exactly what park asserts: `id`, `userId`, `listId`,
`isWorn = false`, the cohort, and the scratch rank. Behavior is unchanged under
the current negative scheme; the point is that correctness stops depending on
the sign of the scratch range.

*2A.2 - move the scratch range nonnegative.*

Only now replace `-1 - i` with `base + i`, where
`base = max(pack_sort_order across the whole cohort) + 1`, computed in JS from
the rows `reorderPack` already selects at `:509-517`. That select is unfiltered
by cohort and already reads every row on the list, so **no new query and no new
bound parameters** - the D1 100-param cap is untouched. `base` must be taken
over the entire cohort, not just the touched rows, or an untouched row can sit
at or above it.

Why 2A.1 is load-bearing, demonstrated against the real schema:

| Parking scheme | Settle precondition | Result |
| --- | --- | --- |
| `-1 - i` | id + user + rank (today) | SAFE |
| `base + i` | id + user + rank (revision 4) | **CORRUPT** |
| `base + i` | full re-assertion (2A.1) | SAFE |

The corrupt row: a concurrent `PATCH` moves a touched row into another cohort
between the pre-read and the batch, and legitimately gives it rank `base + i`
there. Park matches zero rows, because park checks the *old* cohort. Settle
then matches on id and rank alone, overwrites the row **in its new cohort**,
and the route returns 204. With 2A.1 the cohort predicate fails, settle matches
zero rows, and the row is left exactly as the concurrent writer left it - the
same partial-application semantics the current design already documents.

*2A.3 - make a lost race abort instead of reporting success.*

Tightening settle stops the *corruption*, but it does not stop the batch from
committing as a **silent no-op**. Starting at `A=0, B=1, C=2`, this request
plans `B=0, C=1, A=2` while a concurrent request commits `C=0, A=1, B=2` first.
Every park predicate misses (the ranks it asserts are gone) and therefore every
settle predicate misses too. Nothing violates the unique index, so nothing
raises. The batch commits having changed nothing and the route returns **204**.
The client announces success and silently snaps to the winner's order on the
next refetch.

Verified against the real schema on **both** parking schemes, including the
current shipped `-1 - i` one:

| Scheme | Aborted | Winner preserved | Route returns |
| --- | --- | --- | --- |
| `-1 - i` (shipped today) | no | yes | **204, falsely** |
| `base + i` with 2A.1 settle | no | yes | **204, falsely** |

So this is a **pre-existing defect**, not a regression introduced by 2A. It is
fixed here because Phase 2 rewrites this exact code, and because the route
already documents all-or-conflict behavior it does not actually have.

The fix is a **fail-loud in-batch guard**, the same shape as the food CAS guard
in Phase 8, so the codebase has one idiom for "abort a D1 batch on a failed
precondition" rather than two. After the park statements and before the settle
statements, insert a guard whose statement fails - and therefore rolls the
whole batch back - unless **exactly** `updates.length` rows are sitting in this
request's scratch range:

```sql
-- Rolls the batch back via NOT NULL violation unless EVERY park landed.
insert into _pack_reorder_guard (list_id, ok)
select :listId, (select case when count(*) = :expected then 1 end
                   from list_items
                  where list_id = :listId
                    and user_id = :userId
                    and packing_location_id IS :cohort   -- REQUIRED, see below
                    and pack_sort_order between :scratchLo and :scratchHi);
```

Two things about this statement were wrong when first drafted and are corrected
here, both caught by running the SQL rather than reading it:

- **`having count(*) = :expected` on a `select 1` is not valid SQLite** - it
  fails outright with "HAVING clause on a non-aggregate query". The aggregate
  has to be in the select list, and `case when ... then 1 end` is what yields
  the `NULL` that trips `NOT NULL`. Confirmed: matching count returns `1`,
  mismatching returns `NULL`, and the insert then fails with
  `NOT NULL constraint failed`.
- **The cohort predicate is load-bearing, not decoration.** `base` is the max of
  *this* cohort plus one, which says nothing about other cohorts on the same
  list - and the guard filters by `list_id` and `user_id` only unless the cohort
  is added. Counterexample, verified: Unassigned holds ranks `0,1` so the scratch
  range is `[2,3]`, and a bag on the same list legitimately holds ranks `2` and
  `3`. With no cohort predicate the guard counts those two rows, matches
  `:expected = 2`, and **passes while zero parks actually landed** - precisely
  the false success it exists to prevent. With the cohort predicate it correctly
  returns `NULL` and aborts.

`IS` rather than `=` because the Unassigned cohort is `NULL`. A payload of size
one behaves correctly (`count(*) = 1`).

**RESOLVED in revision 7 - prototyped against the real 19 migrations, 16/16.**

The counted-range guard above is superseded. Counting an arbitrary range is
weaker than it looks (a concurrent insert landing in the range inflates the
count and masks a missed park), and the draft also never deleted its own guard
row, so the *next* reorder of that list would collide on the primary key.

**Reserve the scratch range by construction rather than computing it** - and
make it NEGATIVE, not a band above the maximum.

A first attempt put the scratch band at `(PACK_RANK_MAX, PACK_RANK_MAX +
LIST_ITEM_CAP]` with a strict INSERT cap to keep it clean. **That is broken, and
the prototype for it was vacuous** - it tested INSERT and never tested the
writers that actually matter. Every arrival computes `max(pack_sort_order) + 1`
through an UPDATE, and import can legitimately create a row at exactly
`PACK_RANK_MAX` (`importListItemSchema` allows `0 .. 1_000_000_000`), so moving
an item into that cohort **commits** a row at `PACK_RANK_MAX + 1` - inside the
supposed band. Reproduced against the real schema: an ordinary move committed
rank `1000000001`, and the guard then counted one band row with **zero parks in
flight**. The false success the guard exists to prevent would have survived it.

Negative works where "above the maximum" does not, because every writer of this
column produces a nonnegative value *by construction*. Enumerated and executed
against the real schema, each in isolation:

| Writer | Lowest rank produced |
| --- | --- |
| arrival append (`nextPackSortOrderInCohort`) | 0 |
| move into a cohort (`listItems.update`) | 0 |
| `packingLocations.remove()` (`base + i`) | 0 |
| import (`0 .. PACK_RANK_MAX`) | 0 |
| list duplication (dense index) | 0 |

So the two triggers are asymmetric the other way round:

```sql
-- Nothing is ever CREATED negative.
CREATE TRIGGER list_items_pack_rank_range_ins
BEFORE INSERT ON list_items FOR EACH ROW
WHEN NEW.pack_sort_order < 0 OR NEW.pack_sort_order > 1000000000
BEGIN SELECT RAISE(ABORT, 'pack_sort_order out of range (0..1000000000)'); END;

-- UPDATE additionally allows the scratch range, because parking IS an update.
CREATE TRIGGER list_items_pack_rank_range_upd
BEFORE UPDATE OF pack_sort_order ON list_items FOR EACH ROW
WHEN NEW.pack_sort_order < -300 OR NEW.pack_sort_order > 1000000000
BEGIN SELECT RAISE(ABORT, 'pack_sort_order out of range (-300..1000000000)'); END;
```

Park at `-1 - i`. The range is exactly `LIST_ITEM_CAP` wide and the DTO caps a
payload at the same number, so `i` always fits.

Capping UPDATE at `PACK_RANK_MAX` is a second fix in the same stroke: an arrival
into a cohort already at `PACK_RANK_MAX` now **aborts loudly** instead of
silently committing a rank `sortOrderSchema` will never accept back.

The guard is then an exact check needing no ids - and therefore no D1
100-parameter problem, which a per-id `VALUES` join would breach at 300 items:

```sql
INSERT INTO _pack_reorder_guard (list_id, ok)
SELECT :listId, (SELECT CASE WHEN count(*) = :expected THEN 1 END
                   FROM list_items
                  WHERE list_id = :listId AND user_id = :userId
                    AND packing_location_id IS :cohort
                    AND pack_sort_order < 0);

-- ...settle statements...

DELETE FROM _pack_reorder_guard WHERE list_id = :listId;   -- REQUIRED
```

Verified, all against the real schema and now all in the committed suite:

| Case | Result |
| --- | --- |
| Normal reorder | commits, guard table empty after |
| **Two consecutive reorders** | both commit - proves the cleanup |
| **Lost race (park did not land)** | aborts, whole batch rolls back, no false 204 |
| Concurrent cohort change | aborts |
| Concurrent worn toggle | aborts |
| Concurrent delete of a touched row | aborts |
| Payload of size 1 | commits |
| INSERT of a negative rank | rejected |
| UPDATE above `PACK_RANK_MAX` | rejected |
| Negative `packSortOrder` in the DTO | 400, not a 500 from the trigger |

`db.batch` is atomic, so a raised guard rolls back park and settle together and
leaves the concurrent writer's state untouched. The repo maps the violation to
the existing `conflict` reason, which the route already turns into a 409 - the
client's existing refetch-and-retry path, now actually reachable.

**This makes 2A schema-touching, which revision 5's "no schema change" claim no
longer covers.** `_pack_reorder_guard` is a new table, so:

- 2A ships a migration and therefore needs **explicit deploy approval**, same as
  2B. Revision 5 described 2A as shipping "alone and green" with no schema
  change; that is no longer true and the human gate applies to both releases.
- The `TRANSIENT_TABLES` mechanism in `scripts/check-migration-safety.mjs`
  (described under 2B below) must land **here, in 2A**, because 2A introduces
  the first transient table. 2B then only adds its own entry to an existing
  list. Getting this backwards would land 2A red.

Required tests, which the revision 4 matrix could not have caught because every
case in it was single-threaded. Each is a **barrier test** interleaving a real
committed write between the pre-read and the batch, not merely a stale
snapshot:

- a touched row **moves to another cohort** - assert the concurrent writer's
  cohort and rank both survive, and the response is 409 rather than 204;
- a **concurrent reorder of the same cohort** - assert 409, and assert the
  winner's order is intact (this is the false-204 case above);
- a touched row is **toggled worn**;
- a touched row is **deleted**;
- and in every case, assert **no partial write**: either the whole payload
  applied or none of it did.

The "location deleted underneath an in-flight reorder" case belongs to **2B's**
test suite, not 2A's: the trigger that rewrites ranks on delete does not exist
until 2B, so 2A cannot exercise it.

*2A.4 - one pack-rank bound, shared by everything.*

Revision 5 guarded the trigger at SQLite's signed 64-bit ceiling and parking at
`Number.MAX_SAFE_INTEGER`, which are two different bounds, and **both are wrong**
because the request schema is stricter than either: `packSortOrder` uses
`sortOrderSchema`, capped at 1,000,000,000 (`shared/lists.ts:24`, used at
`:294`). Ranks grow monotonically as locations are deleted (`base + source_rank`),
so repeated deletes can store a rank **the client can never submit back** - a
list that silently becomes un-reorderable, with every layer individually
believing it is fine. Above `Number.MAX_SAFE_INTEGER` D1 reads are imprecise as
well, since it does not support BigInt. And the remote audit as specified checks
only negatives and duplicates, so it would certify such a list as clean.

So: **one exported constant, `PACK_RANK_MAX = 1_000_000_000`**, referenced by
the request schema, every writer, the migration audit, and the delete trigger.
Well inside `MAX_SAFE_INTEGER`, and identical to what the API already accepts.

**`packSortOrder` needs its own schema, not `sortOrderSchema`.** Audited every
writer of `pack_sort_order` in `server/repos`, and two things came out of it:

- `reorderPackListItemsRequestSchema` (`shared/lists.ts:294`) reuses
  `sortOrderSchema`, which is `min(-1_000_000_000)`. So a client can submit a
  **negative** `packSortOrder` today. The permutation check happens to reject it
  because committed ranks are nonnegative - but once 2A's enforcement trigger
  exists, any path that got past that check would `RAISE(ABORT)` and surface as
  a **500 where a 400 is correct**. Add `packRankSchema =
  z.number().int().min(0).max(PACK_RANK_MAX)` and use it for `packSortOrder`
  everywhere. `sortOrder` keeps its own signed schema; the two limits are
  different contracts that happen to share a magnitude, which PR 7.1 says not to
  merge.
- `lists.ts:641` copies `item.sortOrder` straight into `packSortOrder` on
  import, and `importListItemSchema` allows `0 .. 1_000_000_000`. So a row at
  **exactly `PACK_RANK_MAX` is reachable in production through a normal import**
  - the delete-trigger case that motivated dropping offsetting is real, not
  synthetic. It is also already compatible with the strict INSERT cap, since
  import's own bound is the same number.

And **compact rather than abort.** Aborting a list or account deletion because
ranks ran out of headroom is a worse outcome than the bug being fixed - it would
make P0.1 fail differently instead of working. When the delete trigger's
arithmetic would exceed `PACK_RANK_MAX`, the orphans are renumbered densely from
the destination maximum (order preserved, gaps discarded) instead of offset by a
base. Gap preservation is a nicety; being able to delete your list is not.

Extend the audit's third query accordingly: any row with
`pack_sort_order > PACK_RANK_MAX` is dirty and blocks the deploy alongside
negatives and duplicates.

2A ships as one PR (four commits: tighten settle, move parking, add the abort
guard, unify the bound) and **remains correct if 2B never ships**: 2A.1 is a
strict tightening, and 2A.2/2A.3/2A.4 depend on nothing 2B adds. It carries a
migration for `_pack_reorder_guard`, so it is a deploy and needs approval.

**Release 2B - audit, enforcement, delete fix.**

1. **The remote audit, with a home and an abort path.** Revision 4 called this
   a "hard precondition" without saying where it runs, which made it
   unimplementable: CI holds no remote D1 credentials, and putting it in
   `deploy.yml` runs it *after* merge and after deploy approval - so a dirty
   result would strand `main` at 2B while production sat at 2A, with no defined
   way back. It runs in two places instead, and neither is `deploy.yml`'s
   migration step alone:

   - **Pre-merge, human-run, read-only.** The `audit-pack-ranks.yml` workflow
     landed by **PR 1.3** (see Phase 1 - it must already be on the default
     branch, or it cannot be dispatched to gate its own merge). It runs three
     queries against remote D1: `pack_sort_order < 0`,
     `pack_sort_order > PACK_RANK_MAX`, and a duplicate-rank probe over each
     list's Unassigned cohort. All three must return zero. This is the gate:
     **2B is not approved for merge until this run is green against the exact
     SHA being merged.** There is no GitHub Environment reviewer gate - see
     PR 1.3 for why that mechanism is unavailable here and what replaces it.
   - **Again inside `deploy.yml`, immediately before `migrations apply`,** as a
     fail-closed re-check. The window between audit and deploy is small but
     nonzero, and the enforcement trigger would otherwise turn dirty data into
     a failed migration mid-deploy.

   **Abort path, stated so it is not improvised under pressure.** If the
   in-deploy re-check finds dirty rows it exits non-zero *before* any remote
   mutation. Production keeps running 2A code against the 2A schema, which is
   correct and self-consistent - the only cost is that `main` is ahead. Recovery
   is: revert the 2B merge on `main` (restoring the deployed state), clean the
   offending rows through an approved one-off remote write, re-run the
   pre-merge audit, then re-land 2B. Production is never left mid-migration,
   because the check precedes the first mutation.

2. **Not the range triggers.** They belong to **2A**, which is where the guard
   that depends on them lives. Revision 6 listed them here, which read as 2A
   shipping a count guard before the mechanism that reserves what it counts.
   To be unambiguous: **2A owns** the two asymmetric range triggers,
   `_pack_reorder_guard`, their schema definitions, the `TRANSIENT_TABLES`
   mechanism, and their tests. **2B owns** only the audit gate, the delete
   helper table, the delete trigger, and its own `TRANSIENT_TABLES` entry.
3. The delete helper table and delete trigger above.
4. **Migration-safety harness changes.** Revision 4 said "add all three to the
   fixtures", which cannot be done as written. `check-migration-safety.mjs:1358`
   fails any new table without a fixture row, but
   `_packing_location_delete_state` is correct only when **empty** - seeding it
   asserts an impossible persistent state, and keying that seed to the
   packing-location fixture risks a primary-key collision. Renaming it to a
   `__` prefix does not escape either: `isScratchTable` at `:100` would then
   fail it as "scratch table left behind". Both names fail. And triggers are
   schema objects that a fixture row cannot represent at all.

   So the harness gains an explicit **declared-transient-table** mechanism: a
   `TRANSIENT_TABLES` list whose entries are exempt from the fixture
   requirement, and which the harness instead asserts (a) exist after
   migration and (b) hold zero rows. The two enforcement triggers and the
   delete trigger are verified through `POST_CHECKS` probes and the cascade
   matrix above, not through fixtures.

   **The mechanism itself lands in 2A** (which introduces the first transient
   table); 2B only appends `_packing_location_delete_state` to the list.

   The exemption is deliberately narrow, because the fixture requirement exists
   to catch cascade damage and a blanket exemption would punch a hole in
   exactly that. A `TRANSIENT_TABLES` entry is exempt **only** from needing a
   seeded row; it is still enumerated, still asserted to exist, and still
   asserted empty. Every other table's fixture, and the rebuild and cascade
   detection over `list_items` and friends, is untouched - so a future
   migration that rebuilt `list_items` would still be caught by
   `list_items`' own fixture, not hidden by this exemption.

Additive throughout: no `list_items` rebuild.

### Verified matrix

Tested against the repo's real 19 migrations with `foreign_keys = ON`. Every
row must be in the suite.

| Case | Result |
| --- | --- |
| List delete, basic collision | passes |
| Account delete | passes |
| Empty destination cohort | ranks `[0,1]` |
| Multiple locations, one cascade | ranks `[0,1,2,3,4]` |
| Worn rows reserving ranks | ranks `[0,1,2]`, worn slot respected |
| Item-backed container deleted | ranks `[0,1]` |
| Gear backing a container deleted | ranks `[0,1]` |
| Nested containers | passes |
| Sparse source `0,2,7` | ranks `[0,1,3,8]` - gaps preserved |
| Sparse destination and source | ranks `[0,9,10,13]` |
| Empty location (`WHEN EXISTS` false) | no-op, helper table untouched |
| Coexists with `packingLocations.remove()` | no double re-ranking |
| Insert negative rank | rejected by enforcement trigger |
| Update to negative rank | rejected by enforcement trigger |
| Control: same fixture, no trigger | correctly fails |

Two things the tests must encode rather than paper over:

- For whole-list and account deletion the surviving cohort is empty, so a
  cohort assertion **passes vacuously**. The meaningful assertion there is that
  the delete succeeded and the rows are gone.
- Container-path fixtures need **three** rows (surviving Unassigned row,
  separate backing item, content in the backed location). A two-row fixture
  passes without the fix, because deleting the backing item frees its own rank
  first. Verified: `2-row container fixture (no fix applied) -> PASSES VACUOUSLY`.
  Assert raw pre-delete state so a later edit cannot restore the vacuous shape.

Also assert the helper table is empty after every delete, and that a failed
delete leaves parent and children unchanged.

**Every case in this matrix is single-threaded**, which is precisely why it
passed revision 4's unsafe Release 2A design without complaint. A matrix of
sequential cases cannot see a concurrency defect. The barrier tests specified
in Release 2A are not optional extras to these rows; they cover the failure
class this table structurally cannot reach.

### Concurrency

D1 executes a batch as an atomic transaction and serializes writes, so a
delete and a reorder in separate batches cannot observe each other's
intermediate state. The one way to break this is to compose park, delete, and
settle into a **single** batch. The repo does not do that today and must not
start; note it beside the trigger.

**Human gate:** **both** releases ship a migration - 2A for
`_pack_reorder_guard`, 2B for the helper table and triggers - so both need
explicit deploy approval. Revision 5 gated only 2B, on the since-corrected
belief that 2A was schema-free.

---

## Phase 3 - Expand/contract as an enforceable control

"Declares a multi-release plan" is unenforceable - a prose file would satisfy
it. **Until a machine-verifiable protocol exists, fail every drop, rebuild, and
rename migration with no exception.**

The protocol that lifts the block:

- A versioned migration manifest. A migration marked `contract` must reference
  an already-landed `expand` ancestor by id, and CI verifies that ancestor
  shipped in a *prior* release.
- Compatibility tests in both directions: old-code/new-schema and
  new-code/expanded-schema.
- The "boot the base revision's Worker against the migrated schema" check
  becomes required for `contract` migrations.

Document in AGENTS.md beside the existing migration traps.

---

## Phase 4 - Client failure states and observability

- **PR 4.1 (P1.1)** - destructure `isError` in `ListDetailPage.tsx`; treat
  `isError && data === undefined` as its own state rendering `ListDetailStatus`
  with the existing `onRetry`, not the "List not found" branch. Add
  `&& !listsError` to the self-heal effect so a transient failure cannot call
  `clearLastListPath()`. Same for `ListsPage.tsx` and `DesktopListsPanel.tsx`.
- **PR 4.2** - expose a discriminated `{status, data}` from `useReorderable`
  and the page-level queries so an unhandled error branch is a type error.
- **PR 4.3 (P1.2)** - `qc.clear()` and `clearLastListPath()` in `useSignOut`,
  or a full-document navigation as the other two paths use.
- **PR 4.4 (P1.4)** - `app.onError` logging `{path, method, status, error}` and
  returning a correlation id in the uniform `{error}` shape. Fix
  `fresh-auth.ts:58-64`, which returns `{code, message}`. Add `mutationKey`s.
- **PR 4.5 (P1.5)** - single 401 policy in `rawFetch`.
- **PR 4.6** - `meta.errorToast` on gear mutations and `saveError` into
  `GearItemDialog` on `GearLibraryPage`.

---

## Phase 5 - Correctness batch

- **PR 5.1 (P2.1)** - `anyItemReorderPending` at all five consumer sites.
- **PR 5.2 (P2.2)** - the named test gaps: `makeOptimisticPackReorder`; the 409
  path both sides; the 200-food-item cap at the boundary;
  `isAnyUniqueViolation` and `isForeignKeyViolation`; the four missing food
  anon/401 tests; `next*SortOrder` against a sparse sequence. Fix the
  `db-errors.ts:44-48` comment/code mismatch. **Plus the item revision 4
  dropped:** pin request-side URL and method drift for the 24 client functions
  across `lists.ts`, `list-items.ts`, and `food.ts`. These are mocked at the
  fetcher today, so a wrong path or verb is invisible to every existing test.
- **PR 5.3** - correct the three overstated `docs/authz-matrix.md` rows.
- **PR 5.4 (P2.5)** - 409 from `listItems.update()` via a `conflict` branch.
- **PR 5.5 (P2.9)** - apply `isForeignKeyViolation` where a precheck race
  yields a 500.
- **PR 5.6 (P2.4)** - hoist `requireSession` to `api.use('/lists/*', ...)`.
- **PR 5.7 (P2.6)** - `chunkForParamCap` divisor from
  `getTableColumns(table).length`.
- **PR 5.8 (P2.7)** - lower `importGearRequestSchema` maxima to real caps.
- **PR 5.9 (P2.3)** - categories cap: trigger, 422, shared constant, boundary
  tests, matrix row, migration fixture. Human gate.
- **PR 5.10 (P2.8)** - migration checker compares CHECK and FOREIGN KEY clauses
  against an explicit declared-drop list.
- **PR 5.11 (P2.13)** - make response DTOs strict where additive drift should
  fail. Response schemas are plain `z.object(...)`, so `src/lib/api.ts:45-52`
  rejects missing or wrong fields but Zod silently **strips** unexpected ones -
  narrower than the documented "shape drift fails CI". Use `.strict()` on
  response schemas, and validate the share response at the server boundary as
  well as the client, since client-side validation after receipt cannot prevent
  a wire-level leak. Correct the over-broad claim in the comment.
- **PR 5.12 (P2.11)** - canonicalize auth paths and make `requireFreshAuth`
  deny-by-default. `fresh-auth.ts:48` and `rate-limit.ts:119-135` match on
  `c.req.path`; better-auth re-derives from `new URL().pathname`, and these
  differ on dot segments. Use `new URL(c.req.raw.url).pathname` in both, and
  invert `GATED_PATHS` to an `UNGATED` allowlist so a future passkey-plugin
  endpoint fails closed instead of shipping ungated. **Scheduled
  unconditionally**, not contingent on the portability decision: it is fail-safe
  on workerd today only by platform behavior no test can express, and the
  deny-by-default inversion is a security improvement on its own.
- **PR 5.13 (P2.10)** - rotate the share slug on re-share. Decided 2026-08-01.
  Today a distributed link is permanent: unsharing only flips the gate, and
  re-sharing reactivates every link ever sent.

  Rotate on the `isShared` false->true transition in `lists.update`, reusing
  the existing `generateSlug()` and its unique-retry loop. The slug stays
  stable for as long as a list remains shared, so a link that is working does
  not break under the owner; only toggling sharing back on mints a new one.

  **No change to the slug generator.** It stays 6-char base62
  (`lists.ts:113-127`). Rotation is the whole fix - a slug you dislike is
  replaced by toggling.

  Tests: re-sharing yields a different slug; the old slug 404s; the slug does
  not change on an unrelated `PATCH`; and it does not change while `isShared`
  stays true.

---

## Phase 6 - Browser/E2E layer (P1.3)

Small and deliberate: magic-link sign-in end to end; passkey registration and
authentication with a virtual authenticator; create and edit a list; a public
share read; one mobile/keyboard packing action. Against the built app and the
real local Worker/D1 path, as a separate CI job.

---

## Phase 7 - Hygiene

- **PR 7.1 (P3.1) - caps.** Keep distinct constants for distinct semantic
  limits even when values match; only merge genuine duplicates of the same
  contract. Interpolate cap numbers into API error strings. Verification is
  behavioral: query the migrated schema and exercise each boundary through the
  production API path (owner scope, atomic rejection, 100-parameter behavior),
  then grep proving every intended site moved.
- **PR 7.2 (P3.2)** - extract the gear DTO mapper; keep field-by-field mapping.
- **PR 7.3 (P3.3)** - typed `parseBody(c, schema)` preserving the uniform 400.
- **PR 7.4 (P3.5, P3.6)** - delete dead code and Supabase-era comments,
  including the duplicated `gearKey()` and the contradicting headers.
- **PR 7.5 (P3.8)** - `no-misused-promises`; `--max-warnings 0`; the
  `src/** -> server/**` restriction; machine-check route/matrix coverage.
  **Plus the item revision 4 dropped:** coverage collection and a threshold in
  CI. Turn on V8 coverage in both vitest configs and set the initial threshold
  at the **current measured level, not an aspirational one** - the point is a
  ratchet that catches regressions, and a threshold the suite fails on day one
  just gets deleted.
- **PR 7.6 (P3.9)** - documentation sweep; generate STACK.md's table from
  `package.json`; CI step grepping backticked paths in AGENTS.md. **Plus the
  two items revision 4 left open:**
  - **US-spelling cleanup**, which revision 4 omitted entirely: the six
    `cancelled` occurrences in user-facing strings become `canceled`.
  - **The ASCII rule - DECIDED, not deferred.** Revision 4 said "decide the
    ASCII rule"; leaving a decision in a plan is what got revisions 1-3
    blocked. The rule stands and becomes lint-enforced, because 1237 violations
    across 77 files is evidence of an unenforced rule, not of a wrong one.
    Scope it to where AGENTS.md actually claims it - **code, comments, and
    commit messages** - via a CI check over `server/**`, `src/**`, `shared/**`,
    `scripts/**`, and `migrations/**`. Markdown prose is **carved out
    explicitly**, since the rule never claimed it and the tables in these
    review docs would fail it. Fix the in-scope violations in the same PR, or
    the check lands red.
- **PR 7.7 (P3.7)** - button primitive.
- **PR 7.10** - extract the food block from `ListDetailPage.tsx` into
  `useListFood(listId)`: the query, the five mutations, `invalidateFood`,
  `foodBusy`, and `foodGrams`. Pure refactor, no behavior change, tests
  unchanged. Removes roughly 15% of the file and gives the food work from N1 a
  home that is not a 2217-line component.
- **PR 7.8 (P3.10)** - require a matching `Origin`; `object-src 'none'`;
  `workers_dev: false`; sweeper for expired `verification` rows. **Plus the two
  items revision 4 left open:**
  - **Rate-limit `GET /api/shares/:slug` and `/api/health`,** which revision 4
    omitted. Both are unmetered and anonymous; the share route is the app's
    only unauthenticated data-returning endpoint. Add budgets in
    `server/middleware/rate-limit.ts` (per-IP, generous enough that a normal
    share view never trips) and matrix rows for both.
  - **`Cache-Control` - DECIDED, with a rollout that actually reaches existing
    shares.** Share responses get `Cache-Control: private, no-store`, because
    unsharing flips the gate but a cache holding a prior 200 would keep serving
    list contents after revocation.

    Revision 5 claimed PR 5.13's slug rotation made the rollout safe. **That was
    false.** 5.13 rotates only on a future `false -> true` transition, so a list
    that is already shared keeps its slug, keeps its URL, and keeps any cached
    200 with its old policy - forever. This is precisely the AGENTS.md trap: a
    `304` carries no `Cache-Control`, so the stored entry keeps the old policy
    and the change is a total no-op for exactly the users who already have the
    link.

    The rollout is therefore a **URL change that costs nobody a link**: bump the
    internal API path to `/api/shares/v2/:slug`. The client fetches
    `/shares/${slug}` (`src/lib/queries/lists.ts:92`) while the link people
    actually hold is `/r/:slug`, so changing the API path changes the cache key
    while **every distributed share link keeps working**. No mass slug rotation,
    no broken links, no approval needed for a destructive migration.

    **Remove the old `/api/shares/:slug` route rather than leaving it mounted.**
    Leaving it would keep serving cacheable responses and defeat the whole fix.
    The only client of it is the SPA, and the SPA is served with the bundle, so
    a stale bundle calling the old path gets a 404 and reloads - acceptable
    under PR 7.9's already-accepted "stale open tabs are not supported".

    Test the case that motivated this: a pre-policy cached 200, then an unshare,
    then assert the content is no longer served.

- **PR 7.9 (P3.4) - retire the dead flags.** Decided 2026-07-31: remove them,
  no compatibility staging. Open tabs running an older bundle are explicitly
  not supported; this was overdue and the staging analysis was over-engineering
  for a single-user app.
  - Stop accepting `readyChecksEnabled` on PATCH and stop returning it. Remove
    it from `shared/lists.ts` (it is currently required at `:41`), the route
    mapping, the export and duplicate paths, and the `CategoryGroup`/`ItemRow`
    props that are always fed a literal `true`.
  - Remove `groupWorn` from the public share DTO (`routes/shares.ts:35`) and
    delete the false rationale at `shared/lists.ts:222` that claims the share
    view honors it, which `SharePage.tsx:159-161` contradicts. Re-assert the
    exact allowlist on raw JSON in `shares.test.ts`.
  - `groupWorn` goes fully, not just from the public projection: stop accepting
    it on PATCH and stop returning it on the authenticated list DTO too. No
    component reads it, so there is nothing to preserve.
  - **Keep both physical columns.** That is unrelated to client compatibility:
    dropping a column means a `lists` table rebuild, and on D1 that fires
    cascades and deletes every `list_items` row. Leave the columns; retire the
    concept.

---

## Resolved items that were previously blocked

### N1. RESOLVED 2026-07-31 - food destructive-write race (P1.6)

Was blocked on: whether a single `db.batch` can gate destructive statements on
an expected revision, given that a conditional UPDATE matching zero rows does
**not** abort later statements and batch statements cannot branch on an earlier
result.

**Prototyped and solved.** The guard must fail loudly rather than match zero
rows. A guard table with a `NOT NULL` column fed a subquery that yields NULL on
mismatch makes D1 roll the whole batch back:

```sql
create table _food_cas_guard (list_id text primary key, ok integer not null);
```

The batch a destructive food write sends. **Revision 4's version of this block
named `food_slots` and `day`, neither of which exists** - the table is
`list_food_slots` and the column is `day_number` - and it filtered on `list_id`
alone, dropping the `user_id` predicate that every other query in
`server/repos/food.ts` carries. Both are corrected here; the ownership
predicate is not optional, because these statements are built inside the
user-scoped repository and dropping `user_id` would weaken the session-scoped
query construction that is the app's whole authorization boundary:

```sql
-- 1. CAS guard: NULL (-> NOT NULL violation -> whole batch aborts) on mismatch.
insert into _food_cas_guard (list_id, ok)
select :listId, (select 1 from lists
                  where id = :listId and user_id = :userId
                    and food_revision = :expected);
-- 2. Bump, gated on the same expectation.
update lists set food_revision = food_revision + 1
 where id = :listId and user_id = :userId and food_revision = :expected;
-- 3. The destructive statement(s).
delete from list_food_slots
 where list_id = :listId and user_id = :userId and day_number > :keepDays;
-- 4. Clean up the guard row.
delete from _food_cas_guard where list_id = :listId;
```

Two construction constraints, both from AGENTS.md traps:

- Statement 1 is raw SQL and **must ride a Drizzle builder** -
  `db.insert(_foodCasGuard).select(sql\`...\`)` - because `db.run(sql)`
  typechecks as a batch item and then crashes the D1 driver at runtime. Write
  identifiers inside the fragment by hand so the unqualified-rendering trap
  cannot reach them.
- `_food_cas_guard` is transient in exactly the same way as
  `_packing_location_delete_state`, so it goes in the harness's
  `TRANSIENT_TABLES` list from Release 2B, not in `FIXTURES`.

Statement 4's unreachability on the failure path is **not** a leak: D1 rolls the
whole batch back on statement failure, so statement 1's insert is rolled back
with it and no guard row survives to collide with the next write's primary key.
Verify this in the test suite rather than trusting it.

Verified behavior:

| Case | Result |
| --- | --- |
| Expected revision matches | commits; revision bumps; trim applies |
| Stale revision | aborts with `NOT NULL constraint failed: _food_cas_guard.ok`; nothing deleted |
| Other tab adds food, then this client trims | aborts; the other tab's work is preserved |
| Control: conditional UPDATE only, no guard | **commits and destroys the data** - this is the current bug |

**Scheduled as Phase 8**, in two releases for the rollout window Codex flagged
(after the column ships but before the new Worker is live, the old Worker would
mutate food without bumping the revision):

- **Release 8A** - add `lists.food_revision` (additive) and make **every**
  food mutation bump it. No CAS enforcement yet, so old and new Workers both
  behave correctly and the column is trustworthy by the time anything reads it.
- **Release 8B** - add the guard table, send the expected revision from the
  client on destructive writes, and enforce the CAS in the batch. Map the
  guard's NOT NULL violation to **409** with an impact DTO (what would be
  removed) via a new matcher in `server/repos/db-errors.ts` - it must not become
  a 500. The client consumes the 409 as control flow: refetch, recompute impact,
  reconfirm. It must **not** raise the generic error toast and must not auto
  retry, so these mutations need an explicit exemption from
  `mutation-error-handler.ts`.

Tests: a barrier-driven two-client API test that interleaves a write immediately
before the batch (not merely a stale snapshot); a component test for
refetch-and-reconfirm; a test that a 409 raises no generic toast; and the
control above proving the unguarded form loses data. Remove the "KNOWN GAP"
comment at `FoodSection.tsx:149-155` when it lands.

Same treatment applies to marking a populated slot not needed
(`FoodSection.tsx:225-242`, `server/repos/food.ts:211-263`).

### N2. RESOLVED 2026-07-31 - retire the dead flags, no staging

Was: whether to stage the removal of `readyChecksEnabled` to protect browser
tabs loaded before the change.

Decision: **remove them.** Stale open tabs are explicitly not supported. The
staging analysis was over-engineering for an app with one user, and the
retirement was already overdue. Moved to PR 7.9.

The known consequence, accepted: a tab running a pre-removal bundle will reject
`/api/lists` responses until it is reloaded.

---

## Open decisions - all resolved

Five decisions, all reversible, so all decided rather than parked. Three were
resolved 2026-07-31 and are recorded below; the two revision 4 left as "decide"
and "consider" were resolved 2026-08-01 and are recorded inline at PR 7.6 (the
ASCII rule: keep it, scope it to code/comments/commit messages, lint-enforce
it, carve out Markdown) and PR 7.8 (`Cache-Control: private, no-store` on share
responses).

1. **Node/SQLite portability (P2.12) - DECIDED: D1 is the stack. Drop the
   portability claims from the docs.** Owner decision 2026-08-01: "keep our
   docs on D1. If we leave D1, we change our code. No plans to do that."

   No code changes. This is a documentation correction only. `README.md:3-6`
   and `REWRITE_PLAN.md:168-172` currently describe a Node + SQLite deployment
   as an available, proven exit hatch. It is not one: `server/db/index.ts`
   accepts only `D1Database`, there are 23 D1-specific `db.batch` call sites,
   and there is no Node entry point, SQLite driver, migration runner, or
   Node-target test. Those sentences get removed rather than softened, and the
   docs state D1 as the stack.

   Kept deliberately: AGENTS.md's "If this ever moves off D1" pragma notes
   (`foreign_keys`, `busy_timeout`, `journal_mode`, `synchronous`). That is
   hard-won correctness knowledge, it costs nothing to retain, and it is
   written as a conditional rather than a promise. It stays as a footnote, not
   as a capability claim.

   Covered by PR 7.6.
   - Consequence handled: P2.11 does not hang on this. It is scheduled
     unconditionally as PR 5.12, because the auth-path gate is currently
     fail-safe only through workerd behavior that no test can express, and the
     deny-by-default inversion is worth doing on its own.
2. **Share link revocation (P2.10) - DECIDED: rotate the slug.** Scheduled as
   PR 5.13. Small, self-contained, and it removes the only permanently
   un-revocable thing the app exposes.
3. **`ListDetailPage` decomposition - DECIDED: extract the food block only.**
   Scheduled as PR 7.10. Query, five mutations, `foodBusy`, and `foodGrams`
   lift cleanly into `useListFood(listId)` with no coupling to DnD, dialogs, or
   modes, and remove roughly 15% of a 2217-line file. Deeper decomposition (a
   packing/placement controller, a detail-query gate) is deferred until a
   feature forces it - churn without a driver is not worth it.

---

## Coverage: every finding, mapped to a PR

Revision 4 asserted that every finding was scheduled. Four were not. This table
replaces the assertion, so the claim can be checked instead of believed.

| ID | Where it is handled |
| --- | --- |
| P0.1 | Phase 2, Releases 2A and 2B |
| P0.2 | Phase 1, PRs 1.1-1.3 (gating half); Phase 3 (ordering half) |
| P1.1 | PR 4.1 |
| P1.2 | PR 4.3 |
| P1.3 | Phase 6 |
| P1.4 | PR 4.4 |
| P1.5 | PR 4.5 |
| P1.6 | Phase 8, Releases 8A and 8B |
| P2.1 | PR 5.1 |
| P2.2 | PR 5.2, including the URL/method contract tests |
| P2.3 | PR 5.9 |
| P2.4 | PR 5.6 |
| P2.5 | PR 5.4 |
| P2.6 | PR 5.7 |
| P2.7 | PR 5.8 |
| P2.8 | PR 5.10 |
| P2.9 | PR 5.5 |
| P2.10 | PR 5.13 |
| P2.11 | PR 5.12 |
| P2.12 | PR 7.6 (documentation only; decided) |
| P2.13 | PR 5.11 |
| P3.1 | PR 7.1 |
| P3.2 | PR 7.2 |
| P3.3 | PR 7.3 |
| P3.4 | PR 7.9 |
| P3.5 | PR 7.4 |
| P3.6 | PR 7.4 |
| P3.7 | PR 7.7 |
| P3.8 | PR 7.5, including coverage collection and threshold |
| P3.9 | PR 7.6, including US spelling and the decided ASCII rule |
| P3.10 | PR 7.8 and PR 1.2, including the unmetered endpoints and the decided `Cache-Control` |

Items with no finding ID, added because the work needs a home: PR 4.2
(discriminated query state), PR 4.6 (gear save errors), PR 5.3 (authz-matrix
corrections), PR 7.10 (`useListFood` extraction).

## What this plan deliberately does not do

- No rewrite of any subsystem. Both reviews concluded the architecture is sound.
- No new features.
- No change to the authorization model, which both reviews verified holds.
- No collapsing of deliberate duplication into generic abstractions.
