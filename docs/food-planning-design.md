> **SUPERSEDED - DO NOT BUILD THIS.**
>
> This document describes a standalone reusable food PLANNER: plans as
> first-class objects, days, meals, entries, nutrition targets, macros and an
> account-wide food library. All of it was built, none of it was used, and
> migration 0016 deleted every table, route and component.
>
> Earlier revisions of this file said the workspace was merely "parked" with its
> schema and data intact, a feature flag away from returning. That has been
> false since the removal, and leaving it standing made this an authoritative
> restart path for exactly the thing that was thrown away.
>
> What replaced it is much smaller: a food WEIGHT ESTIMATE scoped to one list -
> day x meal slots you prune, carried items with a quantity, and one consumable
> line in the pack weight. No calories, no macros, no targets, no library, no
> plans reusable across lists. See migration 0017 and `shared/food.ts`.
>
> Kept only as a record of what was tried and why it was too much.

# Food planning: design

Status: ACCEPTED - slices 1-7 shipped to production 2026-07-19 (PRs #62-#83;
final slice 7b squash e1ebee0); section 13 all-days summary strips remain
deferred
Date: 2026-07-14 (rev 5; revised in place as decisions changed - current text
is authoritative)
Implements: REWRITE_PLAN.md phase 5, the last feature of the rewrite
Supersedes: the old build's food-plan-as-child-of-list model

A food plan becomes a **standalone, named, reusable** object that a gear list may
*point at*, rather than a child record that a gear list *owns*. Everything else
about food planning ports from the old repo largely intact.

Claims about the old build were read out of `/home/joe/code/grampacker` (schema,
migrations, components). Claims about SQLite semantics were **executed against
sqlite3 3.53.3**, not reasoned about - see section 2.3, which killed the first
draft of this design. Claims about how the backpacking community shares food were
researched against real Reddit threads, the LighterPack issue tracker, and
competitor source; the evidence is in section 7 because it decides a schema column.

---

## 1. Why, and what changes

The old build:

```sql
create table public.food_plans (
  list_id  uuid not null,                                -- cannot exist alone
  constraint food_plans_list_id_key unique (list_id),    -- zero-or-one per list
  foreign key (list_id, user_id) references public.lists(id, user_id) on delete cascade
);
```

A food plan could not exist without a gear list, there was at most one per list,
and deleting the list destroyed it. It had **no `name` column** - it did not need
one, because it was identified by its list. That absence is the tell: the plan was
never modeled as a thing, only as an attribute of a trip.

Structurally a food plan is not the food-domain analogue of a gear *item*; it is
the analogue of a gear *list* - a named, structured arrangement of library atoms
(days x meals x entries, the way a list is categories x items). `food_items` is
**already** an account-wide library with no list coupling, exactly like
`gear_items`. The plan was the only thing in the food domain chained to a list, and
`copy_food_plan_to_list` existed solely as a workaround for a plan that could not
stand on its own.

| # | Change |
|---|---|
| D1 | `food_plans` becomes standalone: gains `name`, loses `list_id`. |
| D2 | `lists` gains `food_plan_id` (nullable). One list has 0..1 plans; **one plan backs at most one list** (revised 2026-07-16, see 12.1 - reuse is duplication, enforced by the partial unique index `lists_food_plan_id_unique`). |
| D3 | The link is a **live reference**. Edit the plan, its list re-projects. |
| D4 | `food_pack_state` re-keys from `(plan, food)` to `(list, food)`, and **row presence means packed** - no `is_packed` column. |
| D5 | `packed_signature`, the plan-level advisory lock, the `PT409` stale-signature error and the cleanup trigger are **deleted, not ported**. |
| D6 | The public share exposes **one nullable object**: `food: { weightGrams, incomplete } \| null`. `is_food_shared` and the three public food views are **deleted, not ported**. |
| D7 | `/lists/:id/food` dies. Plans live at `/food` (tabs: Foods \| Plans) and `/food/plans/:id`. |
| D8 | `copy_food_plan_to_list` dissolves into an ordinary "duplicate plan" in the library. |

What does **not** change: the projection math, the `basis` enum, the nutrition
model on `food_items`, caps, CSV, and the fact that food weight lands in
`consumableGrams` and `totalPackGrams` and nowhere else.

---

## 2. Target model

### 2.1 The flip

```
-- was:  food_plans.list_id -> lists          (plan is a child of a list)
-- now:  lists.food_plan_id -> food_plans     (list points at a plan)
```

`lists` gains one nullable column and a composite same-owner FK:

```ts
foodPlanId: text('food_plan_id'),            // nullable: most lists have no plan

foreignKey({
  name: 'lists_food_plan_same_owner_fk',
  columns: [t.foodPlanId, t.userId],
  foreignColumns: [foodPlans.id, foodPlans.userId],
}),                                          // NO ACTION. *Not* SET NULL - see 2.3.
```

The composite `(food_plan_id, user_id)` reference is the same structural
anti-stitching guard every other child table already uses (AGENTS.md; ADR 12
continuity): a cross-owner link is impossible at the schema level, not merely
prevented in the repository.

### 2.2 Tables

**Ten** tables, all owner-scoped (`user_id NOT NULL` -> `user.id ON DELETE
CASCADE`), all with composite FKs inside the subtree so the food graph is
structurally self-sealing.

| Table | Purpose | Change from old build |
|---|---|---|
| `food_items` | Account-wide food library: name, brand, serving description, serving weight, calories, macros, sodium, potassium, notes, sort order. | **None.** Already standalone. |
| `food_plans` | A **named** plan. The day count is the count of `food_plan_days` rows - there is no second source of truth. | **+`name`; -`list_id`; -`is_food_shared`; no `num_nights`** (see 2.4) |
| `meals` | Plan-scoped meal definitions (Breakfast / On-trail food / Dinner seeded). | None |
| `food_plan_days` | Explicit day rows. Authoritative for "how many days". | None |
| `day_meals` | The day x meal grid. **Stays a table.** A row means "this meal is enabled on this day", which an empty cell must still be able to express - collapsing it to JSON would lose that. | None |
| `food_plan_entries` | One food x quantity in a (day, meal) cell or in Extras. `basis` in `servings` \| `packages` \| `weight`. | None |
| `food_plan_daily_targets` | Per-plan daily nutrition targets. | **`mode` stores no `'off'`** - off = row absent, uniformly (section 14) |
| `meal_targets` | Per-meal targets. | Same no-off tightening; doubly pinned by `(meal_id, food_plan_id)` (section 14) |
| `food_plan_target_defaults` | Account-level default targets (Settings). | None (the old build already forbade stored off here) - section 14 |
| `food_pack_state` | `(list_id, food_item_id)` - **presence means packed.** | **Re-keyed; `packed_signature` AND `is_packed` both dropped.** |

`food_pack_state` gets composite FKs to `lists(id, user_id) ON DELETE CASCADE` and
`food_items(id, user_id) ON DELETE CASCADE`.

### 2.3 Why NOT `ON DELETE SET NULL` - and the precedent already in this repo

Rev 1 specified `ON DELETE SET NULL` on the composite FK. **That would have made
deleting a food plan impossible at runtime.** SQLite has no *column-list* SET NULL:
it sets **every** column of the child key to NULL, including `user_id`, which is
`NOT NULL` on `lists`. The DDL is legal; the `DELETE` blows up. Executed against
sqlite3 3.53.3:

```
-- composite FK (food_plan_id, user_id) ... ON DELETE SET NULL
sqlite> delete from food_plans where id='p1';
Error: NOT NULL constraint failed: lists.user_id
```

**This repo already hit this exact wall and solved it.** `gear_items.category_id`
is the same shape - nullable child column, composite same-owner FK, NOT NULL
`user_id` - and `server/db/app-schema.ts:59` says so:

> "SQLite has no column-list ON DELETE SET NULL (setting user_id null would violate
> NOT NULL), so the FK is NO ACTION and category deletion is a repo-owned atomic
> batch: [uncategorize gear, delete category]."

**The plan link is the category pattern, verbatim.** Nothing novel is being invented
here, and the design should not pretend otherwise. FK is **NO ACTION**; deleting a
plan is a repo-owned atomic batch.

### 2.3.1 The plan-delete batch, in order

Three statements, and **the order is load-bearing**:

```
1. DELETE FROM food_pack_state
     WHERE user_id = ?
       AND list_id IN (SELECT id FROM lists WHERE food_plan_id = ? AND user_id = ?)
2. UPDATE lists SET food_plan_id = NULL WHERE food_plan_id = ? AND user_id = ?
3. DELETE FROM food_plans        WHERE id = ? AND user_id = ?
```

Step 1 **must** precede step 2. `food_pack_state` is keyed `(list_id, food_item_id)`
and holds no plan reference, so deleting the plan cascades nothing - and once step 2
has nulled `food_plan_id`, the affected lists can no longer be found. Rev 1 omitted
step 1 entirely and would have orphaned every attached list's pack state, silently
contradicting its own stated lifecycle (section 6).

NO ACTION makes the FK a **hard backstop**, not merely a convention the repo must
remember: skip step 2 and step 3 fails loudly rather than corrupting anything.
Verified:

```
sqlite> delete from food_plans where id='p2' and user_id='u1';   -- still attached
Error: FOREIGN KEY constraint failed
```

**Atomicity is real.** D1's `batch()` is a transaction - a failing statement rolls
back the whole sequence, and no other request interleaves between statements. There
is no detach-commits/delete-fails partial outcome. Drizzle wraps the D1 binding
directly (`server/db/index.ts:15`).

**Account deletion still works.** With `lists` holding a NO ACTION reference to
`food_plans` and both cascading from `user`, deleting a user removes both cleanly
(verified: 0 lists, 0 plans, no FK error). This is load-bearing - account deletion is
already shipped - so it gets a real D1 test rather than trust.

**Required D1 tests (not optional):**

- delete an attached plan -> the list survives, detached; the plan is gone; **its pack
  state is gone**
- delete a plan attached to **several** lists -> all detach, all pack state cleared
- the raw `DELETE` without the detach -> **fails** with a FK error (proves the backstop)
- delete the **user** while a list is attached to a plan -> full cascade, no error
- a cross-owner link is rejected (user A's list cannot point at user B's plan)

### 2.4 No `num_nights`

Rev 1 carried `num_nights` over from the old `food_plans` CREATE migration. That
was wrong: the old repo **itself deleted it** in
`20260613204612_remove_food_plan_nights.sql`, and its later tests assert that
create omits it. Reintroducing it would restore a second source of truth about how
long a trip is, competing with the authoritative `food_plan_days` rows.

(Root cause of the error, recorded so it is not repeated: rev 1's survey read the
migration that *created* the table and never asked whether a later migration
altered it. Read the final schema, not the first one.)

---

## 3. The link: live reference, one plan per trip

Attaching a plan to a list is a pointer, not a copy - and a plan backs **at
most one** list (revised 2026-07-16, see 12.1).

- **Edit the plan -> its list re-projects on next read.** Nothing is
  denormalized, so nothing can go stale.
- **A plan backs at most one list**, enforced by the partial unique index
  `lists_food_plan_id_unique` on `lists(food_plan_id) WHERE food_plan_id IS NOT
  NULL`. Attaching a plan another list holds is a 409 `plan_in_use`;
  re-attaching a list's own plan is a no-op success. **Reuse is duplication**:
  want your "standard 2-night" menu on another trip, duplicate it (the picker's
  "Duplicate & attach" does copy + attach in one transaction).
- **Detach** sets `lists.food_plan_id = null` **and clears that list's pack state**
  in the same batch (section 6).
- **Delete a plan** = the atomic detach-then-delete batch of 2.3. A trip is never
  destroyed by a library operation.

The live reference matches how gear behaves: re-weigh your tent and the list's
total moves. The exclusivity does NOT match gear, deliberately: gear weight is a
fact about an object, so propagation is correct; a menu is a per-trip decision,
so propagation across trips was an ambush (the original many-lists model made
editing "the JMT plan" silently rewrite last month's Yosemite trip). Snapshot-
on-attach was considered and rejected: it produces two kinds of plan and breaks
"edit the plan for THIS trip and it re-projects".

### 3.1 Duplicate semantics

**Duplicating a plan** is a deep copy of the plan graph - `meals`,
`food_plan_days`, `day_meals`, `food_plan_entries` and (when they land) targets -
with fresh ids throughout, referencing the same account-wide `food_items`. It
copies **no** pack state, because pack state is not keyed by plan at all. The
copy machinery lives in `server/repos/food-plan-copy.ts`, shared by both call
sites below. All writes respect the D1 100-bound-param limit: chunked multi-row
inserts, one `db.batch`.

`POST /api/food-plans/:id/duplicate` takes an optional `listId` ("Duplicate &
attach"): the copy is created AND that list re-pointed at it in the same batch.
The attach UPDATE is a compare-and-swap on `expectedFoodPlanId` - the link the
client observed when it offered the action (null = none; an omitted field
defaults to null, the fail-safe reading) - so a concurrent attach/detach in
another tab fails the CAS instead of being silently overwritten; the committed
copy is then compensating-deleted and the caller gets a 422.

**Duplicating a list** (`POST /api/lists/:id/duplicate`) cannot carry the plan
pointer over (the unique index forbids two holders), so when the source has a
plan the whole graph is deep-copied in the same batch and the new list points at
the copy. Either cap trigger (100 lists, 100 plans) aborts the whole batch -
no orphan plan, no half-copied list. It still copies **no** `food_pack_state`:
the new list starts fully unpacked; packing is a property of a trip, and the
duplicate is a different trip.

---

## 4. Food is NEVER a `list_items` row

The list shows a single `Food (Summer 3-day)` line, marked consumable. That line is
**derived at read time**, not stored.

It cannot be a `list_items` row, and should not be:

```ts
gearItemId: text('gear_item_id').notNull(),   // composite FK -> gear_items
```

Every list item **is a piece of gear**. Food is not. Storing Food as a row would
need a synthetic "Food" gear item carrying a **denormalized weight** - and because
the link is a live reference, every edit to a plan would have to rewrite that
number on the list using the plan. That is a cache-invalidation bug, voluntarily
imported. The FK is the link; the row is a rendering.

This costs nothing. The row still *looks* like a line item, still reports as
consumable, still expands in pack mode. "Consumable" is not even a user choice
here: food is consumable by definition, and `list_items_worn_xor_consumable`
already makes worn/consumable mutually exclusive.

---

## 5. The projection contract

This is the core of the feature and the easiest place to make a mess. It is
specified here so that it stays boring.

**5.1 One canonical projection function.** A single pure function, living in
`shared/`, imported unchanged by the SPA, the authenticated API and the public
share endpoint. **Public and authenticated totals use the same math.** There is no
second implementation, and specifically no SQL re-derivation of the grams formula
(the old repo had exactly that, duplicated inside `get_food_pack_signatures`, and
the two could drift). It is unit-tested server-side.

```
servings  -> amount * serving_weight_grams
packages  -> amount * servings_per_package * serving_weight_grams
weight    -> amount
```

**5.2 One batched plan-document read, and the entries come back pre-joined.** The
projection needs the plan, its days, meals, day_meals, entries and the referenced
food items. That is **one batched read** producing a plan document - never N+1 per
day, per meal, or per entry.

Fetch the entries **joined directly to `food_items`** on `(food_plan_id, user_id)`:

```sql
SELECT e.*, f.serving_weight_grams, f.servings_per_package, f.calories_per_serving, ...
  FROM food_plan_entries e
  JOIN food_items f ON f.id = e.food_item_id AND f.user_id = e.user_id
 WHERE e.food_plan_id = ? AND e.user_id = ?
```

**Do not** collect the entries' food ids and issue a second membership or chunked
read. The join sidesteps the D1 100-bound-param limit **entirely** - the query binds
two parameters no matter how many entries the plan has - and the `f.user_id =
e.user_id` predicate preserves ownership structurally rather than by filtering a
list the handler assembled. Chunking would be solving a problem the join does not
have. (An earlier draft specified owned-set membership / chunked reads here; that
was unnecessary complexity.)

**5.3 Weight composition.** Unchanged from the old build; already stubbed in
`src/lib/weight-breakdown.ts` behind a `TRANSPLANT NOTE (food)`:

```ts
export function withProjectedFood(breakdown: WeightBreakdown, projectedConsumableGrams: number): WeightBreakdown {
  return {
    ...breakdown,
    consumableGrams: breakdown.consumableGrams + projectedConsumableGrams,
    totalPackGrams:  breakdown.totalPackGrams  + projectedConsumableGrams,
  }
}
```

Food is **always** consumable: only `consumableGrams` and `totalPackGrams` move.
`baseGrams`, `wornGrams` and the per-category rows are untouched.

**5.4 Incomplete projections are first-class.** Some entries **cannot be projected**,
so the total is an undercount, and that fact must travel with the number everywhere
it goes - including the public share (section 7).

**The incomplete condition is a `packages`-basis entry whose food has a NULL
`servings_per_package`.** It is *not* a missing serving weight:
`serving_weight_grams` is `NOT NULL CHECK (> 0)` in the old schema
(`20260611120000_food_items.sql:16`) and stays that way, so `servings` and `weight`
basis entries can always be projected. `servings_per_package` is the nullable one
(line 18). Rev 1 asserted the wrong condition and invented a failure mode that
cannot occur.

The old build's `MISSING_FOOD_LABEL` / `incompleteFoodWeight` note is already stubbed
in `WeightSummary`, and `src/lib/food/projection.test.ts:64` in the old repo pins
exactly this case.

**5.5 Invalidation is coarse, on settle - and these are the actual keys.** Rev 1 said
"affected list query prefixes", which does not exist. The real cache topology
(`src/lib/queries/keys.ts`) is:

| Key | Scope |
|---|---|
| `['lists']` | **all** list metadata, one global cache - there is no per-list metadata key |
| `['list-items', listId]` | per-list items |
| `['shared-list', slug]` | the public read cache |

So, concretely:

- **Attach / detach / change of `food_plan_id`** -> invalidate `queryKeys.lists()`
  (global; the attached plan id lives on the list row) **and** the food-projection
  prefix **and** the `['shared-list']` prefix.
- **Food and entry mutations** -> invalidate the food-plan and food-projection
  prefixes **and** `['shared-list']`. The share cache matters: `staleTime` is 30s
  (`src/App.tsx:63`), so a previously-visited share would otherwise serve a stale
  total from the same QueryClient.
- **`['list-items', listId]` does NOT need invalidating** by food mutations. Food is
  not a list item (section 4) and lives in its own projection cache.

New keys: `foodPlans()` and `foodPlan(planId)`, both shipped with slice 2b. The food
library key, `foodItems()` -> `['food-items']`, already shipped with slice 1 (it
mirrors `gearItems()` -> `['gear-items']`; this doc's earlier `foods()` shorthand was
never the built name). Slice 3b adds only `sharedListAll()`, the `['shared-list']`
prefix the bullets above invalidate against.

**REVISED 2026-07-16 (slice 3b): there is no `foodProjection(listId)` key, and no
`foodProjectionAll()` prefix.** Rev 2 specified both, assuming the projection would be
a per-list cache entry. It should not be: the projection is a pure function of two
caches the app already holds - the plan document (`['food-plan', id]`) and the food
library (`['food-items']`) - so `src/lists/use-food-projection.ts` derives it with
`selectFoodPlanView`, the same selector the editor renders from. A projection key
would be a cache OF a derivation: redundant state that can go stale against the
editor, and it is what *created* the fan-out problem `foodProjectionAll()` was
invented to solve. Deriving deletes the problem instead: every plan mutation already
writes the fresh document to `['food-plan', id]` (5.5's own rule), so every list
pointing at that plan re-derives with no invalidation at all, however many there are.
This also honors 5.1 (one function, no second implementation) more literally than a
second cached copy of its output would.

**Do not build a gear-style multi-cache optimistic fan-out** unless profiling proves
coarse invalidation inadequate. The gear surfaces earned their fine-grained optimistic
machinery by being typed into character by character; a food plan is not that, and the
fan-out is where the optimistic-update blind spots live (AGENTS.md).

**5.6 Numeric behavior: full precision through the math, round ONCE at the boundary.**

The inputs are fractional. `serving_weight_grams` and `servings_per_package` are
`numeric(10,3)` in the old schema, and `amount` is fractional too - "1.5 packages of
ramen" is an ordinary entry. In JS these are IEEE-754 doubles, so the math accumulates
artifacts (`0.1 + 0.2 !== 0.3`).

The rule:

- **Carry full precision through the whole projection** - per-entry grams, per-day
  sums, the plan total. Never round an intermediate.
- **Round exactly once**, to **integer grams**, at the projection DTO / weight-
  composition boundary - the point where the number leaves the projection and becomes
  `projectedConsumableGrams` for `withProjectedFood`.
- **Public and authenticated totals must be the same rounded integer.** They already
  share the projection function (5.1); they must also share the *rounding site*, or a
  share could disagree with the owner's own view by a gram. Rounding is part of the
  contract, not a display concern.

Rounding per-entry and then summing is the classic way to get a total that disagrees
with itself, and it is exactly what a naive "format each row" implementation does.

**Required tests** (these are the ones that would expose float artifacts, and a
formula that looks right will still fail them):

- fractional servings (e.g. `2.5 x 33.3 g`) - the total is the rounded sum, not the
  sum of rounded rows
- fractional packages (`1.5 packages x 2.5 servings/package x 33.3 g`)
- an entry set engineered so per-entry rounding and end rounding **differ**, pinning
  that we do the latter
- the same plan projected through the public path and the authenticated path -> **byte-
  identical integer**

---

## 6. Pack state

`food_pack_state` is keyed `(list_id, food_item_id)`. **Row presence means packed.**
Absence means unpacked. There is no `is_packed` boolean - it would be a column that
is `true` in every row that exists. Toggling is an insert or a delete. Never public.

The lifecycle has **three** rules. All of them are correctness, not tidiness.

**Rule 1 - clear on relink.** Whenever a list's `food_plan_id` changes or is
detached, clear that list's `food_pack_state` in the same atomic batch. Plan A and
Plan B may both contain ramen; without this, switching a list from A to B shows ramen
**pre-checked** under a plan you have never packed for.

**Rule 2 - reconcile after any plan-structure mutation.** Append **one** statement to
the same batch as any mutation that can remove entries from plan P:

```sql
DELETE FROM food_pack_state
 WHERE user_id = ?
   AND list_id IN (SELECT id FROM lists WHERE food_plan_id = ?P AND user_id = ?)
   AND food_item_id NOT IN (
     SELECT e.food_item_id FROM food_plan_entries e
      WHERE e.food_plan_id = ?P AND e.user_id = ?
   )
```

It deletes any pack row, on the list attached to P (at most one, since
2026-07-16 - the subselect form is kept because it is already correct and
self-limiting), whose food no longer appears **anywhere** in P.

Reconciling against *what remains* rather than tracking *what left* is what makes this
correct and cheap:

- **Last-occurrence is automatic.** The same food may sit in several cells. Deleting one
  of ramen's two cells leaves ramen in the `NOT IN` set, so its checkmarks survive;
  deleting the last one clears them on every attached list. Verified.
- **Every removal path is covered by construction** - entry delete, an entry's
  `food_item_id` updated away, and the cascade deletes of a day, a meal, or a `day_meal`
  cell. A per-food cleanup would have had to enumerate each of those paths and would
  have missed the cascades.
- **No id list, so no D1 param blowup** (section 9).
- `NOT IN` is NULL-safe here only because `food_plan_entries.food_item_id` is `NOT NULL`.
  Stated because a nullable column would silently turn this into a no-op.

This restores an invariant the old build enforced with a trigger
(`20260614185632_food_pack_state.sql:64`) and rev 1 wrongly dismissed as a "harmless
quirk". It is not harmless: remove ramen and re-add it and the packed **count silently
increases** with no user action. (Under one plan per trip the blast radius is
bounded to the single attached list, but the bug itself is unchanged.)

**Rule 3 - the toggle is a compare-and-swap on the plan link.** Packing is a
read-then-write, so it races a plan switch. Rev 2 tried to fix this by proving the food
is in the list's *current* plan. **That does not work, and it was verified not to work:**
if plan A and plan B both contain ramen, a stale plan-A toggle satisfies the check
against plan B and inserts a phantom checkmark.

The request must therefore carry **the plan id it observed**, and the write must gate on
it:

```sql
-- PACK
INSERT INTO food_pack_state (list_id, food_item_id, user_id, created_at)
SELECT ?, ?, ?, ?
 WHERE EXISTS (
   SELECT 1 FROM lists l
     JOIN food_plan_entries e ON e.food_plan_id = l.food_plan_id AND e.user_id = l.user_id
    WHERE l.id = ? AND l.user_id = ? AND e.food_item_id = ?
      AND l.food_plan_id = ?expectedPlanId      -- the compare-and-swap
 )
ON CONFLICT (list_id, food_item_id) DO NOTHING;  -- idempotent: a retry is not an error

-- UNPACK: the same gate, or the inverse race deletes a row packed under the new plan
DELETE FROM food_pack_state
 WHERE list_id = ? AND food_item_id = ? AND user_id = ?
   AND EXISTS (
     SELECT 1 FROM lists l
      WHERE l.id = ? AND l.user_id = ? AND l.food_plan_id = ?expectedPlanId
   );
```

Both directions need the gate. An unconditional unpack has the mirror-image bug: a
delayed plan-A unpack would delete a checkmark the user made under plan B.

**A failed gate affects zero rows and is not an error.** The user switched plans; their
checkbox click simply lost, which is the correct outcome and does not deserve a 409.

**The response is narrow.** Either `204 No Content` (and let the projection
invalidation of 5.5 refresh the truth), or a minimal body naming only the food touched
and whether the compare-and-swap actually applied:

```ts
{ foodItemId: string; packed: boolean; applied: boolean }   // applied:false = the CAS lost
```

**Do not return the whole list's pack state on every checkbox click.** Packing is the
highest-frequency mutation in the app - a user ticks their way down a food list - and
shipping the entire pack set back on each tick is a payload that grows with the plan
for no gain. `applied: false` is what the client needs in order to roll its optimistic
tick back; nothing else about the mutation is news to it.

`ON CONFLICT DO NOTHING` makes packing **idempotent**: two concurrent packs, or a retry,
must not surface a unique-constraint error for what the user experiences as one click.
(The `WHERE EXISTS` on the outer `SELECT` also resolves SQLite's UPSERT parsing
ambiguity, so this form parses; verified on 3.53.3.)

**What this does NOT close: the ABA cycle.** The gate compares a plan *id*, so a request
that observed plan A still succeeds after `A -> B -> A` (or `A -> detached -> A`). A
stale pack can re-check a food after reattachment; a stale unpack can clear one.

**This is accepted, deliberately.** ABA leaves a **stale** state, not a **wrong** one:
the checkmark lands on a food that really is in the plan the list really is attached to -
it is the box the user actually clicked. That is on the right side of the line drawn
below (may lie about *quantity*, never about *which plan*). Closing it would need a
link-generation token on `lists`, bumped on every relink and threaded through every
toggle - which is the same species of machinery `packed_signature` was deleted for, in
service of a race that requires two full relinks completing while one checkbox request
is in flight - a window that stays sub-second even with concurrent sessions. If it ever
matters, the fix is one monotonic integer column and one more binding; it is not a
design change. (One plan per trip also shrinks the surface: rule 1 clears pack state on
every relink, so the `A -> B -> A` cycle starts each leg from a cleared set.)

**What we deliberately do not port:** the old build stored a `packed_signature` (the
grams you packed) so an edit mid-pack could invalidate a now-lying checkbox. Keeping it
honest needed a plan-level `pg_advisory_xact_lock` and a `PT409` error path. **Neither
is ported.** D1 has no advisory locks and the feature is not worth reinventing them for.

**Accepted consequence - the only one.** Check off "ramen: 3 servings", then edit *the
attached plan* to 5, and it still reads packed. The checkbox may lie about **quantity**.
It may never lie about **which plan**, or about a food that is not in the plan at all.
That line is where rev 1 was wrong, and it is worth stating precisely: you are standing
over the food while you pack, so a wrong *amount* is self-correcting; a checkbox that
appears from nowhere is not.

**Required D1 tests (not optional):**

- **Rule 1:** pack a food, switch the list to another plan that also contains it -> it
  is **unpacked**.
- **Rule 2, multi-cell:** the same food in two cells; delete one entry -> the checkmark
  **survives**. Delete the last -> it clears on the attached list.
- **Rule 2, cascade:** delete a whole day (or meal, or `day_meal`) that held the last
  occurrence -> the checkmark clears.
- **Rule 2, redirect:** update an entry's `food_item_id` away from its last occurrence
  -> the checkmark clears.
- **Rule 3, pack race:** two plans both containing ramen; a toggle carrying the *old*
  plan id, applied after a switch -> **zero rows**. (This is the exact case rev 2's SQL
  failed.)
- **Rule 3, unpack race:** a stale unpack carrying the old plan id must not delete a row
  packed under the new plan.
- **Rule 3, idempotency:** packing twice is not an error.
- **Rule 3, ownership:** a toggle naming another user's list or food affects zero rows.

---

## 7. Sharing: weight only

The public `/r/:slug` view shows the derived Food row with a **weight**, and nothing
else. No food names, no meals, no days, no calories.

The share DTO gains exactly **one nullable object**:

```ts
food: { weightGrams: number; incomplete: boolean } | null   // null = no plan attached
```

**Nullable, not two bare scalars.** Rev 1 proposed `foodWeightGrams: number` +
`foodWeightIncomplete: boolean`, which cannot tell "no plan attached" apart from "an
attached plan that currently weighs zero" - both serialize as `{ 0, false }`. The
share must render no Food row at all in the first case and a zero-weight Food row in
the second, so **presence has to be encoded**. The existing public DTO is a strict
field allowlist (`shared/lists.ts:162`, re-mapped field-by-field in
`server/routes/shares.ts:26`), so there is no `food_plan_id` on the wire for the
client to infer it from.

`incomplete` is not optional either. Without it, a share whose plan contains a
`packages` entry with no `servings_per_package` (section 5.4) would publish a
**silently undercounted pack weight**, and the viewer would have no way to know the
number is wrong. A public total that lies is worse than one that admits it is partial.

There is **no `is_food_shared` flag.** If a plan is attached, its weight is in the
total; to share a list without food, do not attach a plan. A toggle that hid food
from the total would make the headline pack weight a lie.

The old build did the opposite: a Gear/Food tab strip on the share page and three
migrations of public views (`public_food_plan_detail_views`,
`public_food_projection_view`, `public_food_summary`) that could publish the entire
plan. All deleted, not ported.

**A bug this surfaces in already-shipped code:** `SharePage` gates its weight summary
behind `items.length > 0` (`src/lists/SharePage.tsx:161,173,190`) and renders an empty
state at `items.length === 0`. A **food-only shared list** - zero gear rows, a plan
attached - would therefore show "empty" while carrying 6 kg of food. Must be fixed and
tested in **slice 5**.

**Required tests:** a shared list with an unprojectable `packages` entry (flag set,
total honest); a **food-only** shared list with zero gear rows; a shared list with **no
plan attached** (`food: null`, no Food row); an attached plan that projects to **zero**
grams (`food: { weightGrams: 0 }`, Food row present) - the last two being the pair rev
1's DTO could not distinguish.

### Why weight only - the evidence

- **Shakedown culture consumes food as one number.** Ten r/Ultralight shakedown
  threads, ~150 comments read in full: **seven** had no food discussion at all, one
  had substantive food critique, and every word of it was aggregate ("dial your food
  down to 1.4 lbs per day"). **Zero comments critiqued an individual food item** -
  though nothing stopped those posters from itemizing food in their LighterPack. Real
  public lists contain rows literally named `Food Per Day Weight approx 2 lb`.
- **LighterPack has declined this for eleven years.** Issue #12 ("food value field")
  opened 2015, still open, 6 reactions. A working implementation was handed to them in
  2018 and never merged. Issue #45 requests a meal planner - and the *requester* wants
  it collapsed to one line on the shared list: "add that to the gear, just as 'Beans
  and Rice for 1' so you can still have a consumable weight included."
- **Every tool with real food detail keeps it private.** Backcountry Foodie and Trail
  Recipes have full planners and no share URL at all.
- **Packstack** (`github.com/Packstack-Tech/app`) never faced the question: no meal
  planner, only a `calories` field on an item plus a Pandolf calorie-*burn* estimator.
  Its own `useToggleTripPublic` mutation is commented out and `/pack/$id` sits behind
  the auth guard.
- **The "show a beginner" case is real but differently shaped.** A 207-upvote "I need
  food advice" thread drew 320 comments and not one link to anyone's plan; it was
  answered with brands and strategy. That demand is served by a narrated blog post,
  not a data view.

Honest caveat: absence in existing tools is weak evidence of absent demand, since
LighterPack has no calorie field at all and the food-lumping habit is partly
tool-shaped. But the *behavioral* evidence is not tool-shaped - people do itemize food
publicly, at length, to large audiences, just never on their gear-list link.

And this is **additive**: a richer food share is a flag plus a DTO field later, on a
design that does not change.

---

## 8. UI surface

### Routes

| Route | Content |
|---|---|
| `/food` | Tab strip: **Foods** (the item library) \| **Plans** (index of your plans) |
| `/food/plans/:id` | Plan editor: days x meals grid, entries |
| `/lists/:id` | Gains the derived Food row + the plan picker |

`/lists/:id/food` is gone: a plan no longer lives under a list.

**Every new route goes into `docs/authz-matrix.md` before implementation**, with
owner / non-owner / anonymous tests, per SECURITY.md. Food routes are
session-only; the sole anon-reachable food data in the entire system is the two
scalars of section 7, reached through the existing share projection.

### The picker

`LibraryPanel` gains a Gear \| Food toggle. Gear is "add many items"; Food is **"pick
the one plan for this trip"** - a different verb, same panel. Selecting a plan sets
`lists.food_plan_id` (and clears pack state, section 6). Detach is a menu action on
the Food row.

### The Food row

- **Normal mode:** one derived row, `Food (Summer 3-day)`, consumable, weight from the
  projection. Its own section - not sortable, not categorized, not draggable.
- **Pack mode:** expands into the real per-food checklist (the old build's
  `FoodProjectionSection`), folded into the packing progress counter
  (`total = listItems.length + packableTotal`). "Reset packed" spans both.
- **Public share:** collapses to weight only (section 7).

The pack-mode checklist is load-bearing. It is the reason food is worth modeling at
all rather than typed in as a lump.

### Plan-usage visibility (revised 2026-07-16)

Under one plan per trip (12.1) the ambush this section originally existed for -
editing a plan silently rewriting OTHER trips - is structurally impossible: a
plan backs at most one list. The shared-plan warning banner and its inline
"Duplicate for this trip" escape hatch (shipped in slice 3b-ii) were therefore
**removed** in the same change that added the constraint.

What remains is orientation, not warning:

1. **The plan editor** shows a quiet "Used by <list>" breadcrumb linking to the
   one trip that follows the plan (from the document's `usedByList`, null when
   free). A plan backing no list shows nothing.
2. **The Plans index and the picker** show "In use by <list>" on each held
   plan's card/row (`usedByListId` / `usedByListName` on the summary DTO).
3. **The picker's escape hatch**: selecting a plan another list holds offers
   **"Duplicate & attach"** (3.1) instead of a dead click - the reuse path under
   exclusivity.

---

## 9. Caps

Ported: **1000** foods/user, **60** days/plan, **20** meals/plan, **2000**
entries/plan. New, because plans are now standalone and accumulate: a
**plans-per-user cap**, proposed **100**.

D1 trap applies (AGENTS.md): max 100 bound params per query. No unbounded `inArray`
over DTO-sized id lists.

Note where it does and does not bite. **The projection read does not** - it joins
entries to `food_items` (5.2) and binds two params regardless of plan size. **Plan
duplication does** (3.1): a deep copy of up to 2000 entries is a write, and writes
cannot be joined away, so it chunks (`chunkForParamCap` in
`server/repos/food-plan-copy.ts`, floor(90/columns) rows per statement for
headroom; `server/repos/chunk-ids.ts` uses the same 90 for reads).

**Statement-count budget (unresolved doc ambiguity, noted 2026-07-16):** the D1
limits page lists "Queries per Worker invocation: 1000 (Paid) / 50 (Free)", but
that row links to the Workers *subrequest* limits (one `db.batch` is one call),
and the batch-limits paragraph applies only per-QUERY limits (100 bound params,
100KB statement) to each batched statement. A worst-case list duplicate (maxed
plan + 300 items) is ~400 statements in one batch. Correctness is safe either
way - a failed batch commits nothing - but until a maxed-plan duplicate is
wire-verified on the Free tier (follow-up), treat statement count as a budget to
keep low, not an unlimited resource. See AGENTS.md D1 traps.

---

## 10. The sockets are already cut

`TRANSPLANT NOTE (food)` markers are waiting in: `lib/weight-breakdown.ts`,
`lib/caps.ts`, `lists/WeightSummary.tsx`, `lists/SharePage.tsx`,
`lists/ListDetailPage.tsx`, `lists/use-list-reset-actions.ts` (+ its test), and
`settings/SettingsPage.tsx`. Filled by slice 6: `lib/csv/index.ts` and
`lib/export/takeout-files.ts`.

`PrivacyPanel`'s note promised an "Include food plan" toggle. Per D6 that
toggle was **not** coming; slice 6 deleted the note and replaced it with a
statement of the decision.

---

## 11. Slicing

~5.4k lines of food UI in the old repo (~9.6k with tests). Far too big for one PR.

The governing rule: **no slice ships a shell the user can open and cannot use.** Rev 1
proposed plan-CRUD as its own slice, which would have exposed a plan you could create,
name, and then do nothing with. That is not a shippable increment.

| # | Slice | Ships what |
|---|---|---|
| 1 | **Food library** (`food_items`): schema, repo, routes, `/food` Foods tab, CRUD, caps | A usable food library. Mirrors phase 2 (gear library) exactly - the proving slice. |
| 2 | **Plans, end to end**: `food_plans` + `meals` + `days` + `day_meals` + **`entries`**, the Plans tab, `/food/plans/:id` with the grid and the smallest real entry workflow (add a food to a cell, see the weight) | A plan you can actually build. Foundation and payload land together. Big; may split *internally* (e.g. grid before Extras) but nothing user-visible ships half-built. |
| 3 | **The link + projection**: `lists.food_plan_id`, the picker, the derived Food row, `withProjectedFood` into the weight summary, the projection contract (section 5), and the shared-plan visibility warning (section 8) | Pack weight starts including food. The payoff. *(Shipped as designed; the shared-plan warning was then superseded 2026-07-16 by one-plan-per-trip - see 8 and 12.1/12.9.)* |
| 4 | **Pack mode**: `food_pack_state`, the checklist, the progress counter, reset, the pack-state lifecycle (section 6) | The packing checklist. |
| 5 | **Share**: the nullable `food` object, plus the `items.length === 0` fix | Food weight on `/r/:slug`. |
| 6 | **CSV + takeout**: food CSV import/export, food in the takeout bundle | Data portability. |
| 7 | **Targets**: daily/meal targets + `DefaultTargetsSection` in Settings | Was deferred to last (least load-bearing; must not block the core path). Designed 2026-07-18 in section 14; ships as **7a backend** (schema, save/defaults routes, copy semantics, day-type endpoint, takeout v4) then **7b frontend** (nutrition math, grading, editors, day review, Settings). |

Slices 1-4 are ordered. 5 follows 3. 6 and 7 can land any time after 2, and **7 is
explicitly last**.

---

## 12. Decisions (settled 2026-07-13, revised 2026-07-14 and 2026-07-16)

### 12.1 Live reference, not snapshot - and one plan per trip (revised 2026-07-16)
The link stays a live reference: edit the plan and its list re-projects. But a
plan now backs **at most one** list, enforced by the partial unique index
`lists_food_plan_id_unique` (migration 0010, which also detaches all but the
most-recently-updated holder of any plan shared before the change). Reuse is
duplication: create new, or duplicate an existing plan ("Duplicate & attach"
from the picker, Duplicate from the Plans index).

Why the revision: gear weight is a fact about an object, so cross-list
propagation is correct; a menu is a per-trip decision, so cross-trip propagation
was an ambush the shared-plan warning (old 12.9) could only mitigate, not
remove. Exclusivity deletes the ambush, the warning UI, and slice 4's
fork-vs-pack-state design fork in one move. (Section 3.)

### 12.2 NO ACTION, not SET NULL; delete via an atomic 3-statement batch
Forced by SQLite semantics, verified by execution - and **this is the existing
`gear_items.category_id` pattern, not a new one** (`server/db/app-schema.ts:59`). The
FK doubles as a hard backstop. Pack state is cleared *before* the detach, because the
detach destroys the ability to find the lists. (Section 2.3.)

### 12.3 The checkbox may lie about *quantity*, never about *which plan*
No `packed_signature`, no advisory lock, no `PT409`. But three lifecycle rules are
mandatory, and all three are correctness rather than hygiene:

1. clear pack state on relink;
2. **reconcile** pack state against the plan's remaining entries after any structural
   mutation (one statement; last-occurrence and cascade-safe by construction);
3. make the toggle a **compare-and-swap on the observed plan id**, in *both* directions,
   and idempotent.

Rule 3 is the subtle one. Checking "is this food in the list's current plan" is **not
sufficient** - two plans can contain the same food, and an earlier draft of this document
contained exactly that hole (caught in review; nothing was ever implemented). Cross-plan
bleed-through is a **wrong answer**, not a stale one.

The residual **ABA cycle** (`A -> B -> A`) is knowingly left open: it yields a stale
state, not a wrong one, and closing it costs a link-generation token. (Section 6.)

### 12.4 Public share: one nullable `food` object, no gating toggle
`{ weightGrams, incomplete } | null`. Nullable so that "no plan" and "empty plan" are
distinguishable; `incomplete` mandatory so a partial total cannot masquerade as a
complete one. Also considered and rejected: publishing kcal/day + kcal/oz + lb/day
aggregates - the metrics shakedown culture actually speaks in, but stats for an
audience of one, and cut as scope. (Section 7.)

### 12.5 Food is never a `list_items` row
Derived at read time. (Section 4.)

### 12.6 Plans get their own home
`/food` with a Foods \| Plans tab strip - not a fourth top-level nav entry, and not
"discoverable only from the picker" (which would strand an unattached plan).

### 12.7 `day_meals` stays a table
It encodes "this meal is enabled on this day", which an *empty* cell must still be
able to express. Collapsing it into JSON to reduce the table count would lose that
distinction.

### 12.8 Targets are deferred to last (resolved 2026-07-18)
They are the least load-bearing part of the feature. (Section 11.) Every other
slice shipped first; the targets design is section 14.

### 12.9 A live reference must not be a surprise (superseded 2026-07-16)
As designed: when a plan backed more than one list, the editor said so and
offered "Duplicate for this trip" inline. Shipped with slice 3b-ii, then
**superseded by 12.1's one-plan-per-trip revision** - a plan can no longer back
two lists, so the warning has nothing to warn about and was removed. Its
replacement is the quiet "Used by" breadcrumb + the picker's "Duplicate &
attach". (Section 8.)

### 12.10 Round once, at the projection boundary
Full precision through the math; a single rounding to integer grams where the number
leaves the projection. Public and authenticated totals round at the **same site** and
must be identical. (Section 5.6.)

---

## 13. Deferred

- **Derived kcal/day targets.** Packstack estimates calories *burned* from pack weight,
  terrain, pace and temperature (Pandolf equation) instead of making you type a target
  in. A natural later upgrade now that targets exist (section 14).
- **Richer public food share.** Additive if the audience ever materializes (section 7).
- **The old build's nutrition summary strips** (headline strip, DayTotalsStrip,
  FoodPlanSummary's all-days target table): not ported in slice 7b v1 - the per-day
  review panel is the grading surface, and the strips are additive polish that can
  land later with zero schema or wire changes. (Section 14.6.)

(Rev 1 also deferred "clearing pack rows on entry delete". That is **no longer
deferred** - it is rule 2 of section 6, and it is correctness. Rev 5 deferred
nutrition targets wholesale; they are now designed in section 14 and shipping as
slices 7a/7b.)

---

## 14. Nutrition targets (designed 2026-07-18; slices 7a/7b)

The last subsystem of the rewrite. Targets let a plan say "aim for 3000-3500 kcal
per full day" or "dinner should be under 35% fat", and the review UI grades each
day against them. NOT a verbatim port: the old build's diff-based save RPC, its
stored `mode='off'` rows in per-plan tables, and its all-days summary strips are
all deliberately dropped (14.6). Slice 7a is the backend (schema, save/defaults
routes, copy semantics, day-type endpoint, takeout v4); 7b is the frontend
(nutrition math, grading, editors, day review, Settings).

### 14.1 Schema: off is unrepresentable, everywhere

Migration 0012 adds the three tables from 2.2. The structural rule that governs
all of them: **a target that is off is a row that does not exist.** The old build
stored `mode='off'` rows in the per-plan tables (but forbade them in defaults);
the rewrite makes the representation uniform - `mode` is CHECKed to
`('range','min','max')` in every table, so "off" cannot be stored anywhere and
readers never filter it out.

- `food_plan_daily_targets` - `(id, food_plan_id, user_id, metric, mode,
  target_min, target_max)`. Composite FK `(food_plan_id, user_id)` ->
  `food_plans(id, user_id)` CASCADE; `UNIQUE(food_plan_id, metric)`.
- `meal_targets` - the same plus `meal_id`, doubly pinned: the plan FK above AND
  `(meal_id, food_plan_id)` -> `meals(id, food_plan_id)` CASCADE, so a target can
  never point at another plan's meal even if the repo misses a check.
  `UNIQUE(meal_id, metric)`.
- `food_plan_target_defaults` - account-level, `UNIQUE(user_id, metric)`, only
  the plain `user_id` cascade.

Bounds are CHECKed as a backstop behind zod (which is the real gate, 14.2):
each bound is `NULL or (>= 0 and < 100000000)` (the old numeric(12,4) magnitude),
and the mode dictates shape - `min` requires target_min alone, `max` requires
target_max alone, `range` requires both with `min <= max`. Percent metrics
(`fat_pct`, `sugar_pct`) get a `<= 100` ceiling on both bounds.

**Metrics.** Daily: `calories, protein, carbs, fiber, sodium, calorie_density`.
Meal: `calories, protein, fat_pct, sugar_pct, carb_protein_ratio`. Canonical
units: kcal, grams, mg sodium, kcal/g density. There is no `sort_order` column -
targets are a keyed set, and reads order by `(metric)` / `(meal_id, metric)` so
documents are deterministic without write-side bookkeeping.

### 14.2 The save API is a full replace

`PUT /api/food-plans/:id/targets` takes the complete target state - `daily`
(<= 6, one per metric) and `meals` (<= 100 across <= 20 meals, one per
(meal, metric)) - and replaces everything: one `db.batch` of [delete all daily,
delete all meal, chunked inserts]. Omitting a target IS turning it off, which is
what makes no-off storage workable. Target ids are re-minted server-side on every
save; nothing downstream holds a target id across saves.

Zod does the real validation (modes, bounds, 4-decimal scale, percent ceiling,
duplicate metric / duplicate (mealId, metric) rejection - 400). The repo then
prechecks meal ownership **inverted**: it selects the plan's own <= 20 meals and
checks membership in JS, rather than `inArray`-ing the payload's meal ids - a
zod-valid payload can carry 100 distinct foreign ids, which would blow the D1
100-param cap. A foreign meal id is 422 `invalid_ref` with zero writes. The
precheck races with a concurrent meal delete; the composite FK catches that, and
the repo maps the FK violation to the same 422 instead of a 500.

Full-replace loses concurrent edits (two tabs editing targets - last writer
wins). Accepted: same trade-off every other editor in the app makes, and the
payload is the whole state so the loss is coherent, never a half-merge.

### 14.3 Defaults: copied by value at plan creation

`GET`/`PUT /api/target-defaults` manage the account-level set (Settings UI in
7b); PUT is the same full-replace shape (<= 6, one per metric). Plan creation
**snapshots** the defaults into `food_plan_daily_targets` - copy by value, once.
Editing defaults later never rewrites existing plans, and clearing defaults
leaves them untouched. This is the old build's semantic, kept on purpose: a
plan's targets are the plan's, and defaults are just the starting point.

### 14.4 Duplicates carry targets

`readPlanGraph`/`buildPlanCopyStatements` (the shared copy machinery behind plan
duplicate and "Duplicate & attach") grow the two per-plan target tables. Daily
targets copy directly; meal targets remap `meal_id` through the same id map the
entries already use. Fresh ids throughout, chunked inserts, same one-batch
atomicity as the rest of the copy.

### 14.5 Day type and grading (7b consumes; 7a ships the endpoint)

`PATCH /api/food-plans/:id/days/:dayId` sets `day_type_override` to `'full'`,
`'partial'`, or null (auto). The update predicate is three-column - `(id,
food_plan_id, user_id)` - so a same-user cross-plan day id is a 404, not a
mutation.

Grading (7b, pure modules):

- **dayType** = `dayTypeOverride ?? (every anchor-role meal scheduled on the day
  -> 'full' : 'partial')`; `every` over an empty anchor set is vacuously full.
- **Daily targets grade only full days**; partial days show as neutral. Meal
  targets always grade.
- `evaluateTarget` -> `off | incomplete | neutral | pass | under | over`, no
  near-miss tolerance. `incomplete` propagates from the nutrition math: a
  packages-basis entry whose food lacks `servingsPerPackage` makes every
  nutrient it touches incomplete rather than silently zero.
- `fat_pct`/`sugar_pct` are percent of **macro** calories (fat*9 + carbs*4 +
  protein*4), ceilinged at 100. `calorie_density` divides by **unrounded**
  `projectFoodGrams` output - never the plan view's display-rounded grams
  (section 12.10 discipline applies to grading too).

### 14.6 Boundaries: takeout, sharing, and what is not ported

- **Takeout.** `food-data.json` bumps to **version 4**: top-level
  `targetDefaults` plus per-plan `dailyTargets`/`mealTargets` riding in the plan
  documents. Compat rule: a v3 archive is simply targets-empty - no migration
  step, absent means none.
- **Public shares are unchanged.** D6 (weight-only) stands; no target data
  crosses the share boundary, and the old build's public MealTargetsBar dies
  with it.
- **Not ported:** the diff-based save RPC (full replace is simpler and the
  contradiction classes it guarded against cannot be expressed in the new
  payload); stored `off` rows; the sample-plan onboarding feature (never ported
  at all); and the all-days summary strips, which are deferred, not dead
  (section 13).

### 14.7 7b UI surfaces (shipped with slice 7b)

- **Editor header: a `Targets` action at every breakpoint.** The plan sketch
  put it behind the add-affordance breakpoint split, but that rule exists for
  pages with a mobile bottom action bar duplicating a header control - the
  plan EDITOR has no bottom bar (MobilePlanActionBar belongs to the Plans
  index), so a single always-visible header button duplicates nothing.
- **Day header:** an Auto/Full/Partial native select wired to the 14.5 PATCH
  (the plan sketched a kebab item; the editor has no per-day kebab), a
  "Partial day" tag whenever the derived dayType is partial, and a gauge
  icon opening the day's nutrition review.
- **DayNutritionReview:** mobile bottom sheet; on lg the editor becomes a
  two-column grid with the panel sticky in the right column. It reads the
  LIVE plan view each render, so edits re-grade immediately and deleting the
  day closes it.
- **Editors submit full arrays** (14.2), which makes per-field canonical
  preservation load-bearing for EVERY stored row, not just dirty ones: an
  untouched bound resubmits its stored canonical kcal/g value rather than a
  re-parse of the 2dp display string, and the baseline rows + weight unit
  freeze once at dialog open so a mid-edit unit toggle cannot corrupt them.
- **Settings defaults section** blocks editing on a failed read - with a
  full-replace save, an editor seeded from a failed load reading as "no
  defaults" would overwrite real rows with nothing.
- Old `nutrition.ts` members that only fed unported surfaces stayed behind:
  `summarizeTrip`/`derivedValue` (all-days strips, section 13) and
  `sodiumDensity` (MealTargetsBar-only). Value formatters that already
  existed in `serving-format.ts` are reused, not duplicated.
