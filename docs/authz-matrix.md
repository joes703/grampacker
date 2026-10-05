# Route authorization matrix

**BINDING, maintained against the code.** The authority on who can call what.
A route without a row, or a row that disagrees with its handler, is a defect.

Every API route gets a row BEFORE it ships, and the row drives its tests
(owner / non-owner / anon at minimum; cross-parent stitching for child
resources). A route without a row, or a row without tests, fails review.

| Route | Methods | Auth | Ownership | Request DTO | Response DTO | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/health` | GET | anon | - | - | `HealthResponse` | dev/deploy smoke |
| `/api/auth/*` | GET, POST | better-auth | n/a (owns its tables) | better-auth | better-auth | better-auth's own origin validation (verified: forged origin -> 403 INVALID_ORIGIN); flow covered in `server/test/auth-helpers.ts` |
| `/api/me` | GET | session | self only (`user.id = session.userId`, fixed in repo) | - | `MeResponse` (no `name`: grampacker never stores one; `server/auth.ts` databaseHooks blank it. `passkeyCount` is DERIVED, scoped to the caller) | `server/routes/me.test.ts` |
| `/api/auth/sign-in/magic-link` | POST | **anon** | n/a. The root of trust: redeeming the link CREATES the account if the address is new, so this is sign-up and sign-in at once. Never reveals whether the address exists | better-auth (`{ email }`; an optional `name` is accepted by the plugin and blanked by databaseHooks) | 200 `{ status: true }` regardless | `server/middleware/rate-limit.test.ts` (IP + per-email budgets), `server/test/auth-helpers.ts` (every server test drives this flow) |
| `/api/auth/magic-link/verify` | **GET** | **anon**, bearing a single-use token | n/a. A side-effecting GET: consumes the token, creates the user (`emailVerified: true`), mints a session. Token is hashed at rest, 5-minute TTL, single-use (atomic consume). NOT in the read-only GET allowlist - it is metered like a mutation | `?token=` | 200 + `Set-Cookie` (no `callbackURL`, so JSON rather than a redirect); a bad, expired or reused token answers a 302 to the error callback with `error=INVALID_TOKEN` and no cookie (`server/auth-delete-user.test.ts` pins that shape) | `server/middleware/rate-limit.test.ts`, `server/test/auth-helpers.ts` |
| `/api/auth/passkey/*` (default) | POST/GET | session **+ FRESH session** | DENY-BY-DEFAULT: every passkey endpoint not on the explicit ungated list below - today generate-register-options, verify-registration, delete-passkey, plus anything a future plugin version adds - requires a session CREATED within `FRESH_AGE_SECONDS` (24h) or 403 `SESSION_NOT_FRESH`. Gated inside better-auth (hooks.before on the RESOLVED endpoint path, server/auth.ts), so no second URL parser exists to diverge. Re-auth = a new sign-in ceremony, which mints a fresh session; the session row IS the proof | better-auth | better-auth | `server/passkey-gate.test.ts` |
| `/api/auth/passkey/*` (the rest) | POST/GET | session, or anonymous for sign-in | NOT gated: `update-passkey` (renames a label; the plugin writes only the `name` column), `generate-authenticate-options` + `verify-authentication` (the anonymous sign-in ceremony - gating them would make passkey sign-in impossible), `list-user-passkeys` (a read). Rename and delete are scoped to the caller's own credential row by the plugin's `requireResourceOwnership` (a non-owner gets 401 with the row untouched); list filters by the session's user id | better-auth | better-auth | `server/passkey-gate.test.ts` (freshness gate AND owner / non-owner rows) |
| `/api/auth/delete-user` | POST | session **+ FRESH session** | Irreversible, and every table cascades from `user.id`. The client sends NO password (there is none); better-auth's own route then enforces `session.freshAge` itself and answers 400 `SESSION_EXPIRED` when stale. A `beforeDelete` hook first refuses unless the `x-grampacker-delete-user-id` header equals the session's user id (the session can change after the user confirms), then purges the user's `verification` rows - including any PENDING MAGIC LINK for that address, which would otherwise resurrect the account after deletion | `{}` + `x-grampacker-delete-user-id` header | 200; 400 `SESSION_EXPIRED`; 400 `DELETE_ACCOUNT_MISMATCH` (header missing or names another account) | `server/auth-delete-user.test.ts` |
| `/api/categories` | GET, POST | session | own rows only (repo-scoped); POST 422 at the 500-per-user cap (0021 trigger) | `CreateCategoryRequest` (POST) | `CategoryResponse[]` / `CategoryResponse` | `server/routes/categories.test.ts` |
| `/api/categories/order` | PUT | session | every id owned or 404, zero writes | `ReorderRequest` | 204 | `server/routes/categories.test.ts` |
| `/api/categories/:id` | PATCH, DELETE | session | own row or 404; DELETE uncategorizes its gear in the same transaction | `UpdateCategoryRequest` (PATCH) | `CategoryResponse` / 204 | `server/routes/categories.test.ts` |
| `/api/gear-items` | GET, POST | session | own rows only; POST validates category ownership (composite FK backstop) | `CreateGearItemRequest` (POST) | `GearItemResponse[]` / `GearItemResponse` | `server/routes/gear-items.test.ts` |
| `/api/gear-items/order` | PUT | session | every id owned or 404, zero writes | `ReorderRequest` | 204 | `server/routes/gear-items.test.ts` |
| `/api/gear-items/import` | POST | session | creates own categories + items in one transaction; 400 on non-owned category, 422 at the gear AND category caps, zero writes on any failure | `ImportGearRequest` | `ImportGearResponse` | `server/routes/gear-items.test.ts`, `server/routes/categories.test.ts` (category cap) |
| `/api/gear-items/bulk-delete` | POST | session | every id owned or 404, zero writes | `BulkDeleteRequest` | 204 | `server/routes/gear-items.test.ts` |
| `/api/gear-items/bulk-move` | POST | session | every id + target category owned, else 404/400, zero writes | `BulkMoveRequest` | 204 | `server/routes/gear-items.test.ts` |
| `/api/gear-items/:id` | PATCH, DELETE | session | own row or 404; PATCH validates category ownership | `UpdateGearItemRequest` (PATCH) | `GearItemResponse` / 204 | `server/routes/gear-items.test.ts` |
| `/api/lists` | GET, POST | session | own rows only (repo-scoped); POST 422 at the 100-list cap | `CreateListRequest` (POST) | `ListResponse[]` / `ListResponse` | `server/routes/lists.test.ts` |
| `/api/lists/order` | PUT | session | every id owned or 404, zero writes; never bumps `updatedAt` | `ReorderListsRequest` | 204 | `server/routes/lists.test.ts` |
| `/api/lists/from-selection` | POST | session | every gear id owned or 400, zero writes; atomic list+items batch | `CreateListFromSelectionRequest` | `ListResponse` | `server/routes/lists.test.ts` |
| `/api/lists/import` | POST | session | every existing category/gear ref owned or 400, zero writes; creates list + categories + gear + items in one transaction; 422 at the list/gear/category caps | `ImportListRequest` | `ListResponse` | `server/routes/lists.test.ts`, `server/routes/categories.test.ts` (category cap) |
| `/api/lists/:id/duplicate` | POST | session | own list or 404; deep-copies memberships, packing locations and the food estimate with fresh ids in one batch; 422 at the 100-list cap | - | `ListResponse` | `server/routes/lists.test.ts`, `server/routes/food.test.ts` |
| `/api/lists/:id/share-link` | POST | session | own list or 404; mints a new slug, so the previous `/r/<slug>` becomes an unknown slug and 404s identically to an invented one. Deliberately does NOT change `isShared` - replacing the link and turning sharing off are separate intentions | - | `ListResponse` | `server/routes/lists.test.ts` |
| `/api/lists/:id` | PATCH, DELETE | session | own list or 404; DELETE cascades membership rows (composite FK), never gear; `isShared` patchable (the share/unshare toggle). Toggling does NOT change the slug: off then on revives the SAME url, which is what keeps published links stable. The request schema is STRICT, so a retired key (`groupWorn`, `readyChecksEnabled` - both removed 2026-08-11) 400s the whole patch rather than being ignored; a stale bundle fails loudly until it is RELOADED - a client-side route change keeps the same bundle, so only a new document picks up the current one. Accepted: reload is the remedy, see SECURITY.md | `UpdateListRequest` (PATCH) | `ListResponse` / 204 | `server/routes/lists.test.ts` |
| `/api/lists/:id/packing-locations` | GET, POST | session | own list or 404. GET is CSRF-exempt and returns only the caller's list locations. POST requires CSRF and creates either a named location or an item-backed container whose source membership must belong to this same list+user; one item can back at most one location. A named location receives server-assigned max sortOrder + 1 (appends); an item-backed container receives min sortOrder - 1 (prepends, directly after Unassigned); 422 at the shared 30-per-list cap | `CreatePackingLocationRequest` (POST; exactly one of `name` or `containerListItemId`) | `PackingLocationResponse[]` / `PackingLocationResponse` | `server/routes/packing-locations.test.ts` |
| `/api/lists/:id/packing-locations/order` | PUT | session | every id must belong to THIS list and user or 404 with zero writes; owned-set membership avoids D1's 100-parameter limit; requires CSRF | `ReorderPackingLocationsRequest` | 204 | `server/routes/packing-locations.test.ts` |
| `/api/lists/:id/packing-locations/:locationId` | PATCH, DELETE | session | location must belong to THIS list and user or 404 with zero cross-parent writes; requires CSRF. PATCH renames name-only locations and 409s for item-backed locations (their live gear name is authoritative). DELETE atomically returns the bag's gear AND food (0022 union) to Unassigned, then deletes the location; each reassign asserts the row's pre-read bag and rank and a fail-loud census aborts the batch if ANY row remains in the bag, so concurrent moves/reorders/arrivals are never overwritten or silently re-ordered; near the rank ceiling a dense renumber of the merged cohort replaces the append; 422 `pack_rank_exhausted` only if even that cannot fit; 409 when either path loses a race (batch rolled back whole); gear and membership rows remain | `UpdatePackingLocationRequest` (PATCH) | `PackingLocationResponse` / 204 | `server/routes/packing-locations.test.ts`, `server/routes/food-packing.test.ts` (food orphaning + dense fallback), `server/repos/constraint-races.test.ts` (the 409 route mapping) |
| `/api/lists/:id/items` | GET, POST | session | own list or 404; POST validates gear ownership (400) + 422 at the 300-item cap | `AddListItemRequest` (POST) | `ListItemResponse[]` / `ListItemResponse` | `server/routes/lists.test.ts` |
| `/api/lists/:id/food` | GET | session | own list or 404; slots + carried items + associations. Never anon-reachable in this SHAPE. The public share publishes the food ITEMS (`id`, `name`, `unitCount`, `weightGrams`, `sortOrder`) - see the `/api/shares/v2/:slug` row. What is private is the PLAN, which exists only here: `dayCount`, the day x meal `slots`, each item's `slotIds`, and its `isPacked`/`isReady`/`packingLocationId`/`packSortOrder` | - | `ListFoodResponse` | `server/routes/food.test.ts` |
| `/api/lists/:id/food/days` | PUT | session | own list or 404; generates/trims the day x meal grid, preserving surviving slot ids so their placements survive. 400 past the 30-day cap | `SetFoodDaysRequest` | `ListFoodResponse` | `server/routes/food.test.ts` |
| `/api/lists/:id/food/items` | POST | session | own list or 404; every `slotIds` entry must be on THIS list, else 400 - rejecting beats silently dropping a placement. 422 at the 200-item cap | `CreateFoodItemRequest` | `FoodItemResponse` | `server/routes/food.test.ts` |
| `/api/lists/:id/food/items/:itemId` | PATCH, DELETE | session | own list or 404; item must be on that list. `slotIds` omitted = associations unchanged, `[]` = unscheduled; every entry must be on THIS list, else 400 with the item's existing placements intact (the write is one batch and rolls back whole). Pack fields (0022): `packingLocationId` must name a location on THIS list and user (precheck + 0014-pattern trigger + FK race backstop), else 400 with zero writes - including cross-list stitching within one account; 409 when a concurrent move won the destination rank; 422 on rank exhaustion | `UpdateFoodItemRequest` (PATCH) | `FoodItemResponse` / 204 | `server/routes/food.test.ts`, `server/routes/food-packing.test.ts` (pack fields, non-owner 404, cross-list/cross-user stitching) |
| `/api/lists/:id/items/quick-add` | POST | session | own list + own category; gear+item in one atomic batch, either cap 422s the whole call | `QuickAddListItemRequest` | `ListItemResponse` | `server/routes/lists.test.ts` |
| `/api/lists/:id/items/order` | PUT | session | every item in THIS list or 404, zero writes; never bumps `updatedAt` | `ReorderListItemsRequest` | 204 | `server/routes/lists.test.ts` |
| `/api/lists/:id/items/pack-order` | PUT | session | every id (gear AND food - the payload is the 0022 union, legacy bare array = gear only) in THIS list or 404, zero writes; never bumps `updatedAt`; 400 on cross-cohort, worn-row, or index-unsafe payloads (rank duplicated within a table half, or landing on an untouched same-table cohort row - free ranks are legal); 409 when a concurrent reorder of the same cohort won either table's unique index or tripped either park guard | `ReorderPackListItemsRequest` | 204 | `server/routes/packing-locations.test.ts` (gear behavior), `server/routes/food-packing.test.ts` (union shapes, cross-user food id 404), `server/repos/constraint-races.test.ts` (the 409, both error shapes + the route mapping), `server/routes/lists.test.ts` (anon 401) |
| `/api/lists/:id/items/reset-packed` | POST | session | own list or 404; clears gear and food packed flags in one batch (0022) | - | 204 | `server/routes/lists.test.ts`, `server/routes/food-packing.test.ts` (food half) |
| `/api/lists/:id/items/reset-ready` | POST | session | own list or 404; clears gear and food ready flags in one batch (0022) | - | 204 | `server/routes/lists.test.ts`, `server/routes/food-packing.test.ts` (food half) |
| `/api/lists/:id/items/:itemId` | PATCH, DELETE | session | item must belong to THIS list and user (parent-path consistency) or 404. A non-null `packingLocationId` must belong to the same list+user and cannot make an item-backed container contain itself or create a nesting cycle; invalid assignments return 400 with zero writes. Null unassigns; absent leaves the assignment untouched. Deleting an item that backs a location removes that container role and unassigns its contents without deleting them | `UpdateListItemRequest` (PATCH) | `ListItemResponse` / 204 | `server/routes/lists.test.ts`, `server/routes/packing-locations.test.ts` |
| `/api/shares/v2/:slug` | GET | anon | gated on `lists.is_shared`; unknown slug and unshared list are the same 404; response is the strict public allowlist (`SharedListResponse`: no user ids, no `isPacked`/`isReady`, no gear `status`/`cost`/`purchaseDate`, no timestamps), enforced field-by-field in the handler and asserted by forbidden-key tests. Food crosses as `food.items[]` - `id`, `name`, `unitCount`, `weightGrams`, `sortOrder` and nothing else (0024: `unitCount` is the CARRIED count the server resolves; `quantity` and `isPerMeal` do NOT cross). The PLAN does not cross: no day count, no meal slots, no `isPacked`/`isReady`, no `packingLocationId`/`packSortOrder`. Each item appears ONCE - the food rows are never joined to the slot associations, which would fan a five-meal item out five times. 0024 added a SECOND statement over `list_food_item_slots` selecting only `food_item_id`, under the same share gate, so a per-meal item's carried count can be counted in JS; no day, meal or slot id crosses. Every outcome including the 404 carries `Cache-Control: private, no-store`, and the path is `/v2` precisely so responses cached under the old no-policy path are not reused. UNMETERED today, by decision: no application rate limit, and no edge rule created yet. If one is ever needed it belongs at the edge (refuses before the Worker or D1 is reached). SECURITY.md records the trigger. The unversioned `/api/shares/:slug` is REMOVED, not left mounted | - | `SharedListResponse` | `server/routes/shares.test.ts`, `server/routes/food.test.ts` (rows cross, plan does not) |
| `/*` (assets catch-all) | any | anon | - (static files / SPA shell via ASSETS binding; the binding itself serves GET/HEAD only) | - | - | `server/middleware/security-headers.test.ts` (shell + header coverage) |

Cross-cutting, tested in `server/middleware/csrf.test.ts`:

- Unsafe methods on non-auth routes require the `x-grampacker-request`
  header, and an `Origin` that MATCHES if one is sent - an absent Origin is
  permitted (`server/middleware/csrf.ts`). The header is the actual control;
  Origin is defense in depth.
- Session-gated routes 401 without a cookie (`server/middleware/session.ts`).
  `server/routes/session-gate.test.ts` reads every route from the app's
  router, `/api` or not, and proves the 401 on each one outside the public
  allowlist (the `/api/auth/*` handler, the share read, health), so a new
  route is covered without being listed. A wildcard registration
  (middleware, or an `.all()` endpoint on a `*` path) cannot be probed that
  way, so the test lists every one; a new one fails it until someone checks
  whether it needs the gate. Each route is probed at a URL built from its
  pattern, with a fresh random value for every `:param`, so a literal route
  cannot answer in its place. A gated route whose path is anything other than
  plain segments and `:param`s (a regex constraint, an optional param) also
  fails it, because the test cannot build a URL that surely reaches it.
- Handlers receive user-scoped repositories only; ownership is fixed
  server-side and never read from the client.

Rate limiting, tested in `server/middleware/rate-limit.test.ts`:

- `/api/auth/*` is limited per client IP (`CF-Connecting-IP`), fixed
  windows in the `rate_limits` table: passkey sign-in 30/5min, sign-in
  10/10min, magic-link verify 10/10min, delete-user 5/10min, everything else
  30/10min. Over budget -> 429 + `Retry-After`.
- The passkey ceremony is metered on its OWN bucket (`passkey-sign-in`),
  matched by exact path - it does not live under `/sign-in/*`, so a prefix
  would miss it. Looser than `sign-in` on purpose: one ceremony is TWO
  requests, an abandoned one still costs a request, and there is no
  credential here to guess. It shared `sign-in` until 2026-09-12 and locked
  the owner out of production; SECURITY.md has the reasoning.
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
    already refused never spends the shared quota.
  - the global count tracks **validated send attempts**, NOT mail actually
    sent. It is charged just before `email.send`, so a provider failure still
    spends a slot - deliberately, because reserve-then-refund would leak a
    slot forever whenever an isolate dies mid-send.
    `server/middleware/rate-limit.ts` says "do not write 'mail actually sent'
    here again"; this row used to say exactly that.
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
