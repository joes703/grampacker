# Security posture

**BINDING, and maintained against the code.** If this file disagrees with what
the code does, the file is wrong and fixing it is part of the change that made
it wrong. It records what is enforced, where the tests live, and what is
deliberately deferred - it is honest about gaps, and a gap stated here is a
decision, not an oversight.

Per-route contracts live in `docs/authz-matrix.md`, which is the authority on
who can call what. This file is the posture: the shape of the defenses and the
reasoning behind them. Where the two overlap, the matrix wins on detail.

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
  convenience call: the gear and list content a session reaches is
  low-sensitivity, so a long session wins over frequent sign-ins.
  No tokens in localStorage anywhere.
- **Passwordless.** grampacker stores no password and configures no password
  reset, password change or email-verification feature. There are exactly two
  ways to get a session: a passkey ceremony, or redeeming an emailed magic
  link. better-auth's mounted reset compatibility route and the database
  invariant that keeps it unusable are under "Passwordless auth" below.
- Passkeys (WebAuthn): rpID is `grampacker.app`, derived with an
  exact-or-dot-boundary match so lookalike domains are excluded
  (`server/passkey-rp-id.node.test.ts`).
- Secrets (`BETTER_AUTH_SECRET`, `RESEND_API_KEY`) live only in the
  root-owned VPS file `/srv/grampacker/secrets/app.env`; nothing secret is in
  the client bundle or repository.
- **A missing `RESEND_API_KEY` fails closed.** The console sender - which
  prints the redeemable magic-link URL to the log and reports success - is
  selected only when `BETTER_AUTH_URL` is `localhost` (`isDevEnvironment`,
  the same test that relaxes the CSP). On any other origin a missing key
  makes the magic-link send itself fail as a logged 500; session lookups
  and every other auth route keep working (`server/email/index.ts`,
  `server/auth-error-logging.test.ts`).
- **Bound query parameters stay out of the server's log lines.** Drizzle's
  wrapper error embeds every bound value in its message (and V8 repeats it
  in the stack header): gear names, costs, and on a failed session lookup
  the session token. Three sinks are routed through one sanitizer that
  replaces such messages, drops their stacks, and keeps the query text and
  the SQLite root-cause message, which never embed values
  (`server/middleware/error-handler.ts`, `describeError`): the incident
  handler's own entries, better-auth's logger (`logger` option), and the
  `onAPIError` hook that takes over from better-call's raw `console.error`
  fallback for any error escaping an auth endpoint. Proven over the real
  app in `server/auth-error-logging.test.ts`.

  Two things this does NOT cover, stated so nobody reads more into it:
  better-auth's adapter factory writes one raw `console.error(error)` of
  its own when the SECOND statement of a JS-side join fails (the user read
  after a successful session read, `@better-auth/core`
  `db/adapter/factory.mjs`) - outside the sanitizer and the budget; the
  value bound there is the user id, never the token, and the test above
  pins that boundary. The installed Drizzle adapter has no native join to
  switch to. And an arbitrary error message is not made free of
  user-controlled text - a repo throw that quotes a client-supplied id
  still logs it.

## CSRF

Four layers, tested in `server/middleware/csrf.test.ts` (with route-level
coverage in `server/routes/me.test.ts`):

- No CORS headers are emitted, ever - cross-origin scripts cannot read
  responses, and custom headers force a preflight that can never pass.
- SameSite=Strict cookies.
- Unsafe methods on non-auth routes require the `x-grampacker-request`
  header. That header IS the control: a cross-origin script cannot set it
  without triggering a preflight that can never pass, since no CORS headers
  are emitted.
- `Origin`, **when present**, must match `BETTER_AUTH_URL`. An ABSENT Origin
  is permitted (`csrf.ts` checks `origin && origin !== expected`) - so this
  is defense in depth on top of the header, not a second independent gate.
  Stated precisely because this file previously claimed a matching Origin was
  required, which is stronger than what the code does.
- `/api/auth/*` is origin-validated by better-auth itself against
  `BETTER_AUTH_URL` (verified: forged origin -> 403 INVALID_ORIGIN).

## XSS and response headers

- React escaping end-to-end; no `dangerouslySetInnerHTML`, no `eval`,
  no raw HTML in markdown when that ports.
- One security-header map is applied by the Hono server to every response -
  SPA shell, static assets, and API alike
  (`server/middleware/security-headers.ts`). CSP `default-src 'self'` with no external
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
  that creates a user and mints a session). Budgets: passkey sign-in
  30/5min, sign-in 10/10min, magic-link verify 10/10min, delete-user
  5/10min, default 30/10min. Each charge is one atomic upsert that decides
  the count and the window together, so overlapping requests cannot lose an
  increment, reset one expired window twice, or move a newer window back
  (burst tests, including one across a window roll; the exact boundary and
  Retry-After rounding are pinned to the millisecond). 429 + Retry-After. The same
  new-window trigger that sweeps `rate_limits` also sweeps EXPIRED
  `verification` rows. better-auth sweeps them only as a side effect of
  `findVerificationValue`, which several unrelated routes call (for example
  magic-link verify, `GET /reset-password/:token` and the OAuth callback's
  state check, all mounted even though we use no password or OAuth sign-in).
  Passkey ceremonies consume through `consumeVerificationValue`, which
  deletes only rows with the consumed challenge's identifier - so without our
  sweep, an abandoned passkey challenge would expire in five minutes and then
  persist until some unrelated request happened to arrive. Cleanup must not
  depend on that traffic.
- **The passkey ceremony has its own budget, deliberately looser than
  `sign-in`.** It shared `sign-in` (10/10min) until 2026-09-12, when the
  app owner was locked out of production by it. One ceremony costs TWO
  requests (options, then verification) and an ABANDONED one still costs
  one, so ten requests was five attempts - and a user with several
  passkeys spends those just by picking the wrong credential a few
  times. Sizing it like a password bucket was the error: a WebAuthn
  assertion needs the private key in the authenticator, so there is no
  secret to brute force and few-attempts-then-lockout buys nothing. What
  the budget actually bounds is resource cost, and that cost is stated
  honestly rather than waved at:
  - `generate-authenticate-options` is an anonymous GET that writes a
    `verification` row. Sustained challenge creation rises SIXFOLD
    (~1,440 to ~8,640 rows/day/IP). Expiry does not bound retention, so
    the limiter now sweeps expired rows (above). That sweep, not the
    budget, is what makes the increase safe.
  - Successful verification mints a session and never revokes the
    previous one, and there is no concurrent-session cap. Sustained
    minting rises from ~30 to ~180/hour/IP. Each one still requires a
    valid assertion AND user verification, so this is not anonymous
    session minting.
  - Worst-case BURST, counting the fixed-window boundary (a window's
    limit immediately before expiry plus a full limit after): ~59
    accepted requests close together, against ~19 before. Lower than the
    ~119 that 60/10min would allow, which is why the window shortened
    instead of the ceiling doubling.
  The shorter window halves the MAXIMUM REMAINING WINDOW after a
  rejection - up to five minutes rather than up to ten, not a guaranteed
  five-minute wait. `server/middleware/rate-limit.test.ts` pins ten
  fumbled attempts as something that must never 429, and asserts both
  halves of the ceremony are charged.
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
    already validated the address (case is not folded), so nothing that cannot
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
- **A budget belongs where its identity is known.** A semantic budget such as
  "5 magic links per email address" belongs in application code. A broad
  volumetric limit may belong in the proxy or firewall if traffic ever makes
  one necessary.
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
  as the backstop against programmer error.

## Passwordless auth

Two ways in, and no third: a passkey ceremony, or an emailed magic link.
There is no password to phish, reuse, guess, reset, or leak. No password
reset, password change or email-verification feature is configured. This
section is the maintained design record.

**The mailbox is the root of trust.** That is not a downgrade - it was
already true when a password could be reset by email. The change makes it
honest rather than adding a second, weaker credential in front of it.

- better-auth still mounts `/reset-password` even though email/password is
  disabled. The database must contain no `account` row whose provider is
  `credential` and no `reset-password:*` token in `verification`; otherwise a
  valid old token could recreate a password credential. The passwordless
  cutover removed both; new databases start without either, and their absence
  remains a production invariant.

- Magic-link tokens are **hashed at rest** (`storeToken: 'hashed'`; the
  plugin defaults to PLAIN, which would leave session-minting tokens in
  cleartext in the `verification` table), single-use via an atomic
  consume, and live **5 minutes**. We test our explicit storage/lifetime
  choices in `server/auth-options.node.test.ts` and rely on better-auth to
  enforce them. Successful sign-in and rejection after our deletion purge
  are exercised through the real app; this suite does not independently
  prove hashing, expiry, replay protection or atomic token consumption.
- The emailed URL points at the **SPA** (`/auth/magic`), not at
  better-auth's verify endpoint, and the SPA redeems only on a user
  CLICK. Mail scanners and link-prefetchers follow URLs in email; since
  redemption is single-use and side-effecting, a scanner hitting the
  endpoint directly would burn the user's link before they ever saw it.
- The token rides in the **URL fragment** (`/auth/magic#token=...`). A
  browser does not put the fragment in the request line or the `Referer`
  header, so clicking the link does not write the live token into our server
  or proxy logs. The `Referer` part is load-bearing: `Referrer-Policy:
  strict-origin-when-cross-origin` sends the FULL url on same-origin
  requests, so with `?token=` the landing page would hand the token to every
  request it went on to make. A legacy `?token=` link is still honored on
  read for compatibility.
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
- A deny-by-default `hooks.before` inside better-auth itself
  (`server/auth.ts`) enforces it on every `/passkey/*` endpoint not on
  the explicit ungated allowlist - today that gates
  `generate-register-options`, `verify-registration`, `delete-passkey`
  (403 `SESSION_NOT_FRESH`), and any endpoint a future plugin version
  adds fails closed. The hook keys on the RESOLVED endpoint path, so no
  second URL parser exists to diverge from the router. `delete-user`
  enforces the same window inside better-auth's own route (400
  `SESSION_EXPIRED`) - two error codes for one rule, and the client
  handles both (plus the legacy `REAUTH_REQUIRED` for compatibility).
- Not gated: `update-passkey` (a label), the anonymous passkey SIGN-IN
  ceremony (gating it would make passkey sign-in impossible), and
  `list-user-passkeys` (a read).
- Deleting the account purges the user's `verification` rows, **including
  any pending magic link for that address, whatever letter case it was
  requested in**. Without that, a link requested before the delete would
  still redeem afterwards and silently resurrect the account as a new,
  empty user. The plugin stores the submitted casing and the user row is
  lowercase, so the purge folds case on both sides
  (`server/repos/users.ts`, proven over HTTP in
  `server/auth-delete-user.test.ts`). It runs twice: before the delete
  (failing that aborts the delete) and again once the user row is gone,
  because better-auth deletes the user in several awaited steps and
  another request can write a link or passkey challenge in between. The
  second purge fails open and logs: by then the account is deleted, and
  what it could miss expires within minutes.

  Known gap, accepted: a magic-link request still in flight when the
  second purge runs (better-auth awaits token hashing before it stores the
  row) stores its link afterwards, and redeeming it creates a new, empty
  account. That is the same outcome as a link requested a moment after
  the delete, which is an ordinary sign-up, and it needs the emailed
  token. No data comes back. Closing it would need a record of deleted
  addresses checked at redemption: a separate behavior change, and a
  migration if it gets its own table. Trigger to revisit: a report of an
  account reappearing after deletion.
- Deleting the account needs the request to name the account
  (`x-grampacker-delete-user-id`, `shared/auth.ts`). The `beforeDelete`
  hook refuses with 400 `DELETE_ACCOUNT_MISMATCH` when the header is
  missing or is not the session's user id. better-auth deletes whoever
  the cookie belongs to, and the cookie can change after the user
  confirms: re-authenticating with a passkey that belongs to another
  account signs that account in (the passkey plugin narrows the choice
  to the user's own passkeys only when the user has some), and so does
  a sign-in in another tab. Without the header, the replayed delete
  removed the other account. The client also offers "Use a passkey"
  only to an account that has one.

WebAuthn user verification is REQUIRED, and enforced rather than
requested. `authenticatorSelection.userVerification: 'required'` is only
a hint - the plugin hardcodes `requireUserVerification: false` at both of
its verification sites and exposes no option for it, so a response with
the UV flag clear would otherwise be accepted. `server/auth.ts` rejects
those in the `afterVerification` hooks of BOTH ceremonies, which run
before the passkey row is created and before the session is issued. This
matters more without a password: the passkey is now the whole credential,
so an unverified ceremony would mean possession of the device alone is
the account. Direct callback tests in `server/auth-options.node.test.ts` prove
our acceptance/rejection of verified/unverified results. They do not prove
WebAuthn cryptography or the plugin's callback transaction timing.

## Supply chain

- `npm ci` everywhere, `ignore-scripts=true` + `save-exact=true` in
  `.npmrc`, exact pins, no core infra on beta/RC. We never choose a
  prerelease ourselves: not as a direct dependency, not in `overrides`, and
  not in place of a stable release.
- **Routine updates wait; security fixes bypass routine waiting and receive
  prompt review.** Neither path makes a release safe or approves a deploy.
  - *Routine:* Dependabot version updates wait 7 days on the registry
    (`cooldown` in `.github/dependabot.yml`). That reduces exposure to a newly
    poisoned release, which is often pulled within days; it guarantees
    nothing. `ignore-scripts` stops install scripts only - package code still
    runs in our build, our tests and production - and green CI shows the code
    works, not that it is harmless.
  - *Dependabot security updates* already bypass the cooldown and the weekly
    schedule. They need the dependency graph, Dependabot alerts and Dependabot
    security updates all enabled in the repository's settings. The owner
    verified on 2026-10-14 that vulnerability alerts were enabled and
    automated security fixes reported `"enabled":true` and `"paused":false`.
  - *Container images get no security updates* from Dependabot (GitHub's
    supported-ecosystems table). The Node base image moves only through
    Dependabot's daily version updates (`.github/dependabot.yml`) and the
    monthly check (`docs/vps-runbook.md`, "Routine maintenance"). Caddy moves only through
    `grampacker-deploy caddy-update`.
  - *Gap:* Dependabot and `npm audit` act only on advisories in GitHub's
    advisory database, and Dependabot raises vulnerability alerts and
    security updates only from GitHub-reviewed entries. A vulnerability a
    project publishes on its own repository reaches them only after GitHub
    reviews it. GHSA-965c-763c-88jm (better-auth, critical,
    2026-09-30) and GHSA-5r4p-p66f-jhc7 (hono, medium, 2026-09-29) were both
    still outside it on 2026-10-04.
  - *Manual path,* for a credible announcement (the project's own advisory or
    release notes) that Dependabot has not acted on: confirm the affected
    versions against the lockfile and whether our config is exposed; choose
    the smallest suitable fix, usually the patched release plus the sibling
    packages released with it; review the lockfile diff and the release's
    provenance (`npm view <pkg>@<version> _npmUser`, then
    `npm audit signatures`, which from a sandbox needs
    `tuf-repo-cdn.sigstore.dev`; if it cannot run, say so in the PR); run the
    gates for what changed. Then the normal PR, review and merge approval.
    Take the fix promptly even if our config is not exposed.
  - *Hearing about it:* Watch → Custom → Security alerts on someone else's
    repository is not a reliable advisory subscription. The owner watches
    Releases on `better-auth/better-auth`, `honojs/hono`,
    `drizzle-team/drizzle-orm` and `caddyserver/caddy`. As of 2026-10-04,
    neither better-auth's nor drizzle-orm's `SECURITY.md` names a separate
    announcement channel, and hono has none. The better-auth 1.7.7 and hono 4.13.11 release notes both
    named their advisories.
- GitHub Actions are pinned to full commit SHAs; triggers are `pull_request`,
  `push` to main and `workflow_dispatch`. Only `image.yml`'s deploy job reads a
  secret on manual dispatch, under the restrictions below. There is no
  `pull_request_target` trigger, which would run workflows with secrets against
  fork code. The repository is public; its complete history was reviewed for
  secrets and data before publication. Fork pull requests run with a read-only
  token and no secrets.
- `image.yml` publishes the production image to GHCR on a manual dispatch
  from main, with `packages: write` on its publish job only. Accepted risk:
  a workflow runs the triggering branch's copy of its file, so a branch that
  edited a workflow to ask for `packages: write` (on a dispatch or on its own
  pull request) could push any image to `ghcr.io/joes703/grampacker`, under
  any tag. Nothing on GitHub stops that on this plan; what does is that only
  the owner can push workflow-file changes or dispatch (agent tokens: no
  Workflows permission, Actions read only; `docs/testing-and-ci.md` section
  10). So a tag proves nothing: deploy only a digest that a successful run
  on main printed. Fork pull requests get a read-only token.
- The VPS deployment (`deploy/`; see `docs/vps-runbook.md`) runs as root,
  either by hand (the owner, over SSH, through `sudo`; also the recovery
  path) or from `image.yml`'s deploy job. That job runs only when a dispatch
  on main sets `deploy`, and sends only the digest its own publish job
  pushed. It logs in as `deploy`, checking a host key pinned in GitHub. The
  key's `authorized_keys` line is `restrict` (no PTY, no forwarding, no
  `~/.ssh/rc`) with a forced command, `deploy/grampacker-deploy-ssh`, which
  accepts only `deploy sha256:<64 hex>` and runs itself through `sudo`; the
  sudo rule allows that one program, which checks the digest again as root
  and runs `grampacker-deploy deploy`. The parser is tested by
  `deploy/test-grampacker-deploy-ssh.sh`, run by hand; sshd's and sudo's
  limits are checked on the VPS as described under "Deployment files and
  access". Accepted risk: whoever
  holds the key can deploy any digest in
  `ghcr.io/joes703/grampacker`, an older vulnerable image included, and
  nothing on the VPS can tell a main build from one a branch pushed (the
  `image.yml` entry above). The key is a secret of the `production`
  environment, which GitHub gives only to a run on main.
  The script accepts only an exact `sha256:` app image digest, never
  a tag. The app listens on `127.0.0.1` only, as UID/GID 10001, with a
  read-only root filesystem;
  its secrets stay in `/srv/grampacker/secrets/app.env`, outside Git.
  Accepted risk: Caddy is `caddy:2`, which follows every 2.x release,
  because Caddy supports only its newest 2.x (its SECURITY.md); a minor or
  digest pin would stop its security fixes. So an upstream regression or
  compromise reaches production at the next `grampacker-deploy
  caddy-update`. Updates are explicit, never part of an app deploy, run at
  least monthly and promptly after a Caddy security release,
  and the new image must validate the Caddyfile before it replaces the
  running one.
- A merge changes `main`, not production. A dependency or base-image fix
  reaches the VPS only when an image is published from `main` and deployed:
  within 7 days of a routine update, and as soon as practical for a security
  fix (`docs/vps-runbook.md`, "Routine maintenance").
- A manual dispatch runs the chosen ref's copy of the workflow file.
  `image.yml` therefore keeps the deploy key in the `production` environment,
  whose `main` rule refuses the key to other branches. The key itself can only
  deploy a digest (`docs/vps-runbook.md`, "Deployment files and access").

## Packing, food and public shares

Row caps are application resource policies, not D1 or SQLite engine limits:
500 categories and 500 inventory items per account, 100 lists per account,
300 gear rows and 30 packing locations per list, and 200 food items over at
most 30 days (90 meal slots). They bound growth, responses and operation work;
the exact values are modest product choices, not measured engine ceilings.
SQLite still permits 32,766 parameters per statement; duplication splits
potentially larger food-association inserts. Temporary negative ranks avoid
unique-index collisions during swaps. Parent/account cascades skip reranking
rows that the same deletion will remove, keeping deletion work linear.
Unused reorder-guard tables are inert and need no operational cleanup; live
location-delete state remains necessary for trigger-driven orphan ordering.

Authenticated routes go through `reposForUser`. The anonymous share route
uses `createPublicSharesRepo`, outside `reposForUser` because there is no
session; every statement gates itself on the slug and `is_shared`.

- **Packing locations** are children of a list, and the interesting failure is
  cross-parent stitching: a location id from another of the caller's OWN lists
  must 404, not succeed, or the ownership check degrades from "this list" to
  "this user". Enforced by a composite parent predicate on every write.
  All three write verbs have explicit wrong-parent tests
  (`server/routes/packing-locations.test.ts`).

  A status assertion alone proves nothing here. `rename` pre-reads, UPDATEs,
  then reads back through the owned parent - so with the parent predicate
  removed the route still answers 404 while the UPDATE has already committed.
  Only the row assertions catch that.

  And one fixture is not enough. An item-backed location short-circuits to
  `item_backed` (409) in the PRE-READ, before the scoped UPDATE. Lose the
  predicate from the pre-read alone and a name-only target still 404s, while
  an item-backed one answers 409 through the wrong parent - an existence
  oracle that also discloses the kind of location. Both fixtures are tested;
  each catches a mutation the other survives. Item-backed containers add a
  cycle risk (a bag inside itself, or a loop of bags); assignment rejects both
  with zero writes. Caps: 30 locations per list.

- **The food estimate** splits along one line, and the line is what to hold
  onto: the ITEMS are part of the pack, the PLAN is private. What you carry -
  `id`, `name`, `unitCount`, `weightGrams`, `sortOrder` - crosses to the public
  share, like any gear row. When you eat it does not: day count, meal slots,
  `isPacked`/`isReady` and the packing-location fields never leave a
  session-gated route. "2 x 85 g ramen" is a thing in a pack;
  "Tuesday dinner: leftover curry" is a fact about someone's week. Caps: 200
  items, 30 days.

  A per-meal item's carried count is `quantity` times the meals it is in, so
  the share repo reads `list_food_item_slots` in
  a second statement selecting `food_item_id` and nothing else, gated through
  the same shared-list join as every other query there, counted in JS. No day,
  no meal, no slot id crosses; what a reader can infer is a COUNT, which is
  the number they came for. The wire carries `unitCount` and neither
  `quantity` nor `isPerMeal`, because quantity without the mode invites a
  reader to compute the wrong answer and the mode is a step toward the plan.
  `server/routes/food.test.ts` asserts the exact key set on raw JSON and names
  those two absences individually. The share returns food rows and sums them
  with the same definition the owner view uses.

  The food rows are never JOINED to the slot associations. That trap is
  unchanged and is the severe one: a join would put one bag of trail mix on
  the wire five times over if it were scheduled across five lunches, both as
  duplicate rows and, if anyone re-adds a sum, as 2500 g. A wire test on the
  share pins it.

  The link-table read selects only `food_item_id` under the same share gate.
  It derives a count without exposing the day, meal or slot and keeps each
  food item as one row.

- **The gear/food pack union** lets one bag hold rows from two tables under a
  shared ordering. Its risk is not disclosure but integrity: a client-supplied
  id in a reorder payload must be proven to belong to this list before it can
  move, and the reorder is one SQLite transaction, so a failure rolls the
  whole reorder back rather than leaving a partial write. Ownership checks
  are owned-set membership in JS: one query whatever the payload size.

  Rank uniqueness is **per table, not across the union**: a gear row and a
  food row may legally hold the same rank in the same bag, which the reorder
  planner accounts for
  (`server/repos/pack-reorder.ts`).
  Deleting a packing location reads the destination rank and moves its
  contents inside one immediate transaction
  (`server/repos/packing-locations.ts`, `removeInTransaction`), so another
  write cannot land between the read and the moves. Legal cross-table ties
  render with a deterministic tiebreak.

## Deferred - known gaps with triggers

- **Concurrent food edits can silently destroy scheduling.** Trimming the day
  count, replacing an item's schedule, or deleting a food item starts from a
  client snapshot. Another tab can change the same plan between that read and
  the write, and the later full-replacement or cascade can erase the other
  tab's work. `FoodView` refetches on focus, which narrows but does not close
  the window. The server cannot currently distinguish a stale snapshot from a
  fresh one.

  The fix needs a food-plan revision carried by every food mutation. Every
  mutation must bump it; destructive writes must compare the client's
  revision inside the same immediate SQLite transaction and return 409 before
  writing when it is stale. Trigger: a second person using the app, or any
  report of a meal plan losing entries. Until then the blast radius is one
  list within one account, with concurrent clients.

- **Resend is a single point of failure for recovery.** If it is down,
  anyone without a working passkey cannot sign in. Accepted knowingly:
  the data is low-sensitivity, the failure is temporary and read-only
  (nobody loses anything), and the alternative - keeping a password
  around as a backup - reintroduces the credential this change exists to
  delete. Worst case for a user with no passkey and no working mailbox is
  loss of access to their own data. Restoring service may require replacing
  the Resend key or waiting for the provider; there is no password fallback.

- **Public share endpoint is unmetered** (`GET /api/shares/v2/:slug`). There
  is no rate limit on this endpoint today. The trigger for adding one is any
  sign of scraping or a share link being posted somewhere public. Until then,
  unmetered is accepted for this small app and its 62^6 slug space.

  `/api/health` is unmetered for the same reason and returns one boolean.

- **The CI verify gates are duplicated between `ci.yml` and `image.yml`.**
  Kept deliberately (the 2026-10 code-quality remediation looked at unifying
  and declined): the publish path must run its own gates even if `ci.yml`
  changes, and both files carry comments saying the copies move together.
  The accepted risk is drift - a gate added to `ci.yml` alone does not guard
  an image publish until someone notices the comment. Trigger for unifying
  (a reusable workflow): the first gate that silently missed one of the two
  files, or the next CI restructuring.

- **A list cache can show a deleted gear row.** The gear delete fan-out
  (`src/lib/queries/gear-list-items-fan-out.ts`) only touches list caches
  that hold the gear when it starts. A list fetch already in flight that
  returns the gear afterward is never invalidated, so the row shows until
  the next refetch. Display only; the server is correct. The fix is to
  invalidate the `['list-items']` prefix on settle. Trigger: anyone seeing a
  deleted item reappear in a list.

## Not applicable by construction

Recorded so they are not re-litigated:
SSRF (the only outbound HTTP is Resend's fixed endpoint; no
user-controlled URLs), mixed content (HTTPS-only + HSTS), CORS
misconfiguration (no CORS at all), local network access, user
activation, and SRI (all executable assets are same-origin and content-hashed
by Vite).
