# Constraints (from SPECs)

Extracted from 2 SPECs: docs/food-planning-design.md and
docs/authz-matrix.md. Both describe SHIPPED production behavior (rewrite
complete as of 2026-07-19; final slice 7b merged as PR #83). The current
text of each doc is authoritative; alternatives the docs themselves mark
superseded (e.g. the shared-plan warning banner of old 12.9, `packed_signature`,
`is_food_shared`) are recorded only as deliberate non-ports, not live options.

---

## Standalone food-plan schema: ten owner-scoped tables

- source: docs/food-planning-design.md (sections 1, 2.1, 2.2, 2.4)
- type: schema
- content: `food_plans` is standalone - has `name`, no `list_id`, no
  `is_food_shared`, no `num_nights` (day count = count of `food_plan_days`
  rows; a second source of truth is forbidden). `lists` gains nullable
  `food_plan_id` with a composite same-owner FK
  `(food_plan_id, user_id) -> food_plans(id, user_id)`, **NO ACTION** (not
  SET NULL - SQLite has no column-list SET NULL; a composite SET NULL nulls
  `user_id` and violates NOT NULL; verified by execution on sqlite3 3.53.3.
  Same pattern as `gear_items.category_id`, `server/db/app-schema.ts:59`).
  All ten tables are owner-scoped (`user_id NOT NULL` -> `user.id ON DELETE
  CASCADE`) with composite FKs inside the subtree so the food graph is
  structurally self-sealing. `day_meals` stays a table: a row means "this
  meal is enabled on this day", which an empty cell must still express.
  `food_pack_state` is keyed `(list_id, food_item_id)`; **row presence means
  packed** - no `is_packed` column, no `packed_signature`.

## Plan deletion: atomic 3-statement batch; the FK is a hard backstop

- source: docs/food-planning-design.md (sections 2.3, 2.3.1; decision 12.2)
- type: protocol
- content: deleting a plan is a repo-owned atomic `db.batch` whose order is
  load-bearing: (1) delete the attached list's `food_pack_state`, (2) null
  `lists.food_plan_id`, (3) delete the plan (cascade takes the graph). Step 1
  must precede step 2 - pack state holds no plan reference, so after the
  detach the affected list can no longer be found. The NO ACTION FK makes a
  skipped detach fail loudly (FOREIGN KEY constraint failed) rather than
  orphan anything. Account deletion still cascades cleanly through both
  tables. Required D1 tests: attached-plan delete (list survives detached,
  pack state gone), raw delete without detach fails, user delete cascades,
  cross-owner link rejected.

## One plan per trip; live reference; reuse is duplication

- source: docs/food-planning-design.md (sections 3, 3.1; decision 12.1,
  revised 2026-07-16; migration 0010)
- type: schema
- content: the list->plan link is a live reference (edit the plan, its list
  re-projects; nothing denormalized). A plan backs **at most one** list,
  enforced by the partial unique index `lists_food_plan_id_unique` on
  `lists(food_plan_id) WHERE food_plan_id IS NOT NULL`. Attaching a plan
  another list holds is 409 `plan_in_use`; re-attaching a list's own plan is
  a no-op success. Reuse is duplication: deep copy of the plan graph (meals,
  days, day_meals, entries, targets) with fresh ids, referencing the same
  account-wide `food_items`, copying NO pack state. "Duplicate & attach"
  does copy + attach in one batch; the attach UPDATE is a CAS on
  `expectedFoodPlanId` (the link the client observed; omitted defaults to
  null, the fail-safe reading) - a lost CAS compensating-deletes the
  committed copy and returns 422. List duplication deep-copies the plan too
  (the unique index forbids two holders); either cap failure aborts the
  whole batch. Rationale: gear weight is a fact about an object so
  propagation is correct; a menu is a per-trip decision so cross-trip
  propagation was an ambush. Snapshot-on-attach was rejected (two kinds of
  plan). The old shared-plan warning banner (12.9) is superseded and
  removed; what remains is orientation ("Used by" breadcrumb, "In use by"
  on cards, "Duplicate & attach" in the picker).

## Food is never a list_items row

- source: docs/food-planning-design.md (section 4; decision 12.5)
- type: schema
- content: the list's Food line is derived at read time, never stored.
  `list_items.gear_item_id` is NOT NULL - every list item IS gear; storing
  food would require a synthetic gear item with a denormalized weight, i.e.
  a voluntary cache-invalidation bug. Food is consumable by definition.

## Projection contract: one function, one joined read, round once

- source: docs/food-planning-design.md (section 5; decision 12.10)
- type: api-contract
- content: ONE canonical pure projection function in `shared/`, used by the
  SPA, the authenticated API, and the public share - no second
  implementation, no SQL re-derivation. Formulas: servings ->
  amount * serving_weight_grams; packages -> amount * servings_per_package *
  serving_weight_grams; weight -> amount. The plan document is ONE batched
  read; entries come back joined to `food_items` on
  `(food_plan_id, user_id)` - the join binds 2 params regardless of plan
  size, so the D1 100-param limit does not apply (no chunked membership
  reads). `withProjectedFood` moves only `consumableGrams` and
  `totalPackGrams`; base/worn/per-category untouched. Incomplete projection
  = a `packages`-basis entry whose food has NULL `servings_per_package`
  (serving weight is NOT NULL, so `servings`/`weight` always project); the
  incomplete flag travels with the number everywhere, including the share.
  Numeric rule: full precision through the math, round ONCE to integer
  grams at the projection DTO boundary; public and authenticated totals
  share the rounding site and must be byte-identical.

## Projection caching: derive, do not cache the derivation

- source: docs/food-planning-design.md (section 5.5, revised 2026-07-16)
- type: api-contract
- content: there is NO `foodProjection(listId)` key and NO
  `foodProjectionAll()` prefix - the projection is derived
  (`use-food-projection.ts` + `selectFoodPlanView`) from two caches the app
  already holds: `['food-plan', id]` and `['food-items']`. Invalidation is
  coarse, on settle: attach/detach/link change -> `['lists']` +
  `['shared-list']`; food and entry mutations -> food-plan keys +
  `['shared-list']` (the share cache has 30s staleTime and would otherwise
  serve a stale total). `['list-items', listId]` is NOT invalidated by food
  mutations - food is not a list item. No gear-style multi-cache optimistic
  fan-out unless profiling proves coarse invalidation inadequate.

## Pack-state lifecycle: three rules, all correctness

- source: docs/food-planning-design.md (section 6; decision 12.3)
- type: protocol
- content: Rule 1 - clear the list's `food_pack_state` in the same atomic
  batch whenever its `food_plan_id` changes or detaches (plans A and B may
  both contain ramen; without this a switch shows phantom checkmarks).
  Rule 2 - after any mutation that can remove entries from plan P, append
  ONE reconcile DELETE to the same batch removing pack rows whose food no
  longer appears anywhere in P (reconciling against what REMAINS makes
  last-occurrence and cascade coverage automatic, with no id lists and no
  param blowup; NULL-safe only because `food_item_id` is NOT NULL).
  Rule 3 - the toggle is a compare-and-swap on the OBSERVED plan id, in
  BOTH directions ("is the food in the current plan" is provably
  insufficient - cross-plan bleed-through is a wrong answer, not a stale
  one). Pack additionally requires the food to be in that plan;
  `ON CONFLICT DO NOTHING` makes packing idempotent. A lost CAS affects
  zero rows and is NOT an error: the response is the narrow
  `{ foodItemId, packed, applied }` (never the whole pack set - packing is
  the highest-frequency mutation). The ABA cycle (A -> B -> A) is accepted:
  it yields a stale state, not a wrong one; the checkbox may lie about
  QUANTITY, never about WHICH PLAN. `packed_signature`, the advisory lock,
  and PT409 are deliberately not ported. Required D1 tests: rule-1 switch,
  rule-2 multi-cell/cascade/redirect, rule-3 pack race, unpack race,
  idempotency, ownership (foreign list/food = zero rows).

## Public share: weight only, one nullable food object

- source: docs/food-planning-design.md (section 7; decision 12.4)
- type: api-contract
- content: the share DTO gains exactly `food: { weightGrams: number;
  incomplete: boolean } | null`. Nullable so "no plan attached" (no Food
  row) and "attached plan weighing zero" (zero-weight Food row) are
  distinguishable - two bare scalars cannot encode presence. `incomplete`
  is mandatory: a silently undercounted public total is worse than one that
  admits it is partial. There is NO `is_food_shared` flag - if a plan is
  attached its weight is in the total; to share without food, do not attach
  a plan. The old Gear/Food share tabs and the three public food views are
  deleted, not ported. The `items.length === 0` empty-state bug (food-only
  shared list showing "empty" while carrying food weight) was fixed in
  slice 5. Evidence for weight-only is in section 7 (shakedown culture
  consumes food as one number); a richer share is additive later.

## Food UI surface and route registry discipline

- source: docs/food-planning-design.md (section 8; decision 12.6)
- type: api-contract
- content: plans live at `/food` (Foods | Plans tabs) and
  `/food/plans/:id`; `/lists/:id/food` is dead. `/lists/:id` carries the
  derived Food row + plan picker; pack mode expands it into the per-food
  checklist folded into the packing progress counter. Every new route goes
  into docs/authz-matrix.md BEFORE implementation, with
  owner/non-owner/anon tests, per SECURITY.md. Food routes are
  session-only; the sole anon-reachable food data in the system is the
  share's food object.

## Caps and D1 limits

- source: docs/food-planning-design.md (section 9)
- type: nfr
- content: 1000 foods/user, 60 days/plan, 20 meals/plan, 2000 entries/plan,
  100 plans/user (plus the existing 100 lists). D1 caps: max 100 bound
  params/query - the projection read is immune (2-param join); plan
  duplication is not (writes cannot be joined away) and chunks at
  floor(90/columns) rows per statement (`chunkForParamCap`;
  `chunk-ids.ts` uses the same 90 for reads). Statement count per batch is
  a budget to keep low (a worst-case list duplicate is ~400 statements; the
  D1 docs are ambiguous on whether a per-invocation query cap applies to
  batched statements; correctness is safe either way since a failed batch
  commits nothing).

## Nutrition targets: off is unrepresentable; save is full replace

- source: docs/food-planning-design.md (section 14; decision 12.8;
  migration 0012)
- type: schema
- content: three tables - `food_plan_daily_targets` (composite plan FK,
  UNIQUE(food_plan_id, metric)), `meal_targets` (doubly pinned: plan FK AND
  `(meal_id, food_plan_id) -> meals(id, food_plan_id)` so a target can
  never point at another plan's meal; UNIQUE(meal_id, metric)),
  `food_plan_target_defaults` (UNIQUE(user_id, metric)). A target that is
  off is a row that does not exist, uniformly: `mode` is CHECKed to
  ('range','min','max') everywhere; `off` never crosses the wire. Bounds
  CHECKed as backstop behind zod (the real gate): mode dictates shape,
  percent metrics ceilinged at 100. No sort_order - reads order by metric.
  Daily metrics: calories, protein, carbs, fiber, sodium, calorie_density;
  meal metrics: calories, protein, fat_pct, sugar_pct, carb_protein_ratio.

## Targets API, defaults, grading, and takeout v4

- source: docs/food-planning-design.md (sections 14.2-14.7)
- type: api-contract
- content: `PUT /api/food-plans/:id/targets` is a FULL replace (delete-all +
  chunked insert-all, one batch; target ids re-minted every save;
  last-writer-wins accepted). Meal ownership precheck is INVERTED (select
  the plan's own <= 20 meals, check membership in JS - a zod-valid payload
  can carry 100 foreign ids and blow the param cap); a foreign meal id is
  422 `invalid_ref`, and the composite FK catches the precheck race, mapped
  to the same 422. `GET/PUT /api/target-defaults` is the same full-replace
  shape (<= 6); plan creation SNAPSHOTS defaults by value - editing or
  clearing defaults never touches existing plans. Duplicates carry targets
  through the shared copy machinery (meal_id remapped via the entries' id
  map). `PATCH /api/food-plans/:id/days/:dayId` sets `day_type_override`
  (full/partial/null=auto) with a three-column predicate (id, food_plan_id,
  user_id). Grading (7b, pure modules): daily targets grade only full days;
  `incomplete` propagates from unprojectable entries rather than reading as
  zero; percent metrics are of MACRO calories; `calorie_density` divides
  unrounded grams (12.10 discipline applies to grading). Takeout
  `food-data.json` is version 4 (targetDefaults + per-plan targets); a v3
  archive is simply targets-empty. Public shares carry NO target data (D6
  stands). Not ported: diff-based save RPC, stored off rows, sample-plan
  onboarding; all-days summary strips deferred, not dead.

---

## Route authorization matrix: normative gate

- source: docs/authz-matrix.md
- type: api-contract
- content: every API route gets a row BEFORE it ships, and the row drives
  its tests (owner / non-owner / anon at minimum; cross-parent stitching
  for child resources). A route without a row, or a row without tests,
  FAILS REVIEW. The matrix is the authoritative per-route contract for auth
  level, ownership scoping, request/response DTOs, and required tests; the
  full table lives in the source doc and covers health, better-auth
  (magic-link + passkey + delete-user), /api/me, categories, gear-items
  (incl. order/import/bulk ops), food-items, food-plans (incl. duplicate,
  days, meals, day-meals, entries, targets), target-defaults, lists (incl.
  order, from-selection, import, duplicate, food-plan link, food-pack,
  items), /api/shares/:slug, and the assets catch-all.

## Ownership and session model

- source: docs/authz-matrix.md (route rows + cross-cutting notes)
- type: api-contract
- content: session-gated routes 401 without a cookie; handlers receive
  user-scoped repositories only - ownership is fixed server-side and never
  read from the client. Own row or 404 (a non-owned id is indistinguishable
  from a missing one); bulk/order endpoints verify EVERY id owned or 404
  with zero writes; child resources use parent-path consistency (an item
  must belong to THIS list and user). Fresh-session routes (passkey
  generate-register-options / verify-registration / delete-passkey) answer
  403 `REAUTH_REQUIRED` when the session is older than FRESH_AGE_SECONDS
  (24h); delete-user is enforced by better-auth core and answers 400
  `SESSION_EXPIRED`; there is no proof table - the session row IS the
  proof. delete-user's beforeDelete hook purges the user's verification
  rows, including any pending magic link that would otherwise resurrect the
  account.

## CSRF contract

- source: docs/authz-matrix.md (cross-cutting; server/middleware/csrf.ts)
- type: protocol
- content: unsafe methods on non-auth routes require the
  `x-grampacker-request` header and a matching `Origin`. better-auth routes
  rely on better-auth's own origin validation (verified: forged origin ->
  403 INVALID_ORIGIN).

## Rate limiting contract

- source: docs/authz-matrix.md (cross-cutting; server/middleware/rate-limit.ts)
- type: protocol
- content: `/api/auth/*` limited per client IP (CF-Connecting-IP), fixed
  windows in `rate_limits`: sign-in 10/10min (the passkey ceremony, matched
  by path not prefix), magic-link verify 10/10min, delete-user 5/10min,
  everything else 30/10min; over budget -> 429 + Retry-After. Magic-link
  send charges THREE buckets - global 90/day, per-IP 10/10min, per-address
  5/hour - charge order IP -> address -> global (the global count tracks
  mail actually SENT); the address key is an HMAC of the lowercased,
  UNTRIMMED address. This limiter is the ONLY one: better-auth's is
  disabled, so the magic-link plugin's shipped rule never fires. IPv6
  buckets by /64 prefix; IPv4 exact; IPv4-mapped IPv6 unwrapped. Fail-closed
  across ALL methods (better-auth GETs are not read-only: the passkey
  challenge GET writes a verification row; magic-link verify CREATES a user
  and mints a session); only `get-session` and `passkey/list-user-passkeys`
  are allowlisted pure-read GETs.

## Public share surface

- source: docs/authz-matrix.md (/api/shares/:slug row)
- type: api-contract
- content: anon GET, gated on `lists.is_shared`; unknown slug and unshared
  list are the same 404. The response is the strict public allowlist
  (`SharedListResponse`: no user ids, no isPacked/isReady, no gear
  status/cost/purchaseDate, no timestamps), enforced field-by-field in the
  handler and asserted by forbidden-key tests. This is the ONLY anon-
  reachable user data surface (plus static assets).

## Security response headers

- source: docs/authz-matrix.md (cross-cutting;
  server/middleware/security-headers.ts)
- type: protocol
- content: every response (SPA shell, assets, API, errors) carries the
  shared security-header map; `run_worker_first: true` means no path
  bypasses the Worker.
