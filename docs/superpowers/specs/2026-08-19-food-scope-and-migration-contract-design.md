# Food scope-back, and reopening column drops

Status: PROPOSED
Date: 2026-08-19
Scope: four sequenced PRs. Items 2-4 are a migration-workflow change and are
independent of item 1 except for the deploy ordering noted in item 4.

## 1. Why

Two separate findings from an audit of the food feature, asked for as "make
sure food is only a multiplier for meals, and find leftover cruft".

**Food.** The model is already correct - an item is name + weight + quantity +
per-meal-or-shared, scheduled into day x meal slots, and the pack weight and
Pack mode derive from it. One planner-shaped feature survives: the `needed`
flag on a slot, which drives a "Nothing planned" warning and a Skip button
whose only job is to silence that warning. Neither reaches a weight or the
packing list. Joe's decision: cut both.

**Migrations.** AGENTS.md bans every drop, rebuild and rename in a new
migration. That rule conflates two unrelated operations, and the evidence is
below. It also turns out the Drizzle snapshot chain has been broken since
migration 0021, which makes the clean path to any schema change unusable.

## 2. Evidence

Executed 2026-08-19 against **local sqlite3 3.46.1** and a scratch **local**
D1 with every migration applied. Stated precisely because the earlier draft of
this line said "not reasoned about", which overstated it: nothing here was run
against production D1, and the D1 half of the claim rests on documented SQLite
semantics that Cloudflare's engine inherits, not on a remote test. A remote
scratch-D1 rehearsal was considered and declined: if D1's SQLite were too old
it would REJECT the syntax, so the failure is a red deploy with the
transaction rolled back - loud and recoverable, which is the opposite of the
silent cascade wipe the blanket rule exists to prevent.

**A column drop does not fire cascades.** Parent + child on ON DELETE CASCADE,
`PRAGMA foreign_keys=ON`, drop inside a transaction (D1's exact conditions):
the child row survives and the column is gone. `ALTER TABLE ... DROP COLUMN`
issues no `DROP TABLE`, so there is nothing for a cascade to hang off. Say
"not a `DROP TABLE` rebuild" rather than "not a rebuild": SQLite does
physically rewrite every row of the table to remove the field. It just never
drops it, and only `DROP TABLE` performs the implicit delete that fires
`ON DELETE` actions. The row rewrite has its own operational limit - D1 caps a
single query at 30 seconds - which is irrelevant at this app's table sizes and
would become relevant at a size worth measuring first. The
migration 0009 wipe came from drizzle-kit's 12-step rebuild
(`CREATE __new_x; copy; DROP x; RENAME`), where the `DROP TABLE` is the
mechanism. Rebuilds remain genuinely dangerous on D1; column drops were never
the same operation.

**A column a trigger references cannot be dropped silently.** SQLite raises
`error in trigger ... no such column` and rolls the transaction back. Loud
failure, not corruption. The trigger is dropped first.

**drizzle-kit emits a plain ALTER for a column drop.** Removing `groupWorn`
from the schema and generating produced exactly
`ALTER TABLE \`lists\` DROP COLUMN \`group_worn\`;` - no rebuild.

**The snapshot chain is broken.** `migrations/meta/` holds snapshots through
0020; `_journal.json` registers 25 migrations through 0024. 0018 and 0021-0024
were authored by hand and their snapshots never regenerated. Consequence:
`drizzle-kit generate` today emits a migration re-creating `_food_rank_repair`,
`_food_pack_reorder_guard`, `_food_location_delete_state` and re-adding five
columns to `list_food_items` - all of which a scratch D1 with every migration
applied confirms already exist. That migration would fail on D1 with
`duplicate column name`. AGENTS.md says Drizzle snapshots are regenerated and
never hand-edited; that has not been true for four migrations, and nothing
noticed because nobody has run `generate` since.

**The reason that survives.** `deploy.yml` applies migrations and THEN deploys
the Worker, so between the two - indefinitely if `wrangler deploy` fails -
production runs the OLD Worker against the NEW schema. A column dropped in the
same release that removed its reads breaks live requests in that window. This
is real, and it is what expand/contract exists for: remove reads in release A,
drop the object in release B.

**Production holds two skipped slots.** `select count(*) from
list_food_slots where needed = 0` returned 2 on 2026-08-19. The hostile state
below is therefore real, not hypothetical, and the sequencing has to survive
it. The backfill flips those two meals back to needed - a real edit to real
data, invisible in the new UI because a skipped meal and an empty meal render
identically once the badge is gone.

## 3. Item 1 - Food scope-back

**Behavior.** A meal slot with no food shows `+ Add` and nothing else. No Skip,
no Restore, no amber "Nothing planned", no confirm dialog about unscheduling.
The header's derived meal counts ("3 breakfasts - 3 lunches - 3 dinners") go
too: with skipping gone they are always the day count three times.

Unchanged: trip length, the day x meal grid, per-day slots, the add form,
Carrying with quantity and per-meal/shared, food in Pack mode, the share
projection, `foodUnitCount`.

**Removals.**

- Client: the Skip/Restore button, the "Nothing planned" badge and its confirm
  dialog (`FoodDaySection.tsx`); `foodSlotMut`, `losesWorkBelow`'s `!needed`
  clause, the `neededSlots` filtering and the counts eyebrow
  (`FoodView.tsx`); `setFoodSlotNeeded` (`src/lib/queries/food.ts`).
- Server: `PATCH /api/lists/:id/food/slots/:slotId` and `setSlotNeeded`
  (`server/routes/food.ts`, `server/repos/food.ts`); the "slot must currently
  be needed" condition on item creation.
- Contract: `needed` off `foodSlotResponseSchema`; `updateFoodSlotRequestSchema`
  deleted; `needed` off the food export, `FOOD_JSON_VERSION` -> 3.
- Docs: the `/food/slots/:slotId` row leaves `docs/authz-matrix.md`; the `/food`
  GET and `/food/days` rows lose their `needed` language; SECURITY.md's food
  destruction gap goes from four vectors to three.

**Migration 0025 (data only).** `UPDATE list_food_slots SET needed = 1 WHERE
needed <> 1`.

This is load-bearing, not tidying. The `list_food_item_slots_needed_only`
trigger (migration 0017) refuses to associate food with a slot where
`needed = 0`. With the Skip button gone, any slot already marked skipped in
production would silently reject food with no way to fix it and no explanation
on screen. The backfill is what makes the trigger inert rather than hostile.
It is a row update, not DDL, so the destructive-DDL gate is not involved. The
rewrite must be declared in `EXPECTED_CHANGES` in
`scripts/check-migration-safety.mjs`, whose fixture deliberately seeds a
`needed = 0` slot.

**Cruft fixed in the same PR** (each is a factually wrong statement in a
maintained file, so it belongs to the change that makes it wrong):

- `src/lists/list-detail-mode.ts` claims the Food view tracks "dietary needs,
  preferences, restrictions, and meal planning". None of that exists.
- `src/lists/PackingProgress.tsx:13` has a dangling half-sentence, "is 0 until
  a plan is attached", left over from the deleted planner.
- `SECURITY.md` cites `src/lists/FoodView.tsx:343`; the comment is at 391.

**Out of scope, stated so it is not re-litigated:** the day grid, per-day
slots, per-meal vs shared, food in Pack mode, the share projection, the
`food_revision` concurrency gap, and `docs/food-planning-design.md` (kept -
banner-marked, inert, covered by the dated-records rule).

## 4. Item 2 - Repair the snapshot chain

Ships before item 4 and ideally before item 1, so every later migration is
generated against a truthful basis.

**Mechanism, verified 2026-08-19.** `drizzle-kit generate --custom` does NOT
work: it copies the previous snapshot forward, preserving the drift. A real
`generate` writes a snapshot matching the current schema (confirmed: 14
columns on `list_food_items`, all five scratch tables) alongside SQL that
re-adds objects that already exist. So:

1. `npx drizzle-kit generate --name snapshot_realign`.
2. Keep the generated snapshot and journal entry untouched.
3. Replace the generated SQL body with a comment recording that this migration
   is intentionally empty and why. The SQL file is ours to author in this repo
   (0021 and 0024 are fully hand-written); the SNAPSHOT is the generated
   artifact and is not edited.
4. Confirm the repair: a second `generate` must report "No schema changes,
   nothing to migrate". Verified working.

The end state the snapshot claims is real - migrations 0021-0024 created it.
The chain becomes truthful about where the schema is, which is the only thing
a snapshot is for.

**`generate --custom` is the right tool for a DATA-ONLY migration**, and the
finding above is narrower than it first looks: `--custom` copies the previous
snapshot forward, which is WRONG for repairing drift and exactly RIGHT when the
schema genuinely has not changed. Both statements hold; the backfill in item 1
uses `--custom`.

**Recurrence is checked mechanically in two layers.**
`scripts/check-migration-safety.mjs` never looked at `migrations/meta`, which is
why this rotted in silence for four migrations. It now runs
`verifySnapshotChainIntact()`, which fails if any journal entry from 0025 on
lacks its snapshot, if the NEWEST entry lacks one (the case that actually
breaks `generate`), or if a `.sql` file is missing from the journal (the case
that makes the next `generate` reuse a number). The five historical gaps -
0018 and 0021-0024 - are a frozen exemption, because a snapshot describes the
schema as of its migration and reconstructing one after the fact would be
fabricating a record. Both failure directions are proven by removing a snapshot
and by adding an unregistered `.sql`, not just asserted.

**Verification is no longer circular.** A second clean `generate` proves only
that the snapshot matches `app-schema.ts`. The snapshot was additionally
compared field by field against a scratch D1 with all 26 migrations applied:
19 tables, 137 columns, and every type, NOT NULL and primary key agree. That
comparison covers columns ONLY - it does not prove defaults, index definitions,
foreign-key actions, CHECK expressions, WITHOUT ROWID, or triggers, and
triggers are not Drizzle-modeled at all. The `generate`-against-a-copy check
covers every Drizzle-MODELED object. Triggers and table options are outside
Drizzle's model; the harness replay narrows that gap by failing when a
previously-existing trigger or index NAME disappears, but it compares names
rather than trigger bodies and asserts nothing about `WITHOUT ROWID`. Trigger
bodies are not compared generally: `POST_CHECKS` behaviorally exercise selected
PATHS through some triggers, so they catch rewrites that alter those observed
behaviors, while rewrites to unexercised triggers - or to unexercised behavior
within a probed one - still slip through. That check tests
for drizzle-kit's SUCCESS
MARKER rather than for the absence of emitted SQL, because drizzle-kit catches
some failures, prints them and exits 0 - so "no migration was emitted" is not
evidence that anything was compared.
(Composite primary keys live in the snapshot's `compositePrimaryKeys` rather
than as a per-column flag - reading the per-column flag alone reports a false
mismatch on `list_food_item_slots`.)

**One tooling trap found while doing that, recorded because it cost an hour.**
`wrangler d1 migrations apply --local` is not deterministic: on repeated runs
against fresh persist directories it applied 25 of 26 migrations, exited 0, and
then reported "No migrations to apply!" on the next invocation, leaving the
database permanently short one migration. It appears to be a Miniflare
persistence flush that loses the last write when the process exits promptly.
Production is NOT exposed - `deploy.yml:271` applies with `--remote`, where
each migration commits server-side through the D1 API - and neither is
`npm run test:migrations` or the API suite, which use their own appliers. But a
LOCAL database can silently be one migration behind, and any conclusion drawn
from one (this comparison included) has to check `d1_migrations` first.

## 5. Item 3 - Rewrite the rule and the gate

**AGENTS.md.** Replace "A new migration may NOT drop, rebuild, or rename
anything. No exceptions." with the distinction the evidence supports:

- **Rebuilds are still banned, no exceptions.** `CREATE __new_x; copy; DROP x;
  RENAME` cascade-wipes children on D1. This covers column TYPE changes and
  CHECK changes, which SQLite can only do that way.
- **`DROP TABLE` is banned for any table another table cascades from**, for
  the same reason. A childless scratch table is not that.
- **`DROP COLUMN`, `DROP TRIGGER`, `DROP INDEX` are allowed as a CONTRACT
  STEP**: only in a release strictly later than the one that removed every
  read of the object, because of the deploy ordering above.
- Renames stay banned; a rename is a drop plus an add with no window in which
  both names work.

**`scripts/check-migration-safety.mjs`.** The destructive-DDL gate currently
rejects any DROP token and its comment says the only way past is a human
editing it. Replace with:

- Still hard-reject: the rebuild shape, `DROP TABLE` of a cascade parent,
  every rename, and any write to `d1_migrations`.
- Allow `DROP COLUMN` / `DROP TRIGGER` / `DROP INDEX` / `DROP TABLE` of a
  childless table, each requiring an entry in a new `CONTRACTED_OBJECTS`
  declaration naming the object, the PR that removed its reads, and the date.
- Make the sequencing machine-checkable as far as it honestly can be: the gate
  greps `server/**`, `src/**` and `shared/**` and fails if the object's
  identifier still appears outside a migration or a comment. That proves the
  reads are gone from the tree being deployed. It cannot prove the previous
  release actually reached production - the declaration's PR reference is a
  human attestation of that, and the comment must say so rather than implying
  the check is complete.

This is the "expand/contract sequencing is machine-checkable" milestone that
`docs/review-remediation-plan.md` Phase 3 defers to, partially delivered. Say
which half is machine-checked and which is attested.

## 6. Item 4 - Drop the dead objects

One migration, landing only after item 1 has merged AND deployed green (its
code removal is the release-A half for `needed`).

- `DROP TRIGGER list_food_item_slots_needed_only` then
  `ALTER TABLE list_food_slots DROP COLUMN needed` - order matters, SQLite
  refuses the reverse.
- `ALTER TABLE lists DROP COLUMN group_worn`
- `ALTER TABLE lists DROP COLUMN ready_checks_enabled`
- `DROP TABLE _food_rank_repair`

The two `lists` columns have been inert since 2026-08-11 - off every DTO,
refused by the strict PATCH schema, not copied by duplication - so their
release-A half shipped long ago and they need no code change now.
`_food_rank_repair` is 0023's one-shot repair table, emptied by its own
migration, referenced by nothing.

Each needs its `CONTRACTED_OBJECTS` entry. `app-schema.ts` loses the columns in
the same PR so the generated SQL is the ALTER itself. Every fixture in
`check-migration-safety.mjs` that seeds a dropped column must move in step, and
the fixture seeding `needed = 0` must go.

## 7. Sequencing

    PR A  item 2   snapshot realign            - no behavior, no schema change
    PR B  item 1   food scope-back + backfill  - needs A for a clean generate
    PR C  item 3   rule + gate rewrite         - no schema change
    PR D  item 4   drop dead objects           - needs B DEPLOYED, and C

PR D is the only one gated on a deploy rather than a merge. Confirm B's deploy
is green before opening D.

## 8. Verification

Per PR: read the complete diff; `npm run build`; `npm run test:unit`;
`npm run test:api` for anything under `server/**`; `npm run test:migrations`
for A, B and D. Codex adversarial review on this plan and on each diff.

PR B additionally: a fixture slot with `needed = 0` proves the backfill, and an
API test proves food can be scheduled into a slot that was previously skipped.

PR C additionally: a test that the gate still rejects a rebuild, a rename and a
cascade-parent `DROP TABLE`, and accepts a declared column drop. The gate is
the thing standing between us and a repeat of 0009, so its own tests are not
optional.

PR D additionally: `test:migrations` must show every seeded fixture row
surviving, and a post-check that the dropped objects are absent from
`sqlite_master`.
