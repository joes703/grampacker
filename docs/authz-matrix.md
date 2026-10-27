# Route authorization matrix

**BINDING, maintained against the code.** The authority on who can call what.
A route without a row, or a row that disagrees with its handler, is a defect.

Every API route gets a row BEFORE it ships, and the row drives its tests
(owner / non-owner / anon at minimum; wrong parent for child resources). A
route without a row, or a row without tests, fails review.

A row states facts: the caller, the ownership rule, the status codes, the
zero-write requirements and the tests. The reasons live in the code comments
next to each rule and in `SECURITY.md`.

"Own ... or 404" means a non-owner gets the same 404 as a missing row.
"Zero writes" means a refused request changes no row.

| Route | Methods | Auth | Ownership | Request DTO | Response DTO | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/health` | GET | anon | - | - | `HealthResponse` | dev/deploy smoke |
| `/api/auth/*` | GET, POST | better-auth | n/a (owns its tables) | better-auth | better-auth | better-auth's own origin check (forged origin -> 403 `INVALID_ORIGIN`, `server/auth-origin-validation.test.ts`); flow covered in `server/test/auth-helpers.ts` |
| `/api/me` | GET | session | self only (`user.id = session.userId`, fixed in repo) | - | `MeResponse` (no `name`; `passkeyCount` counts the caller's passkeys only) | `server/routes/me.test.ts` |
| `/api/auth/sign-in/magic-link` | POST | **anon** | n/a. Redeeming the link creates the account if the address is new, so this is sign-up and sign-in. Never reveals whether the address exists | better-auth (`{ email }`; an optional `name` is accepted and blanked by databaseHooks) | 200 `{ status: true }` regardless | `server/auth-origin-validation.test.ts` (trusted, forged, cookieless and originless sends), `server/middleware/rate-limit.test.ts` (IP, per-address and global budgets), `server/test/auth-helpers.ts` (every server test drives this flow) |
| `/api/auth/magic-link/verify` | **GET** | **anon**, with a single-use token | n/a. A GET that writes: consumes the token, creates the user (`emailVerified: true`), mints a session. Tokens are stored hashed with a 5-minute TTL; better-auth enforces expiry and single use. Rate-limited like a write | `?token=` | 200 + `Set-Cookie` (JSON, not a redirect); invalid tokens rejected by better-auth | `server/auth-options.node.test.ts` (storage and TTL settings), `server/auth-delete-user.test.ts` (a link purged on deletion is rejected; not a general expiry/replay suite), `server/middleware/rate-limit.test.ts`, `server/test/auth-helpers.ts` (successful redemption) |
| `/api/auth/passkey/*` (default) | POST/GET | session **+ FRESH session** | Deny by default: every passkey endpoint not in `PASSKEY_UNGATED` (`server/auth.ts`) - today generate-register-options, verify-registration, delete-passkey, and any endpoint a future plugin version adds - needs a session created within `FRESH_AGE_SECONDS` (24h), else 403 `SESSION_NOT_FRESH`. Checked in better-auth `hooks.before` on the resolved endpoint path. A new sign-in mints a fresh session | better-auth | better-auth | `server/passkey-gate.test.ts` (stale/fresh, per session), `server/auth-options.node.test.ts` (future paths fail closed) |
| `/api/auth/passkey/*` (ungated) | POST/GET | session, or anon for sign-in | Not freshness-gated: `update-passkey` (renames the label only), `generate-authenticate-options` + `verify-authentication` (anonymous sign-in), `list-user-passkeys` (read). Rename and delete touch only the caller's own credential (plugin `requireResourceOwnership`): a non-owner gets 401 and the row is unchanged. List returns only the caller's passkeys | better-auth | better-auth | `server/passkey-gate.test.ts` (owner / non-owner / anon, stale rename and read), `server/auth-options.node.test.ts` (ungated list, user-verification callbacks) |
| `/api/auth/delete-user` | POST | session **+ FRESH session** | Self only; every table cascades from `user.id`. No password. better-auth enforces `session.freshAge` (stale -> 400 `SESSION_EXPIRED`). A `beforeDelete` hook refuses unless the `x-grampacker-delete-user-id` header equals the session's user id, then purges the user's `verification` rows (pending magic links included); `afterDelete` purges them again | `{}` + `x-grampacker-delete-user-id` header | 200; 400 `SESSION_EXPIRED`; 400 `DELETE_ACCOUNT_MISMATCH` (header missing or names another account) | `server/auth-delete-user.test.ts` |
| `/api/categories` | GET, POST | session | own rows only (repo-scoped); POST 422 at the 500-per-user cap (`categories_user_cap` trigger) | `CreateCategoryRequest` (POST) | `CategoryResponse[]` / `CategoryResponse` | `server/routes/categories.test.ts` |
| `/api/categories/order` | PUT | session | every id owned or 404, zero writes; check and writes are one transaction | `ReorderRequest` | 204 | `server/routes/categories.test.ts`, `server/repos/gear-transactions.test.ts` (rollback) |
| `/api/categories/:id` | PATCH, DELETE | session | own row or 404; DELETE checks, uncategorizes its gear and deletes in one transaction | `UpdateCategoryRequest` (PATCH) | `CategoryResponse` / 204 | `server/routes/categories.test.ts`, `server/repos/gear-transactions.test.ts` (rollback, zero-write refusals) |
| `/api/gear-items` | GET, POST | session | own rows only; POST checks category ownership and inserts in one transaction (composite FK behind it; an FK failure is a 500); 422 at the cap; any other constraint failure is a redacted 500 | `CreateGearItemRequest` (POST) | `GearItemResponse[]` / `GearItemResponse` | `server/routes/gear-items.test.ts`, `server/repos/gear-transactions.test.ts` (concurrent category delete, 500 classification, zero-write refusals) |
| `/api/gear-items/order` | PUT | session | every id owned or 404, zero writes; check and writes are one transaction | `ReorderRequest` | 204 | `server/routes/gear-items.test.ts`, `server/repos/gear-transactions.test.ts` (rollback) |
| `/api/gear-items/import` | POST | session | creates own categories + items in one transaction; 400 on a non-owned category, 422 at the gear and category caps, zero writes on any failure | `ImportGearRequest` | `ImportGearResponse` | `server/routes/gear-items.test.ts`, `server/routes/categories.test.ts` (category cap), `server/repos/gear-transactions.test.ts` (rollback) |
| `/api/gear-items/bulk-delete` | POST | session | every id owned or 404, zero writes; check and delete are one transaction, the delete one statement (ids capped at 500) | `BulkDeleteRequest` | 204 | `server/routes/gear-items.test.ts`, `server/repos/gear-transactions.test.ts` |
| `/api/gear-items/bulk-move` | POST | session | every id + target category owned, else 404/400, zero writes; checks and write are one transaction | `BulkMoveRequest` | 204 | `server/routes/gear-items.test.ts`, `server/repos/gear-transactions.test.ts` |
| `/api/gear-items/:id` | PATCH, DELETE | session | own row or 404; PATCH checks category ownership and writes in one transaction | `UpdateGearItemRequest` (PATCH) | `GearItemResponse` / 204 | `server/routes/gear-items.test.ts`, `server/repos/gear-transactions.test.ts` |
| `/api/lists` | GET, POST | session | own rows only (repo-scoped); POST 422 at the 100-list cap | `CreateListRequest` (POST) | `ListResponse[]` / `ListResponse` | `server/routes/lists.test.ts` |
| `/api/lists/order` | PUT | session | every id owned or 404, zero writes; never bumps `updatedAt`; check and writes are one transaction | `ReorderListsRequest` | 204 | `server/routes/lists.test.ts`, `server/repos/list-transactions.test.ts` (rollback) |
| `/api/lists/from-selection` | POST | session | every gear id owned or 400, zero writes; the check, list and items are one transaction | `CreateListFromSelectionRequest` | `ListResponse` | `server/routes/lists.test.ts`, `server/repos/list-transactions.test.ts` (rollback, overlapping writes) |
| `/api/lists/import` | POST | session | every existing category/gear ref owned or 400, zero writes; the checks and the list + categories + gear + items writes are one transaction; 422 at the list/gear/category caps | `ImportListRequest` | `ListResponse` | `server/routes/lists.test.ts`, `server/routes/categories.test.ts` (category cap), `server/repos/list-transactions.test.ts` (rollback, overlapping writes) |
| `/api/lists/:id/duplicate` | POST | session | own list or 404; copies memberships, packing locations and the food plan with fresh ids; the source read and every write are one transaction; 422 at the 100-list cap | - | `ListResponse` | `server/routes/lists.test.ts`, `server/routes/food.test.ts`, `server/repos/list-transactions.test.ts` (rollback, slug retry) |
| `/api/lists/:id/share-link` | POST | session | own list or 404; mints a new slug, so the old `/r/<slug>` gives the same 404 as an unknown slug. Does not change `isShared` | - | `ListResponse` | `server/routes/lists.test.ts` |
| `/api/lists/:id` | PATCH, DELETE | session | own list or 404; DELETE cascades membership rows (composite FK), never gear. `isShared` is patchable and does not change the slug, so off then on restores the same URL. The request schema is strict: an unknown key (for example a retired one) is a 400 for the whole patch | `UpdateListRequest` (PATCH) | `ListResponse` / 204 | `server/routes/lists.test.ts` |
| `/api/lists/:id/packing-locations` | GET, POST | session | own list or 404; GET returns only this list's locations. POST creates a named location, or an item-backed container whose source item must be on this list and user (else 400); an item already backing a location is a 409. A named location appends (max sortOrder + 1); a container prepends (min sortOrder - 1, right after Unassigned); 422 at the 30-per-list cap. Checks run inside the write's immediate transaction, so an FK failure there is a 500 | `CreatePackingLocationRequest` (POST; exactly one of `name` or `containerListItemId`) | `PackingLocationResponse[]` / `PackingLocationResponse` | `server/routes/packing-locations.test.ts` (includes injected FK failures for both shapes) |
| `/api/lists/:id/packing-locations/order` | PUT | session | every id on THIS list and user or 404, zero writes; one owned-set read | `ReorderPackingLocationsRequest` | 204 | `server/routes/packing-locations.test.ts` |
| `/api/lists/:id/packing-locations/:locationId` | PATCH, DELETE | session | location on THIS list and user or 404, zero cross-parent writes. PATCH renames a named location; an item-backed location is a 409 (it shows the gear name). DELETE moves the location's gear and food to Unassigned and deletes the location in one immediate transaction; near the rank ceiling it renumbers the merged group densely; 422 `pack_rank_exhausted` only if that cannot fit; any other constraint failure, a pack-rank collision included, is a 500 and rolls back whole. Gear and membership rows remain | `UpdatePackingLocationRequest` (PATCH) | `PackingLocationResponse` / 204 | `server/routes/packing-locations.test.ts`, `server/routes/food-packing.test.ts` (food moved to Unassigned, dense renumber) |
| `/api/lists/:id/items` | GET, POST | session | own list or 404; POST checks gear ownership (400); 422 at the 300-item cap or on rank exhaustion; any other constraint failure is a 500 | `AddListItemRequest` (POST) | `ListItemResponse[]` / `ListItemResponse` | `server/routes/lists.test.ts`, `server/repos/list-transactions.test.ts` (422/500, overlapping writes, zero-write refusals) |
| `/api/lists/:id/food` | GET | session | own list or 404; slots + food items + slot links. Only this route returns the meal plan: `dayCount`, the day x meal `slots`, each item's `slotIds`, and its `isPacked`/`isReady`/`packingLocationId`/`packSortOrder`. The share returns food items without the plan (see `/api/shares/v2/:slug`) | - | `ListFoodResponse` | `server/routes/food.test.ts` |
| `/api/lists/:id/food/days` | PUT | session | own list or 404; builds or trims the day x meal grid and keeps the ids of slots that remain, so their placements remain; one transaction whose own read is the response. 400 past the 30-day cap | `SetFoodDaysRequest` | `ListFoodResponse` | `server/routes/food.test.ts`, `server/repos/food-transactions.test.ts` (rollback, overlapping writes) |
| `/api/lists/:id/food/items` | POST | session | own list or 404; every `slotIds` entry must be on THIS list, else 400. 422 at the 200-item cap or on rank exhaustion; any other constraint failure is a 500. Checks and writes are one transaction | `CreateFoodItemRequest` | `FoodItemResponse` | `server/routes/food.test.ts`, `server/repos/food-transactions.test.ts` (rollback, 422/500 classification, overlapping writes) |
| `/api/lists/:id/food/items/:itemId` | PATCH, DELETE | session | own list or 404; item must be on that list. `slotIds` absent = links unchanged, `[]` = unscheduled; every entry must be on THIS list, else 400 with the item's links unchanged (one transaction, rolls back whole). `packingLocationId` must name a location on THIS list and user (checked in the write's transaction, with the `list_food_items_location_same_list_*` triggers behind it), else 400 with zero writes - including another of the same user's lists; 422 on rank exhaustion; any other constraint failure is a 500 | `UpdateFoodItemRequest` (PATCH) | `FoodItemResponse` / 204 | `server/routes/food.test.ts`, `server/routes/food-packing.test.ts` (pack fields, non-owner 404, cross-list and cross-user locations), `server/repos/food-transactions.test.ts` (rollback, 422/500 classification, overlapping writes) |
| `/api/lists/:id/items/quick-add` | POST | session | own list + own category; the checks, gear and item are one transaction; either cap is a 422 for the whole call | `QuickAddListItemRequest` | `ListItemResponse` | `server/routes/lists.test.ts`, `server/repos/list-transactions.test.ts` (rollback) |
| `/api/lists/:id/items/order` | PUT | session | every item in THIS list or 404, zero writes; never bumps `updatedAt`; check and writes are one transaction | `ReorderListItemsRequest` | 204 | `server/routes/lists.test.ts`, `server/repos/list-transactions.test.ts` (rollback) |
| `/api/lists/:id/items/pack-order` | PUT | session | every id (gear and food, as an `{ items, foodItems }` object; a bare array is a 400) in THIS list or 404, zero writes; never bumps `updatedAt`; 400 on a payload that spans two groups, names a worn row, or is not index-safe (a rank repeated within one table, or a rank equal to an untouched row of the same table and group; free ranks are allowed); a pack-rank collision is a 500; one immediate transaction, a refused reorder rolls back whole | `ReorderPackListItemsRequest` | 204 | `server/routes/packing-locations.test.ts` (gear), `server/routes/food-packing.test.ts` (gear + food payloads, cross-user food id 404), `server/repos/pack-transactions.test.ts` (real SQLite 500 and rollback), `server/routes/lists.test.ts` (anon 401) |
| `/api/lists/:id/items/reset-packed` | POST | session | own list or 404; clears gear and food packed flags in one transaction | - | 204 | `server/routes/lists.test.ts`, `server/routes/food-packing.test.ts` (food), `server/repos/list-transactions.test.ts` (rollback) |
| `/api/lists/:id/items/reset-ready` | POST | session | own list or 404; clears gear and food ready flags in one transaction | - | 204 | `server/routes/lists.test.ts`, `server/routes/food-packing.test.ts` (food), `server/repos/list-transactions.test.ts` (rollback) |
| `/api/lists/:id/items/:itemId` | PATCH, DELETE | session | item on THIS list and user or 404. A non-null `packingLocationId` must be on the same list and user, and cannot make a container hold itself or create a nesting cycle; otherwise 400, zero writes. `null` unassigns; absent leaves it unchanged. A move is a 422 on rank exhaustion; any other constraint failure, a pack-rank collision included, is a 500. Read, checks, write and response read-back are one transaction. Deleting an item that backs a location removes that container and unassigns its contents without deleting them | `UpdateListItemRequest` (PATCH) | `ListItemResponse` / 204 | `server/routes/lists.test.ts`, `server/routes/packing-locations.test.ts`, `server/repos/list-transactions.test.ts` (422/500, read-back, zero-write refusals) |
| `/api/shares/v2/:slug` | GET | anon | gated on `lists.is_shared`; an unknown slug and an unshared list give the same 404. The response is the strict public DTO (`SharedListResponse`: no user ids, no `isPacked`/`isReady`, no gear `status`/`cost`/`purchaseDate`, no timestamps), built field by field and asserted by forbidden-key tests. Food appears as `food.items[]` with only `id`, `name`, `unitCount` (the carried count, computed on the server), `weightGrams`, `sortOrder`; no `quantity`, `isPerMeal`, day count, slots, `isPacked`/`isReady`, `packingLocationId` or `packSortOrder`. Each food item appears once (never joined to its slot links). A second statement under the same gate reads only `food_item_id` from `list_food_item_slots`, to compute `unitCount`. Every answer, the 404 included, has `Cache-Control: private, no-store`. Not rate-limited (`SECURITY.md` has the trigger). There is no unversioned `/api/shares/:slug` route | - | `SharedListResponse` | `server/routes/shares.test.ts`, `server/routes/food.test.ts` (food items appear, plan does not), `server/repos/gear-transactions.test.ts` (key sets with every private field set; missing, private and revoked 404s identical) |
| `/*` (assets catch-all) | GET, HEAD (others 405) | anon | - (static files from `STATIC_DIR`, else the SPA shell, via `server/middleware/spa.ts`; a missing file under `/assets/` is a 404, not the shell) | - | - | `server/middleware/security-headers.test.ts` (shell and headers), `server/middleware/asset-cache.test.ts` |

Cross-cutting, tested in `server/middleware/csrf.test.ts`:

- A write (not GET, HEAD or OPTIONS) to a route outside `/api/auth/*` needs
  the `x-grampacker-request` header, else 403. If an `Origin` header is sent,
  it must match, else 403; a missing `Origin` is allowed
  (`server/middleware/csrf.ts`).
- Session-gated routes answer 401 without a session
  (`server/middleware/session.ts`). `server/routes/session-gate.test.ts`
  reads every route from the app's router and proves the 401 on each one
  outside the public list (`/api/auth/*`, the share read, health), so a new
  route is covered without being listed. The test lists every wildcard
  registration, because it cannot probe one; a new one fails the test. It
  fills each `:param` with a fresh random value. A gated route whose path is
  not plain segments and `:param`s (a regex constraint, an optional param)
  fails the test.
- Handlers receive user-scoped repositories only; ownership is fixed on the
  server and never read from the client.

Rate limiting, tested in `server/middleware/rate-limit.test.ts`. Budgets,
the read-only allowlist and the reasons are in
`server/middleware/rate-limit.ts`:

- `/api/auth/*` is limited per client IP (the last `X-Forwarded-For` entry,
  written by Caddy), with fixed windows in the `rate_limits` table: passkey
  sign-in 30/5min, sign-in 10/10min, magic-link verify 10/10min,
  delete-user 5/10min, everything else 30/10min. Over budget -> 429 +
  `Retry-After`.
- The passkey sign-in ceremony has its own bucket (`passkey-sign-in`),
  matched by exact path.
- **A magic-link send is charged to three buckets:** per-IP (10/10min),
  per-address (5/hour), global (90/day), in that order. The per-address key
  is an HMAC of the lowercased, untrimmed address. The global bucket counts
  validated send attempts, not mail delivered: it is charged in
  `sendMagicLink` (`server/auth.ts`) just before the send, and the
  middleware only checks it without charging.
- This limiter is the only one. better-auth's own limiter is disabled
  (`rateLimit` in `server/auth.ts`), so the magic-link plugin's own rule
  never runs.
- IPv6 clients share a bucket per /64 prefix; IPv4 is exact, and
  IPv4-mapped IPv6 (`::ffff:1.2.3.4`) counts as its IPv4 address
  (`server/middleware/client-ip.ts`).
- Every method is metered, GETs included, because some better-auth GETs
  write (the passkey challenge; `magic-link/verify` creates a user and a
  session). Only the read-only GETs `get-session` and
  `passkey/list-user-passkeys` are exempt.

Response headers, tested in `server/middleware/security-headers.test.ts`:

- Every response (SPA shell, assets, API, errors) carries the security
  headers from Hono's `secureHeaders`, configured in
  `server/middleware/security-headers.ts`.
