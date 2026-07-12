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
  (the passkey ceremony), magic-link verify 10/10min, delete-user
  5/10min, default 30/10min. Single atomic upsert (no lost updates under
  concurrency - proven by a 20-way burst test), 429 + Retry-After.
- **Requesting a magic link is charged to THREE buckets**, because no
  single key stops all three abuses. All are charged on every send and
  any one can 429: a **global** cap (90/day), a **per-IP** cap
  (10/10min), and a **per-address** cap (5/hour).
  - The **global** bucket is the only thing that guards the mail
    provider's quota, which is itself global (Resend free tier: 100/day).
    A per-IP cap cannot do that job - at N/day per IP, a handful of IPs
    still drains the provider, and then nobody can recover an account.
    **90/day is a PRODUCT choice, not a security constant.** It is sized
    to the current provider's quota and nothing else, so it is expected
    to move. To raise it: change `MAGIC_LINK_SEND_GLOBAL.limit` in
    `server/middleware/rate-limit.ts` (and `MAGIC_SEND_GLOBAL_LIMIT` in
    its test, which mirrors it), keeping meaningful headroom under
    whatever the provider allows per day - on SES that is a much larger
    number. Raising it weakens nothing: the two buckets below are the
    anti-abuse controls, and they are what should NOT be relaxed for
    convenience.
  - The **per-address** bucket is the one that cannot be IP-keyed: an
    attacker rotating IPs is a first-time caller every time, and would
    bomb one victim's inbox - or farm tokens for one account - without
    ever touching a bucket. It is an anti-abuse control, not a quota
    control, so it should not be relaxed for convenience. Its key is an
    HMAC of the lowercased address (`BETTER_AUTH_SECRET` as the pepper):
    lowercased because better-auth treats `Victim@` and `victim@` as one
    account, and HMAC'd so `rate_limits` never becomes a plaintext list
    of who uses the app.
  - **Charge order is IP -> address -> global, and it is load-bearing.** A
    request the first two already refused never reaches the shared quota,
    so a flood cannot spend mail budget it was never going to use. Reverse
    the order and one host could 429 the whole app's recovery for a day.
  - **The global bucket is charged in `sendMagicLink`, NOT in the
    middleware, and that placement is a security control.** The middleware
    runs before better-auth parses the body, so it cannot tell a
    deliverable address from junk. While it charged the global bucket, a
    request carrying `{"email": "not-an-email"}` spent one of the 90 daily
    slots and *then* got a 400 from better-auth's `z.email()` validation -
    so ~90 garbage requests from rotating IPs drained a full day of the
    only account-recovery path in a passwordless app **without sending a
    single email**. Charging inside the callback means better-auth has
    already validated and normalized the address, so nothing that cannot
    become an email can spend the shared quota. (Found in review,
    2026-07-12; fixed the same day.)
  - The middleware still **peeks** at the global bucket (a read, not a
    charge) and refuses early when it is already spent. This is not
    redundant: better-auth writes the `verification` row *before* it calls
    `sendMagicLink`, so without the peek every request arriving at a
    drained quota would write a DB row and only then be refused, turning an
    exhausted quota into a free write amplifier. The peek is racy by
    construction and that is fine - the atomic charge in the callback is
    the gate, and a test pins that a concurrent burst cannot over-send.
  - **Residual, accepted:** a charge refused in the callback still leaves an
    orphan `verification` row (hashed, never emailed, 5-minute expiry),
    because better-auth writes it first. The peek confines this to the
    quota BOUNDARY - once the bucket is spent, requests never reach
    better-auth - so the orphans are bounded by how many requests can be in
    flight across the boundary at once, which the per-IP and per-address
    buckets are what limit. Not unbounded, and not a token an attacker can
    obtain (they never see it). Charging earlier would avoid it only by
    re-validating the address ourselves, and a validator that drifts looser
    than better-auth's would be a quota BYPASS - a worse bug than the rows.
  - **What the global counter means: VALIDATED SEND ATTEMPTS, not mail
    delivered.** It is charged just before `email.send`, so two concurrent
    sends cannot both see a free slot - at the cost that a provider failure
    still spends one. Reserve-then-refund would fix that and introduce a
    worse bug (an isolate dying mid-send leaks the reservation until the
    window rolls), which is not a trade worth making at 90 slots against a
    100/day provider cap.
  - This ordering holds **only for requests that arrive over HTTP**. A
    server-side `auth.api.signInMagicLink(...)` call would bypass the Hono
    middleware entirely - no IP charge, no address charge - while still
    charging the global quota. Nothing calls it that way today; anything
    that starts to is stepping around two of the three buckets.
- **Accepted trade-off:** if the global bucket is drained, nobody can
  recover an account until the window rolls. That is no worse than the
  provider's quota running out - the effect is identical - but it fails
  earlier and deliberately, and the two narrower caps in front of it are
  what make draining it expensive.
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
- The token rides in the **URL fragment** (`/auth/magic#token=...`). A
  browser does not put the fragment in the request line or the `Referer`
  header, so clicking the link does not write the live token into our
  Worker's logs, Cloudflare's request logs, or any proxy's access log on
  the way. The `Referer` part is load-bearing: `Referrer-Policy:
  strict-origin-when-cross-origin` sends the FULL url on same-origin
  requests, so with `?token=` the landing page handed the token to every
  request it went on to make. A `?token=` link is still honored on read,
  for links that were in an inbox at the cutover.
- **What this does not do:** the token is still in the email. Resend and
  any receiving mail-security gateway (Safe Links and friends) see the
  whole message, and a gateway that rewrites URLs sees the fragment too.
  The fragment removes the token from the HTTP request path only. Mailbox
  compromise remains total compromise - that is inherent to email being
  the recovery root of trust, and is what single-use + 5-minute expiry
  bound.
- The page then **scrubs the token out of the URL** (replace-navigation)
  so a session-minting token does not sit in the address bar, in history,
  or in a screen share. The fragment keeps it off the wire; the scrub
  keeps it off the screen.
- Redemption itself (`GET /api/auth/magic-link/verify?token=...`) still
  carries the token in a query string - that is better-auth's endpoint
  contract and cannot be moved. It is far lower risk (the token is
  consumed atomically during that very request) but not zero: an observer
  who saw it in flight could in principle race redemption. Single-use and
  5-minute expiry are what bound it.
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
- **Dead credential rows**: CLOSED. Migration `0006_passwordless-teardown`
  deleted every `account` row with `provider_id = 'credential'`, purged the
  `reset-password:*` tokens from `verification`, and dropped the `fresh_auth`
  table. The token purge is the load-bearing half: `/reset-password` is mounted
  unconditionally and is not gated on `emailAndPassword.enabled`, so a
  still-valid pre-cutover token would have RE-CREATED a credential account for
  a user who has none. No password hash remains in the database.
  The `account.password` COLUMN stays - it is part of better-auth's base model
  and the CLI keeps emitting it. Only the rows are gone.
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
- **Public share endpoint is UNMETERED** (`GET /api/shares/:slug`). The
  rate limiter is mounted on `/api/auth/*` only, so every non-auth route
  is unmetered - but the rest are session-gated, and this one is
  anonymous by design. It is therefore the app's one unauthenticated,
  uncounted database read: the obvious scraping surface, and a cheap way
  to make the Worker do work for free. Slugs are random, so this is not
  an enumeration oracle in any practical sense, and the response is a
  DTO-allowlisted read-only document - which is why it is a gap and not a
  hole. Trigger: any public-endpoint abuse review, any sign of scraping,
  or the first time a share link is posted somewhere public. Fix shape:
  a generous per-IP bucket (a legitimate viewer makes 1-3 requests; the
  budget must survive a link going around a large NAT). Raised by review,
  2026-07-11.
- **Web Analytics**: the insights beacon is NOT in the CSP. If
  Cloudflare Web Analytics is wired to the new Worker, add
  `https://static.cloudflareinsights.com` to script-src deliberately.

## Not applicable by construction

Recorded so they are not re-litigated (REWRITE_PLAN.md section 6):
SSRF (the only outbound HTTP is Resend's fixed endpoint; no
user-controlled URLs), SRI (all assets same-origin and content-hashed
by Vite), mixed content (HTTPS-only + HSTS), CORS misconfiguration (no
CORS at all), local network access, user activation.
