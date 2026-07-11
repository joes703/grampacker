# Security posture

Written at phase 1 (2026-07-08) against MDN's web security guides
(https://developer.mozilla.org/en-US/docs/Web/Security), per
REWRITE_PLAN.md section 6. Re-sweep scheduled before the public share
ships (phase 4). This file records what is enforced, where the tests
live, and what is deliberately deferred - it is honest about gaps.

## Authorization boundary (IDOR)

- Handlers never touch the DB: they receive user-scoped repositories
  (`reposForUser(db, userId)`) from the session middleware. Ownership is
  fixed server-side; client-supplied ids cannot widen it.
- The boundary is lint-enforced, fail-closed: `server/**` cannot import
  the DB factory, schema, drizzle, repo constructors, or auth internals
  outside the explicitly exempted layers, dynamic `import()` is banned,
  and `eslint-disable` comments are neutralized (`eslint.config.js`).
  Lint runs inside `npm run build` and CI.
- Every route gets a row in `docs/authz-matrix.md` BEFORE it ships, and
  the row drives owner / non-owner / anon tests. No row, no route.

## Sessions and authentication

- better-auth cookie sessions: HttpOnly, SameSite=Strict, Secure in
  production (https baseURL), 30-day sliding expiry - a deliberate
  convenience call for low-sensitivity data (REWRITE_PLAN.md 13.2).
  No tokens in localStorage anywhere.
- Public signup with mandatory email verification; unverified accounts
  cannot sign in (tested: `EMAIL_NOT_VERIFIED`).
- Passkeys (WebAuthn): rpID is `grampacker.app`, derived with an
  exact-or-dot-boundary match so lookalike domains are excluded
  (`server/passkey-rp-id.test.ts`).
- Secrets (`BETTER_AUTH_SECRET`, `RESEND_API_KEY`) are Worker secrets;
  nothing secret is in the client bundle or the repo (`.dev.vars` is
  gitignored).

## CSRF

Four independent layers, tested in `server/routes/me.test.ts`:

- No CORS headers are emitted, ever - cross-origin scripts cannot read
  responses, and custom headers force a preflight that can never pass.
- SameSite=Strict cookies.
- Unsafe methods on non-auth routes require the `x-grampacker-request`
  header plus a matching `Origin` (`server/middleware/csrf.ts`).
- `/api/auth/*` is origin-validated by better-auth itself against
  `BETTER_AUTH_URL` (verified: forged origin -> 403 INVALID_ORIGIN).

## XSS and response headers

- React escaping end-to-end; no `dangerouslySetInnerHTML`, no `eval`,
  no raw HTML in markdown when that ports.
- One security-header map is owned by the Worker and applied to every
  response - SPA shell, static assets, and API alike
  (`server/middleware/security-headers.ts`; `run_worker_first: true`
  means nothing bypasses it). CSP `default-src 'self'` with no external
  origins, `frame-ancestors 'none'` + `X-Frame-Options: DENY`
  (clickjacking), `nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  HSTS with preload, COOP. Integration tests assert the full set on an
  HTML route AND an API route AND an error response
  (`server/middleware/security-headers.test.ts`).
- Dev mode drops exactly one header (the CSP - Vite HMR needs inline
  scripts); the delta is pinned by a test.

## Abuse and rate limiting

- DB-backed fixed-window limiter on `/api/auth/*`, fail-closed across
  ALL methods with a two-entry pure-read GET allowlist - better-auth
  GETs are not read-only (the passkey challenge endpoint is an
  unauthenticated GET that writes a row). Budgets: sign-up 10/day,
  email-sending 5/day (guards the Resend free quota), sign-in 10/10min,
  change-password/delete-user 5/10min (own buckets), default 30/10min.
  Single atomic upsert (no lost updates under
  concurrency - proven by a 20-way burst test), 429 + Retry-After.
- Cloudflare WAF is hardening on top, never the mechanism (portability
  rule: the limiter must work on the Node target too).
- CAPTCHA (Turnstile) is deliberately parked; trigger = observed signup
  abuse or real user growth.

## Input validation

- Request bodies on `/api/*` are capped at 128 KB
  (`server/middleware/body-limit.ts`), registered before CSRF, rate
  limiting, and auth so oversized payloads are refused (413) without
  being read, without auth state, and without spending rate budget.
- zod DTOs in `shared/` validate on both sides of the API; response
  shapes are pinned by tests so drift fails CI.
- SQLite constraints (FKs, UNIQUEs, CHECKs) land with each schema slice
  as the backstop against programmer error, mirroring the old repo's
  discipline.

## Supply chain

- `npm ci` everywhere, `ignore-scripts=true` + `save-exact=true` in
  `.npmrc`, exact pins, no core infra on beta/RC.
- GitHub Actions pinned to full commit SHAs; triggers are `pull_request`
  and `push` to main - never `pull_request_target` (which would run
  workflows with secrets against fork code); private repo.

## Deferred - known gaps with triggers

- **Fresh-auth proofs** (server-verified recent authentication for
  password change, email change, account deletion, and passkey
  add/remove): phase 6. TODAY a valid session alone can manage
  passkeys - a hijacked session could add a persistent credential.
  Accepted while the app has no external users; the settings/account
  slice (phase 6) must not ship without it.
- **Account-enumeration audit** of forget-password and
  resend-verification responses (uniform success regardless of account
  existence): verify at the phase-4 re-sweep. Sign-up necessarily
  discloses existing accounts; accepted, parity with the old app.
- **Public share endpoint** (`/api/share/:slug`, phase 4): dedicated
  repository + DTO allowlist + private-column ABSENCE tests + uniform
  404 for unknown and inactive slugs. The re-sweep of this file happens
  before it ships.
- **Web Analytics**: the insights beacon is NOT in the CSP. If
  Cloudflare Web Analytics is wired to the new Worker, add
  `https://static.cloudflareinsights.com` to script-src deliberately.

## Not applicable by construction

Recorded so they are not re-litigated (REWRITE_PLAN.md section 6):
SSRF (the only outbound HTTP is Resend's fixed endpoint; no
user-controlled URLs), SRI (all assets same-origin and content-hashed
by Vite), mixed content (HTTPS-only + HSTS), CORS misconfiguration (no
CORS at all), local network access, user activation.
