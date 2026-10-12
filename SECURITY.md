# Security posture

**BINDING, and maintained against the code.** If this file disagrees with what
the code does, the file is wrong and fixing it is part of the change that made
it wrong. It records what is enforced, where the tests live, and what is
deliberately deferred - it is honest about gaps, and a gap stated here is a
decision, not an oversight.

Written at phase 1 (2026-07-08) against MDN's web security guides
(https://developer.mozilla.org/en-US/docs/Web/Security). Re-swept 2026-08-11,
which was overdue: the public share had shipped long before, and three whole
subsystems (packing locations, the food estimate, the gear/food pack union)
had arrived with no entry here at all. See "Later surfaces" below.

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
- **Passwordless.** grampacker stores no password, and there is no reset,
  change, or verify flow to attack. There are exactly two ways to get a
  session: a passkey ceremony, or redeeming an emailed magic link. See
  "Passwordless auth" below and `docs/passwordless-auth-design.md`.
- Passkeys (WebAuthn): rpID is `grampacker.app`, derived with an
  exact-or-dot-boundary match so lookalike domains are excluded
  (`server/passkey-rp-id.node.test.ts`).
- Secrets (`BETTER_AUTH_SECRET`, `RESEND_API_KEY`) are Worker secrets;
  nothing secret is in the client bundle or the repo (`.dev.vars` is
  gitignored).
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
  that creates a user and mints a session). Budgets: passkey sign-in
  30/5min, sign-in 10/10min, magic-link verify 10/10min, delete-user
  5/10min, default 30/10min. Single atomic upsert (no lost updates under
  concurrency - proven by a 60-way burst test), 429 + Retry-After. The same
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
- **Where a budget lives depends on what it counts, not on a blanket rule.**
  This used to read "Cloudflare WAF is hardening on top, never the mechanism
  (portability rule: the limiter must work on the Node target too)". That
  reason is retired, and on 2026-08-11 it caused an agent to build a D1-backed
  limiter that wrote a row on every anonymous page view to protect a read.

  The line that actually holds: a **semantic** budget - one that has to see
  something only the app knows, like "5 magic links per email address" - can
  only live in application code, and every budget listed above is that kind.
  A **volumetric** budget - "too many requests from one address" - belongs at
  the edge, where it refuses before the Worker runs and before D1 is touched.
  An application counter cannot do the edge's job: it costs a write to save a
  read and cannot stop the invocation it is counting.
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
  `server/auth-delete-user.test.ts`).
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
  `.npmrc`, exact pins, no core infra on beta/RC. We never choose a
  prerelease ourselves: not as a direct dependency, not in `overrides`, and
  not in place of a stable release.
  - *Exception, Cloudflare development tooling only.* The stable `wrangler`,
    `@cloudflare/vite-plugin` and `@cloudflare/vitest-plugin` releases we
    pin require these prereleases at exact versions, so no stable
    alternative can be installed with them:
    - `miniflare` `5.20261006.1-alpha` (pinned by all three): the local
      Workers simulator behind `npm run dev` (the Worker dev server; the API
      tests no longer use it).
    - `youch` `4.1.0-beta.10` (pinned by miniflare): formats error pages
      in local development.
    - `unenv` `2.0.0-rc.24` (pinned by wrangler and the Vite plugin, and an
      exact peer dependency of `@cloudflare/unenv-preset`): stand-ins for
      Node.js APIs that the build can bundle into the Worker under
      `nodejs_compat`.

    The exception covers only these packages, only at the versions that a
    reviewed stable Cloudflare release pins. Re-check it, and update the
    versions here, in the change that updates that tooling. It does not mean
    that any prerelease a dependency picks, or any version npm tags
    `latest`, is acceptable. `unenv` is the one that can reach production:
    because `nodejs_compat` is on, the build can put its Node.js stand-ins
    into the deployed Worker. Inspect the Worker bundle when the tooling,
    the `nodejs_compat` setting, or our use of Node.js APIs changes.
    Searching for unenv's `[unenv]` error prefix is a quick check, but
    finding none does not prove that unenv code is absent: some of its code
    has no such marker, and the bundler can remove unused error paths.
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
    security updates all enabled in the repository's settings. The agent token
    can confirm only the dependency graph (`/dependency-graph/sbom` answers);
    the other two need admin read, so the owner checks them.
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
    Releases on `better-auth/better-auth`, `honojs/hono` and
    `drizzle-team/drizzle-orm`. As of 2026-10-04, neither better-auth's nor
    drizzle-orm's `SECURITY.md` names a separate announcement channel, and
    hono has none. The better-auth 1.7.7 and hono 4.13.11 release notes both
    named their advisories.
- GitHub Actions pinned to full commit SHAs; triggers are `pull_request`
  and `push` to main - never `pull_request_target` (which would run
  workflows with secrets against fork code); private repo.
- No workflow that names a secret carries `workflow_dispatch`. A manual
  dispatch runs the CHOSEN REF's copy of the workflow file, and
  same-repository refs receive repository secrets, so it would let a branch
  execute an edited privileged workflow. `deploy.yml` carried one as a
  recovery path until 2026-09-04; recovery is now a re-run of the failed
  run, which keeps the original commit's workflow file - for any failed
  step except the marker step, where production is already on the new SHA
  and the marker is repaired by hand instead (see the header of
  `deploy.yml`). Narrowly stated: `deploy.yml`'s `workflow_run` trigger
  still fires on PR-branch CI completions, but its job-level `if` rejects
  them before any step runs, and the copy that runs is always the one on
  main.

## Later surfaces (packing locations, food, the pack union)

Added 2026-08-11. These three shipped after this file was written and had no
entry until the re-sweep. None introduces a new authentication or
authorization MECHANISM: the authenticated routes all go through
`reposForUser`, and the one anonymous path (the share's food rows) goes
through `createPublicSharesRepo`, which is deliberately outside `reposForUser`
because there is no user - it self-gates every statement on slug + is_shared
instead. What follows is what is DIFFERENT about these surfaces, not a
restatement of the general posture.

- **Packing locations** are children of a list, and the interesting failure is
  cross-parent stitching: a location id from another of the caller's OWN lists
  must 404, not succeed, or the ownership check degrades from "this list" to
  "this user". Enforced by a composite parent predicate on every write.
  All three write verbs have explicit wrong-parent tests
  (`server/routes/packing-locations.test.ts`); PATCH was the gap and was
  closed 2026-08-11. Two things that gap taught, both worth keeping:

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

  Amended 2026-08-12 by migration 0024, and the amendment is a real widening
  that must not be glossed. A per-meal item's carried count is `quantity` x
  the meals it is in, so the share repo now DOES read `list_food_item_slots` -
  a second statement selecting `food_item_id` and nothing else, gated through
  the same shared-list join as every other query there, counted in JS. No day,
  no meal, no slot id crosses; what a reader can infer is a COUNT, which is
  the number they came for. The wire carries `unitCount` and neither
  `quantity` nor `isPerMeal`, because quantity without the mode invites a
  reader to compute the wrong answer and the mode is a step toward the plan.
  `server/routes/food.test.ts` asserts the exact key set on raw JSON, and
  names those two absences individually.

  Changed 2026-08-11, from an aggregate to rows. Hiding food was never a
  privacy decision - it was a leftover from food arriving late, and it cost a
  permanent asymmetry between what the owner saw and what a reader did. The
  change also deleted the aggregate query that existed only for this surface:
  the share sums the rows exactly as the owner's own view does, so there is
  one definition of food weight rather than two that could drift.

  The food rows are never JOINED to the slot associations. That trap is
  unchanged and is the severe one: a join would put one bag of trail mix on
  the wire five times over if it were scheduled across five lunches, both as
  duplicate rows and, if anyone re-adds a sum, as 2500 g. A wire test on the
  share pins it.

  Since 0024 the module does READ the link table, in a separate statement
  selecting `food_item_id` and nothing else, under the same share gate, so a
  per-meal item's carried count can be counted in JS. Reading a count is not
  joining and summing - the item stays one row - but it IS more of the plan
  than this surface used to touch, and the paragraph above states exactly
  what a reader can and cannot infer from it.

- **The gear/food pack union** lets one bag hold rows from two tables under a
  shared ordering. Its risk is not disclosure but integrity: a client-supplied
  id in a reorder payload must be proven to belong to this list before it can
  move, and a lost race answers 409 with the whole batch rolled back rather
  than a partial write. Ownership prechecks are owned-set membership in JS,
  never an unbounded `inArray`, because D1 caps bound parameters at 100.

  Two details worth being exact about, because a looser summary invites the
  wrong assumption. Migration **0022** added the union with NO rank
  enforcement; **0023** added the unique indexes and range guards afterwards,
  deliberately sequenced so the enforcement could not reject rows the earlier
  release had already written. And uniqueness is **per table, not across the
  union** - a gear row and a food row may legally hold the same rank in the
  same bag, which the reorder planner accounts for
  (`server/repos/pack-reorder.ts`).

- **Deleting a packing location appends its contents after a rank read
  taken before the write batch** (`server/repos/packing-locations.ts`,
  `base`). The census that aborts the batch guards the SOURCE bag only, and
  the cohort's unique index is per table, so a food row arriving in
  Unassigned at that rank while gear is being appended there (or the
  reverse) produces a legal cross-table tie. Nothing is lost or half-written:
  the order of the appended block degrades to the deterministic tiebreak
  until the next reorder renumbers the cohort. Accepted; it is the same
  cross-table-tie class migration 0022 tolerates by design.

## The app has TWO public origins

`wrangler.jsonc` routes `grampacker.app` as a custom domain and does NOT set
`workers_dev: false`, so the Worker also answers on its `*.workers.dev`
hostname. Both serve the same code.

What that does and does not mean, because the config comment only covers half
of it:

- **Writes are refused there.** `BETTER_AUTH_URL` is the single canonical
  origin, and both better-auth's origin validation and our CSRF middleware
  check against it, so an unsafe request carrying the workers.dev Origin is
  rejected. WebAuthn additionally requires the real domain.
- **Anonymous reads are NOT.** `GET /api/shares/v2/:slug` takes no session and
  no CSRF header, so a share link works on the workers.dev hostname too. It
  publishes exactly what the real domain publishes - the same allowlisted DTO
  - so this is a second address for public data, not a second trust level.
- **Accepted**, not overlooked. Setting `workers_dev: false` would close it;
  the reason not to bother is that it exposes nothing the canonical origin
  does not already expose to the same anonymous audience. Revisit if the share
  DTO ever carries something whose distribution should be tied to a hostname,
  or if the second origin starts showing up where a user could mistake it for
  the real one.

## Deferred - known gaps with triggers

- **Production Cloudflare credentials are not environment-scoped.** Closing
  this needs repository SETTINGS changes plus a one-line workflow change; no
  pull request closes it on its own.

  What the repository shows, and it is all this entry claims: `deploy.yml`
  reads `secrets.CLOUDFLARE_API_TOKEN` and `secrets.CLOUDFLARE_ACCOUNT_ID`,
  and no job in any workflow declares an `environment:` key, so no deployment
  branch policy applies to any job here. **No GitHub setting has been
  inspected.** Whether those secrets are defined at repository or organization
  scope, and whether this plan offers environments on a private repository at
  all, are unverified - `gh api user --jq .plan.name` returns nothing under
  the sandbox token (`docs/testing-and-ci.md` section 12).

  Why it matters: a secret available to the repository is readable by a
  same-repository `pull_request` run of any workflow, including one that a
  pull request itself edits. The merge gate does not help - the run happens
  before the merge. Today the only thing between a branch and these
  credentials is that no workflow reads them outside `deploy.yml`, which is a
  convention, not a control.

  Closing it is a coordinated settings-and-code migration, not a checklist of
  independently useful steps: a `production` environment holding the
  credentials, its deployment branch policy restricted to `main`, broader-scope
  availability withdrawn (for an organization secret, removing THIS
  repository's access is enough - the organization secret itself need not be
  deleted), and `environment: production` on the deploy job, since a branch
  policy binds only a job that references it. Withdrawing the broader-scope
  availability is what actually stops the exposure; do it without the rest and
  deploys break until the environment wiring exists, so the order matters.

  Trigger: any second person gaining write access, or any need to run workflow
  code that is not reviewed before it runs. Until then the accepted risk is a
  single-maintainer repository where every branch is authored by the
  credential owner.

- **Concurrent food edits can silently destroy scheduling.** Not a security
  hole - an integrity one, recorded here because this is the maintained list
  of live gaps and the plan that describes it in full is a dated record.

  What is lost: the day x meal SLOTS and their placements - which food is
  eaten when. Of the three CLIENT-SIDE paths below, one deletes placements
  DIRECTLY; the other two delete a parent row and let the placements
  cascade. Two leave the food items themselves alone; one removes an item
  outright. A fourth, server-side path (the day-count race, last in the
  list) was different in kind and is now closed.

  There were FOUR paths until the Skip feature was removed. Marking a meal
  not needed cleared that slot's placements, and its confirm was skipped
  whenever the cached snapshot said the slot was empty - the worst of the
  four, because a stale snapshot suppressed the warning entirely.

  Each of the three client-side paths decides from a cached snapshot.
  `staleTime` is 30s, but
  that only marks data stale - it does not refetch, and the app-wide default
  in `src/App.tsx` is `refetchOnWindowFocus: false` with no polling.

  PARTIALLY MITIGATED 2026-08-12: `FoodView` overrides that default to
  `refetchOnWindowFocus: true` (the only query in the app that does), so
  returning to a tab re-reads the plan before you can act in it. Every path
  below lives on that view, so none of them can now be driven from an
  arbitrarily old snapshot - the exposure is a tab you are already looking at
  while another client writes.

  This does NOT close the gap and must not be read as closing it. The window
  between the refetch and the write is still open. Only the revision guard
  below makes the write itself safe.

  - **Trimming the day count** drops every slot past the new end. Since
    2026-10-02 the trim reads the plan fresh, decides whether to warn from
    that read, and writes nothing if the read fails (`changeDays` in
    `src/lists/FoodView.tsx`). What remains is a write from elsewhere in
    the one round trip between that read and the PUT.
  - **Rescheduling an item** is a full replace, not a merge: the picker opens
    from the cached `slotIds`, and the write deletes every placement for that
    item before inserting the submitted set (`server/repos/food.ts`). A stale
    client therefore erases placements another client added, without touching
    the day count.
  - **Removing an item** acts on the cached row
    (`src/lists/FoodCarryingList.tsx`) and deletes it, cascading every
    placement it had (`list_food_item_slots` has ON DELETE cascade on the
    item). This is the one path that destroys the item too, so a stale client
    can remove something another client had just rescheduled - and the guard
    in Release B has to cover this delete, not only the trim.

  - **Changing the day count** used to plan the missing slots from a read
    taken outside the write, so two day-count writes racing could leave the
    grid with a hole or collide on the slot unique index as a 500. CLOSED
    2026-10-12: `setDayCount` in `server/repos/food.ts` now reads, plans and
    writes in one immediate SQLite transaction, so two day-count writes run
    one after the other (`server/repos/food-transactions.test.ts`). Grids
    written before then may still hold a hole; the next day-count write
    repairs it. A day-count write from a STALE client is the first bullet
    above and stays open.

  A fifth path exists and is deliberately out of scope: **deleting the list**
  cascades its food entirely (`server/repos/lists.ts`), reachable from three
  cached-list surfaces. It belongs to a different problem - it destroys the
  whole list, its confirm is unconditional rather than snapshot-derived, and a
  food-revision guard is the wrong instrument for it. Noted so the omission is
  a decision rather than an oversight. Account deletion cascades everything
  too and does not act from a cached snapshot at all. Deleting a packing
  location only unassigns and re-ranks food; it destroys nothing.

  In each of the three client-side cases a second client's work is deleted
  by a write that never saw it. Nothing stops it today: the server cannot
  tell a write made from a stale snapshot from a fresh one.

  The fix is designed and prototyped but unbuilt, and needs two releases
  separated by a deploy. Release A adds `lists.food_revision` and makes
  **every** food mutation bump it - that part is load-bearing, because a
  revision only some writes touch cannot detect the concurrent create or
  reschedule this is meant to catch. Release B checks the client's revision
  and answers a 409 the client consumes as control flow. The original design
  forced the rollback with a NOT NULL guard table, because a D1 batch could
  not branch; food writes are now SQLite transactions, so Release B can
  compare the revision inside the write's transaction and return before
  writing. The full design (section N1) is in git history:
  `git show 89e4f1c:docs/review-remediation-plan.md`. Verify it against the
  code before trusting any of it.

  Trigger: a second person using the app, or any report of a meal plan losing
  entries. Until then the blast radius is one list, within one account, with
  concurrent clients - two tabs, or a phone and a laptop.

- **Creating or renaming a packing location commits then reports failure**:
  CLOSED 2026-08-12. Both `create` and `rename` in
  `server/repos/packing-locations.ts` used to write and then call
  `readOwnedList` in a second round trip to compose their response, so a
  read-back that threw reported failure over a row that had already
  committed - `create` 500'd ("insert could not be read"), `rename` 500'd or
  mapped it to 404. Location names are NOT unique (the only unique index is
  `container_list_item_id`), so retrying a "failed" create made a SECOND bag
  with the same name rather than refusing; promoting gear to a container is
  the one path that does refuse, with "Item is already a container".

  Each now runs its checks, its write and its read-back inside ONE SQLite
  transaction: a statement that fails rolls the whole sequence back, so a
  failing read-back takes the write with it. The read runs after the write
  inside that transaction, so it sees the row.

  Scoped claim, deliberately: this closes the read-back-failed case and the
  window between the two round trips. It does not make the write atomic with
  its RESPONSE - a transport failure after the batch commits, or a failure
  mapping the batch's results, still leaves the caller unsure. Nothing at this
  layer can fix that; only an idempotency key would.
  `rename`'s pre-read, write and read-back share the transaction, so a
  concurrent delete can no longer land between them; both "matched nothing"
  branches are unreachable and throw rather than answer not_found over a
  committed rename.

  server/repos/pack-transactions.test.ts proves the packing-location and
  pack-order transactions are all-or-nothing by injecting a failure partway
  through; those tests fail when the transaction is removed.

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
- **Two list flags were retired from every surface** (2026-08-11):
  `groupWorn` and `readyChecksEnabled`. Neither is on any DTO, neither is
  accepted on PATCH, and `groupWorn` is off the public share DTO. It was
  published there for a real reason - the share honored it - until #110 made
  worn grouping unconditional on 2026-07-21, after which it was a public
  field nothing read. Their columns were dropped in a later release by
  migration 0027 as a contract step - a native `ALTER TABLE ... DROP
  COLUMN`, which rewrites rows in place and is NOT the table rebuild that
  cascade-deletes children (AGENTS.md draws that line). Both names stay in
  the forbidden-key denylist in
  `server/routes/shares.test.ts` so a future projection cannot reintroduce
  them quietly.

  Taking a required field OFF a response is not free: `apiFetch` strips
  unexpected fields but THROWS on a missing required one, so a tab still open
  on the previous bundle reports its own committed writes as failures until
  it is reloaded. Owner's call, 2026-08-11, was to accept that rather than
  keep dead fields on the wire or stage a two-release retirement - a refresh
  is the remedy, and this is a single-user app. The contract comment in
  `src/lib/api.ts` said the opposite and has been corrected rather than left
  standing.

- **Public share endpoint** (`GET /api/shares/v2/:slug`, phase 4): dedicated
  repository + DTO allowlist + private-column ABSENCE tests + uniform
  404 for unknown and inactive slugs. The re-sweep of this file happens
  before it ships. Food crosses this boundary as rows carrying no schedule -
  see "Later surfaces" above for that split, and the metering entry below for
  the rest of the endpoint's posture.
- **Public share endpoint is UNMETERED, and the control when it is needed
  belongs at the edge** (`GET /api/shares/v2/:slug`). Raised by review
  2026-07-11; still open by decision, 2026-08-11. There is no rate limit on
  this endpoint today.

  When one is wanted, it is a Cloudflare rate limiting rule, not application
  code: the rule refuses before the Worker runs and before D1 is touched,
  where an application counter would add a database write to every anonymous
  view in order to protect a read, and could not stop the invocation it was
  counting. An app-level limiter was written and then removed for exactly
  that reason (2026-08-11).

  This is the semantic-versus-volumetric split stated under "Abuse and rate
  limiting" above. The rewrite once ruled that the WAF may never be the only
  control; that rule existed only for portability to a Node target, which is
  retired.

  **Trigger for creating the rule:** any sign of scraping, or a share link
  being posted somewhere public. Until then, unmetered is the accepted
  position for an app with one user and a 62^6 slug space - a stated
  decision, not an oversight. Dashboard config is invisible to code review,
  so this entry is the authoritative record of both the absence and the
  trigger; `server/routes/shares.ts` and `docs/authz-matrix.md` note the
  absence too, and point here.

  `/api/health` is unmetered for the same reason and is even less
  interesting: it returns a single boolean.

- **Web Analytics**: `https://static.cloudflareinsights.com/beacon.min.js` (and
  its `/`-suffixed prefix form) is allowed in **script-src**, and only there.
  Cloudflare Web Analytics is enabled
  on the zone and the edge injects its beacon into our HTML *after* the Worker
  returns, so no code in this repo can see it - this entry previously claimed
  the beacon "is NOT in the CSP" and was simply wrong. (It hid behind a false
  negative: the edge only injects when the request sends `Accept: text/html`, so
  a plain `curl` shows a clean document and a browser does not.) Under
  `script-src 'self'` the browser blocked it on every page load, so we paid for
  a third-party request, collected no analytics, and carried a permanent CSP
  violation in the console that would mask the next real one.

  The grant is **path-restricted**, not host-wide. A bare origin would authorize
  every executable path on `static.cloudflareinsights.com`, now and in future;
  the trailing slash confines it to the beacon's own prefix.

  **connect-src is NOT widened.** An edge-injected beacon reports to the
  same-origin `/cdn-cgi/rum` (only a *manually embedded* beacon talks to
  `cloudflareinsights.com` directly), already permitted by `connect-src 'self'`.
  Allowing the static origin as a connection destination would grant a
  third-party script an exfiltration target for nothing. Pinned by a test.

  **On the SRI, do not overclaim.** The injected tag carries
  `integrity="sha512-..."` and `crossorigin="anonymous"`, so a browser refuses
  bytes that do not match the hash the edge advertised. That defends against a
  tampered or compromised response *from* `static.cloudflareinsights.com`. It is
  **not** an application-controlled supply-chain pin: Cloudflare chooses both the
  injected tag and the script it points at, and can rotate the URL and the hash
  together without our knowledge. It constrains that host; it does not constrain
  Cloudflare.

  Why we accept it anyway: Cloudflare already terminates our TLS and serves our
  origin, so this adds no *new* administrative trust principal. What it does add
  is browser-enforced script authority for more Cloudflare infrastructure - a
  vulnerability on that host would now reach a page holding a live session
  cookie. That is a real, bounded increase in attack surface, and the honest
  reason to take it is that the alternative (leave the block in place) means
  paying every cost of the beacon and getting none of the data. Turning Web
  Analytics off at the zone remains the strictly safer option if the RUM data
  ever stops earning its keep.

- **A parent deleted mid-write answers 500, not 4xx.** Gear create, update,
  import and bulk move check ownership of the category or gear first, then
  write. If another client deletes that parent in between, the foreign key
  rejects the write and the route answers 500 (`server/repos/gear-items.ts`
  `create`). Nothing is half written: each write is one statement or one
  batch. Food, packing locations, lists and list items no longer have the
  window: each runs its checks, writes and read-back in one SQLite
  transaction (2026-10-12; `server/repos/list-transactions.test.ts`), so a
  concurrent delete lands before or after the whole operation. The gear
  repository closes it when it is converted.
  Trigger: a second concurrent client, or any such 500 in the logs.

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
activation.

SRI used to sit in that list ("all assets same-origin and content-hashed
by Vite"). It no longer belongs there: the Cloudflare Web Analytics beacon
is a genuine third-party script (see Web Analytics above). Our own assets
are still same-origin and content-hashed, so they need no SRI - but the one
script we do not serve arrives SRI-pinned by Cloudflare, and that is now a
property we depend on rather than one we can call inapplicable.
