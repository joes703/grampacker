# Route authorization matrix

Every API route gets a row BEFORE it ships, and the row drives its tests
(owner / non-owner / anon at minimum; cross-parent stitching for child
resources). A route without a row, or a row without tests, fails review.

| Route | Methods | Auth | Ownership | Request DTO | Response DTO | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/health` | GET | anon | - | - | `HealthResponse` | dev/deploy smoke |
| `/api/auth/*` | GET, POST | better-auth | n/a (owns its tables) | better-auth | better-auth | better-auth's own origin validation (verified: forged origin -> 403 INVALID_ORIGIN); flow covered in `server/test/auth-helpers.ts` |
| `/api/me` | GET | session | self only (`user.id = session.userId`, fixed in repo) | - | `MeResponse` (no `name`: grampacker never stores one; `server/auth.ts` databaseHooks blank it. `passkeyCount` is DERIVED, scoped to the caller) | `server/routes/me.test.ts` |
| `/api/auth/sign-in/magic-link` | POST | **anon** | n/a. The root of trust: redeeming the link CREATES the account if the address is new, so this is sign-up and sign-in at once. Never reveals whether the address exists | better-auth (`{ email }`; an optional `name` is accepted by the plugin and blanked by databaseHooks) | 200 `{ status: true }` regardless | `server/middleware/rate-limit.test.ts` (IP + per-email budgets), `server/test/auth-helpers.ts` (every server test drives this flow) |
| `/api/auth/magic-link/verify` | **GET** | **anon**, bearing a single-use token | n/a. A side-effecting GET: consumes the token, creates the user (`emailVerified: true`), mints a session. Token is hashed at rest, 5-minute TTL, single-use (atomic consume). NOT in the read-only GET allowlist - it is metered like a mutation | `?token=` | 200 + `Set-Cookie`; 400 `INVALID_TOKEN` (also for expired/reused) | `server/middleware/rate-limit.test.ts`, `server/test/auth-helpers.ts` |
| `/api/auth/passkey/{generate-register-options, verify-registration, delete-passkey}` | POST | session **+ FRESH session** | The endpoints that change WHICH CREDENTIALS CAN SIGN IN. Session must have been CREATED within `FRESH_AGE_SECONDS` (24h) or 403 `REAUTH_REQUIRED`. Re-auth = a new sign-in ceremony (passkey, or a magic link), which mints a fresh session. There is no proof table: the session row IS the proof | better-auth | better-auth | `server/middleware/fresh-auth.test.ts` |
| `/api/auth/passkey/*` (the rest) | POST/GET | session, or anonymous for sign-in | NOT gated: `update-passkey` (renames a label; the plugin writes only the `name` column), `generate-authenticate-options` + `verify-authentication` (the anonymous sign-in ceremony - gating them would make passkey sign-in impossible), `list-user-passkeys` (a read) | better-auth | better-auth | `server/middleware/fresh-auth.test.ts` |
| `/api/auth/delete-user` | POST | session **+ FRESH session** | Irreversible, and every table cascades from `user.id`. The client sends NO password (there is none); better-auth's own route then enforces `session.freshAge` itself and answers 400 `SESSION_EXPIRED` when stale. A `beforeDelete` hook purges the user's `verification` rows - including any PENDING MAGIC LINK for that address, which would otherwise resurrect the account after deletion | `{}` | 200; 400 `SESSION_EXPIRED` | `server/auth-delete-user.test.ts` |
| `/api/categories` | GET, POST | session | own rows only (repo-scoped) | `CreateCategoryRequest` (POST) | `CategoryResponse[]` / `CategoryResponse` | `server/routes/categories.test.ts` |
| `/api/categories/order` | PUT | session | every id owned or 404, zero writes | `ReorderRequest` | 204 | `server/routes/categories.test.ts` |
| `/api/categories/:id` | PATCH, DELETE | session | own row or 404; DELETE uncategorizes its gear in the same transaction | `UpdateCategoryRequest` (PATCH) | `CategoryResponse` / 204 | `server/routes/categories.test.ts` |
| `/api/gear-items` | GET, POST | session | own rows only; POST validates category ownership (composite FK backstop) | `CreateGearItemRequest` (POST) | `GearItemResponse[]` / `GearItemResponse` | `server/routes/gear-items.test.ts` |
| `/api/gear-items/order` | PUT | session | every id owned or 404, zero writes | `ReorderRequest` | 204 | `server/routes/gear-items.test.ts` |
| `/api/gear-items/import` | POST | session | creates own categories + items in one transaction; 400 on non-owned category, 422 at the cap, zero writes on any failure | `ImportGearRequest` | `ImportGearResponse` | `server/routes/gear-items.test.ts` |
| `/api/gear-items/bulk-delete` | POST | session | every id owned or 404, zero writes | `BulkDeleteRequest` | 204 | `server/routes/gear-items.test.ts` |
| `/api/gear-items/bulk-move` | POST | session | every id + target category owned, else 404/400, zero writes | `BulkMoveRequest` | 204 | `server/routes/gear-items.test.ts` |
| `/api/gear-items/:id` | PATCH, DELETE | session | own row or 404; PATCH validates category ownership | `UpdateGearItemRequest` (PATCH) | `GearItemResponse` / 204 | `server/routes/gear-items.test.ts` |
| `/api/food-items` | GET, POST | session | own rows only (repo-scoped); POST 422 at the 1000-food cap. Never anon-reachable (the only anon food data is the share's weight object, slice 5) | `CreateFoodItemRequest` (POST) | `FoodItemResponse[]` / `FoodItemResponse` | `server/routes/food-items.test.ts` |
| `/api/food-items/import` | POST | session | creates own rows in one transaction; 422 at the cap, zero writes on any failure | `ImportFoodRequest` | `ImportFoodResponse` | `server/routes/food-items.test.ts` |
| `/api/food-items/:id` | PATCH, DELETE | session | own row or 404 | `UpdateFoodItemRequest` (PATCH) | `FoodItemResponse` / 204 | `server/routes/food-items.test.ts` |
| `/api/food-plans` | GET, POST | session | own plans only (repo-scoped); POST seeds 3 meals + N days + grid atomically, 422 at the 100-plan cap. Never anon-reachable (food-planning-design.md slice 2) | `CreateFoodPlanRequest` (POST) | `FoodPlanSummary[]` / `FoodPlanDocument` | `server/routes/food-plans.test.ts` |
| `/api/food-plans/:id` | GET, PATCH, DELETE | session | own plan or 404; PATCH renames; DELETE runs the atomic detach-then-delete batch (detach the holding list - at most one - then delete the plan graph via cascade) - the NO-ACTION FK is the hard backstop so a skipped detach fails loudly rather than orphaning a list (food-planning-design.md 2.3.1) | `RenameFoodPlanRequest` (PATCH) | `FoodPlanDocument` / 204 | `server/routes/food-plans.test.ts` |
| `/api/food-plans/:id/duplicate` | POST | session | own plan or 404; deep-copies the plan graph with fresh ids (chunked multi-row inserts, one batch), 422 at the 100-plan cap; optional listId ("Duplicate & attach") must be the caller's list (422 otherwise) - the attach is a CAS on `expectedFoodPlanId`, the link the client observed on that list (null = none; omitted defaults to null, the fail-safe reading), and the copy replaces that list's plan in the same transaction; a stale expectation is a 422 with the committed copy compensating-deleted | `DuplicateFoodPlanRequest` (optional body) | `FoodPlanDocument` | `server/routes/food-plans.test.ts` |
| `/api/food-plans/:id/days` | POST | session | own plan or 404; appends a day + full grid row, 422 at the 60-day cap | - | `FoodPlanDocument` | `server/routes/food-plans.test.ts` |
| `/api/food-plans/:id/days/:dayId` | DELETE | session | own plan or 404; cascades the day's cells + entries | - | `FoodPlanDocument` | `server/routes/food-plans.test.ts` |
| `/api/food-plans/:id/meals` | POST | session | own plan or 404; adds a meal on every day, 422 at the 20-meal cap | `AddMealRequest` | `FoodPlanDocument` | `server/routes/food-plans.test.ts` |
| `/api/food-plans/:id/meals/:mealId` | DELETE | session | own plan or 404; cascades the meal's cells + entries | - | `FoodPlanDocument` | `server/routes/food-plans.test.ts` |
| `/api/food-plans/:id/day-meals` | POST | session | own plan or 404; schedules a cell (idempotent), 422 if the day/meal is not in the plan | `AddDayMealRequest` | `FoodPlanDocument` | `server/routes/food-plans.test.ts` |
| `/api/food-plans/:id/day-meals/:dayMealId` | DELETE | session | own plan or 404; omits a cell, cascades its entries | - | `FoodPlanDocument` | `server/routes/food-plans.test.ts` |
| `/api/food-plans/:id/entries` | POST | session | own plan or 404; 422 if food/cell not in the plan, 409 if the food is already there, 422 at the 2000-entry cap | `AddEntryRequest` | `FoodPlanDocument` | `server/routes/food-plans.test.ts` |
| `/api/food-plans/:id/entries/:entryId` | PATCH, DELETE | session | own plan or 404; PATCH edits basis/amount (packages-without-serving-count allowed, projection flags incomplete) | `UpdateEntryRequest` (PATCH) | `FoodPlanDocument` | `server/routes/food-plans.test.ts` |
| `/api/food-plans/:id/targets` | PUT | session | own plan or 404; FULL replace of the plan's daily + meal targets (delete-all + insert-all, one batch); 422 if any mealId is not this plan's (inverted precheck + composite-FK backstop, FK race maps to 422 not 500); bounds/pct/duplicate rules are zod 400s, mirrored by DB CHECKs; `off` never crosses the wire (off = row absent) | `SaveTargetsRequest` | `FoodPlanDocument` | `server/routes/food-plans.test.ts` |
| `/api/target-defaults` | GET, PUT | session | own rows only (repo-scoped); PUT is a FULL replace (delete-all + insert-all, one batch, max 6 rows); copied by value into each NEW plan at create - never touches existing plans; same zod bounds/duplicate 400s as plan targets | `SaveTargetDefaultsRequest` (PUT) | `TargetDefaultsResponse` | `server/routes/target-defaults.test.ts` |
| `/api/lists` | GET, POST | session | own rows only (repo-scoped); POST 422 at the 100-list cap | `CreateListRequest` (POST) | `ListResponse[]` / `ListResponse` (carries `foodPlanId`, nullable - the attached plan pointer) | `server/routes/lists.test.ts` |
| `/api/lists/order` | PUT | session | every id owned or 404, zero writes; never bumps `updatedAt` | `ReorderListsRequest` | 204 | `server/routes/lists.test.ts` |
| `/api/lists/from-selection` | POST | session | every gear id owned or 400, zero writes; atomic list+items batch | `CreateListFromSelectionRequest` | `ListResponse` | `server/routes/lists.test.ts` |
| `/api/lists/import` | POST | session | every existing category/gear ref owned or 400, zero writes; creates list + categories + gear + items in one transaction; 422 at the list/gear caps | `ImportListRequest` | `ListResponse` | `server/routes/lists.test.ts` |
| `/api/lists/:id/duplicate` | POST | session | own list or 404; copy resets `isShared`/`isDraft`, mints a fresh slug; a plan backs at most one list, so when the source has a food plan its whole graph is deep-copied in the same batch and the copy points at the NEW plan (422 `plan_cap_exceeded` at the 100-plan cap, nothing committed); copies no pack state | - | `ListResponse` | `server/routes/lists.test.ts` |
| `/api/lists/:id` | PATCH, DELETE | session | own list or 404; DELETE cascades membership rows (composite FK), never gear; `isShared` patchable (the share/unshare toggle) | `UpdateListRequest` (PATCH) | `ListResponse` / 204 | `server/routes/lists.test.ts` |
| `/api/lists/:id/food-plan` | PUT, DELETE | session | own list or 404; PUT attaches an OWNED food plan (400 `invalid_plan` if the plan is not the caller's - the composite `(food_plan_id, user_id)` FK is the structural backstop) that no OTHER list holds (409 `plan_in_use` otherwise; one plan per trip, `lists_food_plan_id_unique` is the structural backstop, re-attaching a list's own plan is a no-op 200), DELETE detaches. A live reference on `lists.food_plan_id`, not a copy. Both clear the list's `food_pack_state` in the same batch when the link moves (design 6 rule 1; a no-op re-attach of the same plan keeps its checkmarks) | `AttachFoodPlanRequest` (PUT) | `ListResponse` | `server/routes/lists.test.ts`, `server/routes/food-pack.test.ts` |
| `/api/lists/:id/food-pack` | GET, DELETE | session | own list or 404. GET reads the list's packed food ids (row presence in `food_pack_state` means packed). DELETE is "Reset packed" for food: clears every pack row on the list unconditionally - same end state as rule 1's clear-on-relink, so it needs no CAS | - | `FoodPackStateResponse` / 204 | `server/routes/food-pack.test.ts` |
| `/api/lists/:id/food-pack/:foodItemId` | PUT | session | own list or 404. The pack toggle, BOTH directions gated by a compare-and-swap on `expectedFoodPlanId` - the plan link the client observed (food-planning-design.md 6, rule 3): pack additionally requires the food to be in that plan; a lost CAS is `applied: false` with zero rows written, NOT an error; packing twice is idempotent (`ON CONFLICT DO NOTHING`). A toggle naming another user's list or food affects zero rows | `ToggleFoodPackRequest` | `ToggleFoodPackResponse` | `server/routes/food-pack.test.ts` |
| `/api/lists/:id/items` | GET, POST | session | own list or 404; POST validates gear ownership (400) + 422 at the 300-item cap | `AddListItemRequest` (POST) | `ListItemResponse[]` / `ListItemResponse` | `server/routes/lists.test.ts` |
| `/api/lists/:id/items/quick-add` | POST | session | own list + own category; gear+item in one atomic batch, either cap 422s the whole call | `QuickAddListItemRequest` | `ListItemResponse` | `server/routes/lists.test.ts` |
| `/api/lists/:id/items/order` | PUT | session | every item in THIS list or 404, zero writes; never bumps `updatedAt` | `ReorderListItemsRequest` | 204 | `server/routes/lists.test.ts` |
| `/api/lists/:id/items/reset-packed` | POST | session | own list or 404 | - | 204 | `server/routes/lists.test.ts` |
| `/api/lists/:id/items/reset-ready` | POST | session | own list or 404 | - | 204 | `server/routes/lists.test.ts` |
| `/api/lists/:id/items/:itemId` | PATCH, DELETE | session | item must belong to THIS list and user (parent-path consistency) or 404 | `UpdateListItemRequest` (PATCH) | `ListItemResponse` / 204 | `server/routes/lists.test.ts` |
| `/api/shares/:slug` | GET | anon | gated on `lists.is_shared`; unknown slug and unshared list are the same 404; response is the strict public allowlist (`SharedListResponse`: no user ids, no `isPacked`/`isReady`, no gear `status`/`cost`/`purchaseDate`, no timestamps), enforced field-by-field in the handler and asserted by forbidden-key tests | - | `SharedListResponse` | `server/routes/shares.test.ts` |
| `/*` (assets catch-all) | any | anon | - (static files / SPA shell via ASSETS binding; the binding itself serves GET/HEAD only) | - | - | `server/middleware/security-headers.test.ts` (shell + header coverage) |

Cross-cutting, tested in `server/middleware/csrf.test.ts`:

- Unsafe methods on non-auth routes require the `x-grampacker-request`
  header and a matching `Origin` (`server/middleware/csrf.ts`).
- Session-gated routes 401 without a cookie (`server/middleware/session.ts`).
- Handlers receive user-scoped repositories only; ownership is fixed
  server-side and never read from the client.

Rate limiting, tested in `server/middleware/rate-limit.test.ts`:

- `/api/auth/*` is limited per client IP (`CF-Connecting-IP`), fixed
  windows in the `rate_limits` table: sign-in 10/10min (which now means the
  passkey ceremony - it does NOT live under `/sign-in/*`, so it is matched by
  path, not by prefix), magic-link verify 10/10min, delete-user 5/10min,
  everything else 30/10min. Over budget -> 429 + `Retry-After`.
- **Magic-link send is charged to THREE buckets** - global (90/day), per-IP
  (10/10min), per-address (5/hour) - because no single key stops all three
  abuses:
  - *global* guards the mail provider's quota, which is itself global (Resend
    free tier is 100/day). A per-IP cap cannot: a handful of IPs still drains
    the provider. This is the one number to raise when the quota rises (SES).
  - *per-address* is the only one that stops inbox-bombing and token-farming
    from rotating IPs, where every request looks like a first-time caller. Its
    key is an HMAC of the **lowercased, untrimmed** address (auth secret as the
    pepper): lowercased because better-auth treats `Victim@` and `victim@` as
    one account; untrimmed because better-auth rejects `"victim@x.com "` outright,
    so trimming would let junk charge the victim's real bucket; HMAC'd because
    `rate_limits.key` would otherwise become a plaintext list of every address
    that ever asked for a link.
  - charge order is **IP -> address -> global**: a request the narrower caps
    already refused never spends the shared quota, so the global count tracks
    mail actually SENT, not attempts.
- This limiter is the ONLY one. better-auth's own is disabled (`authOptions`),
  which means **the rate-limit rule the magic-link plugin ships never fires**.
  Reading the plugin source would suggest magic links are covered. They are not,
  except by the rules above.
- IPv6 clients are bucketed by **/64 prefix**, not exact address
  (`server/middleware/client-ip.ts`): a single allocation holds 2^64
  addresses, so keying the exact address would let any IPv6 client mint
  unlimited budget. IPv4 stays exact, and IPv4-mapped IPv6
  (`::ffff:1.2.3.4`) is unwrapped to its IPv4 address so those clients
  neither escape their bucket nor all collapse into one.
- Fail-closed across ALL methods since PR #10: better-auth GETs are not
  read-only (the passkey challenge endpoint is an unauthenticated GET
  that writes a verification row, and `magic-link/verify` is a GET that
  CREATES A USER AND MINTS A SESSION). Only the allowlisted pure-read GETs
  (`get-session`, `passkey/list-user-passkeys`) are exempt. Budgets and
  the allowlist live in `server/middleware/rate-limit.ts`.

Response headers, tested in `server/middleware/security-headers.test.ts`:

- Every response (SPA shell, assets, API, errors) carries the shared
  security-header map (`server/middleware/security-headers.ts`);
  `run_worker_first: true` means no path bypasses the Worker.
