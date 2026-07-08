# Route authorization matrix

Every API route gets a row BEFORE it ships, and the row drives its tests
(owner / non-owner / anon at minimum; cross-parent stitching for child
resources). A route without a row, or a row without tests, fails review.

| Route | Methods | Auth | Ownership | Request DTO | Response DTO | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/health` | GET | anon | - | - | `HealthResponse` | dev/deploy smoke |
| `/api/auth/*` | GET, POST | better-auth | n/a (owns its tables) | better-auth | better-auth | better-auth's own origin validation (verified: forged origin -> 403 INVALID_ORIGIN); flow covered in `server/test/auth-helpers.ts` |
| `/api/me` | GET, PUT | session | self only (`user.id = session.userId`, fixed in repo) | `UpdateMeRequest` (PUT) | `MeResponse` | `server/routes/me.test.ts` |
| `/api/categories` | GET, POST | session | own rows only (repo-scoped) | `CreateCategoryRequest` (POST) | `CategoryResponse[]` / `CategoryResponse` | `server/routes/categories.test.ts` |
| `/api/categories/order` | PUT | session | every id owned or 404, zero writes | `ReorderRequest` | 204 | `server/routes/categories.test.ts` |
| `/api/categories/:id` | PATCH, DELETE | session | own row or 404; DELETE uncategorizes its gear in the same transaction | `UpdateCategoryRequest` (PATCH) | `CategoryResponse` / 204 | `server/routes/categories.test.ts` |
| `/api/gear-items` | GET, POST | session | own rows only; POST validates category ownership (composite FK backstop) | `CreateGearItemRequest` (POST) | `GearItemResponse[]` / `GearItemResponse` | `server/routes/gear-items.test.ts` |
| `/api/gear-items/order` | PUT | session | every id owned or 404, zero writes | `ReorderRequest` | 204 | `server/routes/gear-items.test.ts` |
| `/api/gear-items/bulk-delete` | POST | session | every id owned or 404, zero writes | `BulkDeleteRequest` | 204 | `server/routes/gear-items.test.ts` |
| `/api/gear-items/bulk-move` | POST | session | every id + target category owned, else 404/400, zero writes | `BulkMoveRequest` | 204 | `server/routes/gear-items.test.ts` |
| `/api/gear-items/:id` | PATCH, DELETE | session | own row or 404; PATCH validates category ownership | `UpdateGearItemRequest` (PATCH) | `GearItemResponse` / 204 | `server/routes/gear-items.test.ts` |
| `/api/lists` | GET, POST | session | own rows only (repo-scoped); POST 422 at the 100-list cap | `CreateListRequest` (POST) | `ListResponse[]` / `ListResponse` | `server/routes/lists.test.ts` |
| `/api/lists/order` | PUT | session | every id owned or 404, zero writes; never bumps `updatedAt` | `ReorderListsRequest` | 204 | `server/routes/lists.test.ts` |
| `/api/lists/from-selection` | POST | session | every gear id owned or 400, zero writes; atomic list+items batch | `CreateListFromSelectionRequest` | `ListResponse` | `server/routes/lists.test.ts` |
| `/api/lists/:id/duplicate` | POST | session | own list or 404; copy resets `isShared`/`isDraft`, mints a fresh slug | - | `ListResponse` | `server/routes/lists.test.ts` |
| `/api/lists/:id` | PATCH, DELETE | session | own list or 404; DELETE cascades membership rows (composite FK), never gear; `isShared` not patchable until the share slice | `UpdateListRequest` (PATCH) | `ListResponse` / 204 | `server/routes/lists.test.ts` |
| `/api/lists/:id/items` | GET, POST | session | own list or 404; POST validates gear ownership (400) + 422 at the 300-item cap | `AddListItemRequest` (POST) | `ListItemResponse[]` / `ListItemResponse` | `server/routes/lists.test.ts` |
| `/api/lists/:id/items/quick-add` | POST | session | own list + own category; gear+item in one atomic batch, either cap 422s the whole call | `QuickAddListItemRequest` | `ListItemResponse` | `server/routes/lists.test.ts` |
| `/api/lists/:id/items/order` | PUT | session | every item in THIS list or 404, zero writes; never bumps `updatedAt` | `ReorderListItemsRequest` | 204 | `server/routes/lists.test.ts` |
| `/api/lists/:id/items/reset-packed` | POST | session | own list or 404 | - | 204 | `server/routes/lists.test.ts` |
| `/api/lists/:id/items/reset-ready` | POST | session | own list or 404 | - | 204 | `server/routes/lists.test.ts` |
| `/api/lists/:id/items/:itemId` | PATCH, DELETE | session | item must belong to THIS list and user (parent-path consistency) or 404 | `UpdateListItemRequest` (PATCH) | `ListItemResponse` / 204 | `server/routes/lists.test.ts` |
| `/*` (assets catch-all) | any | anon | - (static files / SPA shell via ASSETS binding; the binding itself serves GET/HEAD only) | - | - | `server/middleware/security-headers.test.ts` (shell + header coverage) |

Cross-cutting, tested in `server/routes/me.test.ts`:

- Unsafe methods on non-auth routes require the `x-grampacker-request`
  header and a matching `Origin` (`server/middleware/csrf.ts`).
- Session-gated routes 401 without a cookie (`server/middleware/session.ts`).
- Handlers receive user-scoped repositories only; ownership is fixed
  server-side and never read from the client.

Rate limiting, tested in `server/middleware/rate-limit.test.ts`:

- `/api/auth/*` is limited per client IP (`CF-Connecting-IP`), fixed
  windows in the `rate_limits` table: sign-up 10/day, email-sending
  endpoints 5/day (guards the Resend free tier), sign-in 10/10min,
  everything else 30/10min. Over budget -> 429 + `Retry-After`.
- Fail-closed across ALL methods since PR #10: better-auth GETs are not
  read-only (the passkey challenge endpoint is an unauthenticated GET
  that writes a verification row). Only the allowlisted pure-read GETs
  (`get-session`, `passkey/list-user-passkeys`) are exempt. Budgets and
  the allowlist live in `server/middleware/rate-limit.ts`.

Response headers, tested in `server/middleware/security-headers.test.ts`:

- Every response (SPA shell, assets, API, errors) carries the shared
  security-header map (`server/middleware/security-headers.ts`);
  `run_worker_first: true` means no path bypasses the Worker.
