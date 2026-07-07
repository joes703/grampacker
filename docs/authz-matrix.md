# Route authorization matrix

Every API route gets a row BEFORE it ships, and the row drives its tests
(owner / non-owner / anon at minimum; cross-parent stitching for child
resources). A route without a row, or a row without tests, fails review.

| Route | Methods | Auth | Ownership | Request DTO | Response DTO | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/health` | GET | anon | - | - | `HealthResponse` | dev/deploy smoke |
| `/api/auth/*` | GET, POST | better-auth | n/a (owns its tables) | better-auth | better-auth | better-auth's own origin validation (verified: forged origin -> 403 INVALID_ORIGIN); flow covered in `server/test/auth-helpers.ts` |
| `/api/me` | GET, PUT | session | self only (`user.id = session.userId`, fixed in repo) | `UpdateMeRequest` (PUT) | `MeResponse` | `server/routes/me.test.ts` |

Cross-cutting, tested in `server/routes/me.test.ts`:

- Unsafe methods on non-auth routes require the `x-grampacker-request`
  header and a matching `Origin` (`server/middleware/csrf.ts`).
- Session-gated routes 401 without a cookie (`server/middleware/session.ts`).
- Handlers receive user-scoped repositories only; ownership is fixed
  server-side and never read from the client.
