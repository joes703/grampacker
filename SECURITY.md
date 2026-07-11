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
- **Passwordless.** grampacker stores no password, and there is no reset,
  change, or verify flow to attack. There are exactly two ways to get a
  session: a passkey ceremony, or redeeming an emailed magic link. See
  "Passwordless auth" below and `docs/passwordless-auth-design.md`.
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
  unauthenticated GET that writes a row, and `magic-link/verify` is a GET
  that creates a user and mints a session). Budgets: sign-in 10/10min
  (the passkey ceremony), magic-link send 20/day per IP, magic-link
  verify 10/10min, delete-user 5/10min, default 30/10min. Single atomic
  upsert (no lost updates under concurrency - proven by a 20-way burst
  test), 429 + Retry-After.
- **Requesting a magic link is charged to the target ADDRESS as well as
  the caller's IP** (5/hour per address). This is the one limit that
  cannot be IP-keyed: an attacker rotating IPs is a first-time caller
  every time, and would bomb one victim's inbox - or farm tokens for one
  account - without ever touching a bucket. The address key is an HMAC of
  the lowercased address (`BETTER_AUTH_SECRET` as the pepper): lowercased
  because better-auth treats `Victim@` and `victim@` as one account, and
  HMAC'd so `rate_limits` never becomes a plaintext list of who uses the
  app.
- The key **must not trim** the address, tempting as that looks.
  better-auth validates with `z.email()` and does not trim, so
  `"victim@x.com "` is rejected and no mail is sent - but a trimming key
  would still have charged the victim's real bucket for it, letting an
  attacker on rotating IPs burn a victim's 5/hour recovery budget without
  sending a single email and lock them out of the only way back into a
  passwordless account. The bucket key must match the identity better-auth
  actually resolves: lowercase, no trim. (Found in review, 2026-07-11.)
- **better-auth's own limiter is disabled**, so the rate-limit rule the
  magic-link plugin ships NEVER FIRES. Anyone reading the plugin source
  would reasonably conclude magic links are self-policing. They are not.
  Every budget above is hand-written in
  `server/middleware/rate-limit.ts`, and a test asserts it.
- Cloudflare WAF is hardening on top, never the mechanism (portability
  rule: the limiter must work on the Node target too).
- CAPTCHA (Turnstile) is deliberately parked; trigger = observed signup
  abuse or real user growth.

## Input validation

- Request bodies on `/api/*` are capped at 128 KB
  (`server/middleware/body-limit.ts`), registered before CSRF, rate
  limiting, and auth so oversized payloads are refused (413) without
  being read, without auth state, and without spending rate budget. The
  two import routes get 2 MB, because the middleware runs before any
  route and a route-level limit cannot widen a global one. The cap is a
  transport bound, not a restatement of the DTO: zod counts characters,
  body limits count bytes, and UTF-8 is up to 3 bytes per character.
- zod DTOs in `shared/` validate on both sides of the API; response
  shapes are pinned by tests so drift fails CI.
- SQLite constraints (FKs, UNIQUEs, CHECKs) land with each schema slice
  as the backstop against programmer error, mirroring the old repo's
  discipline.

## Passwordless auth

Two ways in, and no third: a passkey ceremony, or an emailed magic link.
There is no password to phish, reuse, guess, reset, or leak, and no reset
or verify flow to attack. Full design and rejected alternatives:
`docs/passwordless-auth-design.md`.

**The mailbox is the root of trust.** That is not a downgrade - it was
already true when a password could be reset by email. The change makes it
honest rather than adding a second, weaker credential in front of it.

- Magic-link tokens are **hashed at rest** (`storeToken: 'hashed'`; the
  plugin defaults to PLAIN, which would leave session-minting tokens in
  cleartext in the `verification` table), single-use via an atomic
  consume, and live **5 minutes**.
- The emailed URL points at the **SPA** (`/auth/magic`), not at
  better-auth's verify endpoint, and the SPA redeems only on a user
  CLICK. Mail scanners and link-prefetchers follow URLs in email; since
  redemption is single-use and side-effecting, a scanner hitting the
  endpoint directly would burn the user's link before they ever saw it.
- The page then **scrubs the token out of the URL** (replace-navigation)
  so a session-minting token does not sit in the address bar, in history,
  or in the `Referer` of same-origin requests. This narrows exposure
  rather than erasing it - the initial GET still carried the token, so it
  can reach edge access logs, which is part of why the token is
  single-use and 5-minute.
- Responses to a send request are **uniform** whether or not the address
  has an account. Redeeming a link for an unknown address CREATES the
  account, so there is no existence signal to leak in the first place.
- Requesting a link is rate limited per IP **and per target address** -
  see "Abuse and rate limiting".

An account with zero passkeys is legitimate (someone who only ever uses
email). The UI prompts hard for enrollment and calls the account not
fully set up, but it is a PROMPT, never a gate: locking an email-only
user out of their own data to force a credential they may not be able to
create would be a worse failure than the one it prevents.

## Fresh auth (sudo mode)

ADDING or REMOVING a passkey, and DELETING the account, require a **fresh
session** on top of a valid one: the session must have been CREATED
within 24 hours (`session.freshAge`). Re-authenticating means doing a
sign-in ceremony again - a passkey, or a magic link - which mints a new
session and thereby a new proof.

What that is protecting, concretely: sessions are 30-day sliding, so a
stolen one expires. A passkey planted with a stolen session does not - it
OUTLIVES the session, which makes it permanent, silent access.
Registering a new credential is the one path to persistence, and removal
is gated on the same freshness so an attacker cannot strip the owner's
other sign-in methods.

RENAME is deliberately NOT gated. It changes a display label; it cannot
add, remove, or alter a credential, so a prompt there is friction with no
threat behind it. ("Every passkey mutation requires fresh auth" is a
tidier sentence, but tidiness is not a threat model.)

- **The session row IS the proof.** There is no `fresh_auth` table and no
  `POST /api/me/reauth` any more. Both existed to prove someone re-typed
  a password; with no password, the proof they minted could not be minted
  (the old check inner-joined the `credential` account row, so it would
  have failed closed and locked every user out of passkey management).
  Freshness is a property of the session itself, which cannot be forged
  without doing the ceremony.
- Freshness is measured from `session.created_at` and is **never
  refreshed** by activity, so it cannot be laundered by staying logged
  in. It is per-session: one browser re-authenticating does not make
  another browser's session fresh.
- `server/middleware/fresh-auth.ts` enforces it BEFORE better-auth sees
  the request, on `generate-register-options`, `verify-registration`,
  `delete-passkey` (403 `REAUTH_REQUIRED`). `delete-user` enforces the
  same window inside better-auth's own route (400 `SESSION_EXPIRED`) -
  two error codes for one rule, and the client handles both.
- Not gated: `update-passkey` (a label), the anonymous passkey SIGN-IN
  ceremony (gating it would make passkey sign-in impossible), and
  `list-user-passkeys` (a read).
- Deleting the account purges the user's `verification` rows, **including
  any pending magic link for that address**. Without that, a link
  requested before the delete would still redeem afterwards and silently
  resurrect the account as a new, empty user.

WebAuthn user verification is REQUIRED, and enforced rather than
requested. `authenticatorSelection.userVerification: 'required'` is only
a hint - the plugin hardcodes `requireUserVerification: false` at both of
its verification sites and exposes no option for it, so a response with
the UV flag clear would otherwise be accepted. `server/auth.ts` rejects
those in the `afterVerification` hooks of BOTH ceremonies, which run
before the passkey row is created and before the session is issued. This
matters more without a password: the passkey is now the whole credential,
so an unverified ceremony would mean possession of the device alone is
the account.

## Secrets in build output

`vite build` emits `dist/<worker>/.dev.vars` when a local `.dev.vars`
exists. This looks alarming and gets re-raised by every audit, so: it is
deliberate, and it cannot reach production. Three independent reasons -

- The uploaded asset set is `assets.directory: "../client"`
  (`dist/grampacker/wrangler.json`). The file sits beside the WORKER
  bundle, which is not part of that set.
- The Cloudflare plugin also writes an `.assetsignore` naming
  `.dev.vars`, so wrangler skips it even if it were in the asset dir.
- CI never has a `.dev.vars` to copy: it is gitignored, and the deploy
  workflow builds from a clean checkout with secrets injected as env.

It is emitted on purpose so `npm run preview` can read the values back.
Deleting it in a build hook would break preview and change nothing in
CI. `dist/` and `.dev.vars` are both gitignored; keep them that way.

## Supply chain

- `npm ci` everywhere, `ignore-scripts=true` + `save-exact=true` in
  `.npmrc`, exact pins, no core infra on beta/RC.
- GitHub Actions pinned to full commit SHAs; triggers are `pull_request`
  and `push` to main - never `pull_request_target` (which would run
  workflows with secrets against fork code); private repo.

## Deferred - known gaps with triggers

- **Fresh-auth proofs**: CLOSED. See "Fresh auth" above - passkey
  mutations and account deletion both require a fresh session. Email
  change does not exist as a feature.
- **Account enumeration**: CLOSED, and by construction rather than by
  care. Requesting a link answers the same way for an address that has an
  account and one that does not, because redeeming the link CREATES the
  account either way - so there is no distinction to leak. (The old
  sign-up endpoint necessarily disclosed existing accounts. That endpoint
  is gone.)
- **Dead credential rows**: the `account` rows with `provider_id =
  'credential'`, the `reset-password:*` tokens in `verification`, and the
  `fresh_auth` table still EXIST in production until the teardown
  migration ships (`docs/passwordless-auth-design.md` section 9, PR 3).
  Nothing reads them, and `/reset-password` is dead without a
  `sendResetPassword` config - but a stale password hash sitting in the
  database is exactly the thing this change is meant to remove, so the
  migration is not optional cleanup.
- **Resend is a single point of failure for recovery.** If it is down,
  anyone without a working passkey cannot sign in. Accepted knowingly:
  the data is low-sensitivity, the failure is temporary and read-only
  (nobody loses anything), and the alternative - keeping a password
  around as a backup - reintroduces the credential this change exists to
  delete. Worst case for a user with no passkey and no working mailbox is
  loss of access to their own gear list, which is recoverable by support
  (there is one user, and he is the maintainer).
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
