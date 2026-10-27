# Security posture

**BINDING, and maintained against the code.** If this file disagrees with what
the code does, the file is wrong. Fix it in the change that made it wrong. It
records what is enforced, which tests prove it, and what is deliberately
deferred. A gap stated here is a decision, not an oversight.

Per-route contracts live in `docs/authz-matrix.md`, the authority on who can
call what. This file describes the shape of the defenses and the reasons for
them. Where the two overlap, the matrix wins on detail.

## Authorization boundary (IDOR)

- Handlers never touch the DB: they receive user-scoped repositories
  (`reposForUser(db, userId)`) from the session middleware. Ownership is
  fixed on the server; client-supplied ids cannot widen it.
- Lint enforces the boundary and fails closed: `server/**` cannot import
  the DB factory, schema, drizzle, repo constructors or auth internals
  outside the exempt layers, dynamic `import()` is banned, and inline
  `eslint-disable` comments are ignored (`noInlineConfig` in
  `eslint.config.js`). Lint runs inside `npm run build` and CI.
- Every route gets a row in `docs/authz-matrix.md` BEFORE it ships, and
  the row drives owner / non-owner / anonymous tests. No row, no route.

## Sessions and authentication

- better-auth cookie sessions: HttpOnly, SameSite=Strict, Secure in
  production (https baseURL), 30-day sliding expiry. The long session is a
  deliberate choice: the gear and list data a session reaches has low
  sensitivity, so convenience wins over frequent sign-ins. No tokens in
  localStorage anywhere.
- **Passwordless.** grampacker stores no password and configures no password
  reset, password change or email-verification feature. There are exactly two
  ways to get a session: a passkey ceremony, or redeeming an emailed magic
  link. The reset route better-auth still mounts, and the database invariant
  that keeps it unusable, are under "Passwordless auth" below.
- Passkeys (WebAuthn): rpID is `grampacker.app`, derived with an
  exact-or-dot-boundary match so lookalike domains are excluded
  (`server/passkey-rp-id.node.test.ts`).
- Secrets (`BETTER_AUTH_SECRET`, `RESEND_API_KEY`) live only in the
  root-owned VPS file `/srv/grampacker/secrets/app.env`. Nothing secret is in
  the client bundle or the repository.
- **A missing `RESEND_API_KEY` fails closed.** The console sender prints the
  redeemable magic-link URL to the log and reports success. It is selected
  only when `BETTER_AUTH_URL` is `localhost` (`isDevEnvironment` in
  `server/middleware/security-headers.ts`, the same test that drops the CSP).
  On any other origin a missing key makes the magic-link send fail as a
  logged 500; session lookups and every other auth route keep working
  (`server/email/index.ts`, `server/auth-error-logging.test.ts`).
- **Bound query parameters stay out of the server's log lines.** Drizzle's
  wrapper error puts every bound value in its message (and V8 repeats it in
  the stack header): gear names, costs, and on a failed session lookup the
  session token. One sanitizer, `describeError` in
  `server/middleware/error-handler.ts`, replaces such messages, drops their
  stacks, and keeps the query text and the SQLite root-cause message, which
  never contain values. Three sinks go through it: the error handler's own
  entries, better-auth's logger (the `logger` option, `authLogger`), and the
  `/api/auth/*` route in `server/index.ts`. That route catches any error
  that escapes an auth endpoint (`onAPIError: { throw: true }`) before
  better-call's raw `console.error` fallback can print it, and logs 5xx
  responses through `logAuthFailure`. Proven over the real app in
  `server/auth-error-logging.test.ts`.

  Two things this does NOT cover. First, better-auth's adapter factory
  (`@better-auth/core`, `db/adapter/factory.mjs`) writes one raw
  `console.error(error)` of its own when the SECOND statement of a JS-side
  join fails (the user read after a successful session read). That line is
  outside the sanitizer and the log budget. The value bound there is the
  user id, never the token, and the test above pins that boundary. The
  installed Drizzle adapter has no native join to switch to. Second, an
  arbitrary error message is not cleaned of user-controlled text: a repo
  error that quotes a client-supplied id still logs it.

## CSRF

Four layers, tested in `server/middleware/csrf.test.ts` (route-level coverage
in `server/routes/me.test.ts`):

- No CORS headers are sent, ever. Cross-origin scripts cannot read
  responses.
- SameSite=Strict cookies.
- Unsafe methods on non-auth routes require the `x-grampacker-request`
  header. That header IS the control: a cross-origin script cannot set it
  without a preflight, and the preflight can never pass because no CORS
  headers are sent.
- `Origin`, **when present**, must match `BETTER_AUTH_URL`. An ABSENT Origin
  is allowed (`csrf.ts` checks `origin && origin !== expected`), so this is
  defense in depth on top of the header, not a second independent gate.
- `/api/auth/*` is origin-checked by better-auth itself against
  `BETTER_AUTH_URL` (forged origin -> 403,
  `server/auth-origin-validation.test.ts`). `disableOriginCheck: false` is
  set explicitly, because better-auth skips the check when it thinks it runs
  under test.

## XSS and response headers

- React escaping everywhere; no `dangerouslySetInnerHTML`, no `eval`. User
  markdown (list notes, also on the public share) renders through
  `src/components/MarkdownContent.tsx`, which ignores raw HTML and keeps
  react-markdown's default URL filter (`javascript:` and `data:` blocked;
  `MarkdownContent.test.tsx`).
- Hono's `secureHeaders` is applied to every response: SPA shell, static
  assets and API (`server/middleware/security-headers.ts`). Our values: CSP
  `default-src 'self'` with no external origins, `frame-ancestors 'none'`
  and `X-Frame-Options: DENY` (clickjacking), `Referrer-Policy`,
  `Permissions-Policy`, HSTS with preload. Hono's defaults for the rest:
  `nosniff`, COOP, CORP `same-origin`, `Origin-Agent-Cluster`,
  `X-DNS-Prefetch-Control`, `X-Download-Options`,
  `X-Permitted-Cross-Domain-Policies`, `X-XSS-Protection: 0`. Tests assert
  the exact set on an HTML route, an API route and an error response
  (`server/middleware/security-headers.test.ts`).
- Dev mode drops exactly one header, the CSP (Vite HMR needs inline
  scripts). A test pins that difference.

## Abuse and rate limiting

All budgets are in `server/middleware/rate-limit.ts` and tested in
`server/middleware/rate-limit.test.ts`.

- A DB-backed fixed-window limiter covers `/api/auth/*`. It fails closed
  across ALL methods, with a two-entry allowlist of pure-read GETs
  (`get-session`, `passkey/list-user-passkeys`). better-auth GETs are not
  read-only: the passkey challenge endpoint is an anonymous GET that writes a
  row, and `magic-link/verify` is a GET that creates a user and mints a
  session. Budgets: passkey sign-in 30/5min, sign-in 10/10min, magic-link
  verify 10/10min, delete-user 5/10min, default 30/10min. 429 with
  Retry-After.
- Each charge is one atomic upsert that decides the count and the window
  together. Overlapping requests cannot lose an increment, reset one expired
  window twice, or move a newer window back. Burst tests cover this,
  including one across a window roll; the window boundary and Retry-After
  rounding are pinned to the millisecond.
- When any bucket starts a new window, the limiter also deletes EXPIRED
  `verification` rows. better-auth deletes them only as a side effect of
  `findVerificationValue`, which unrelated routes call (magic-link verify,
  `GET /reset-password/:token`, the OAuth callback's state check). Passkey
  ceremonies consume through `consumeVerificationValue`, which deletes only
  the consumed challenge. Without our sweep, an abandoned passkey challenge
  would expire after five minutes and then stay until some unrelated request
  arrived. Cleanup must not depend on that traffic. The sweep fails open (the
  rows it misses are already dead); the charge fails closed.
- **The passkey ceremony has its own budget, looser than `sign-in`.** One
  ceremony costs TWO requests (options, then verification), and an abandoned
  one still costs one. On the 10/10min sign-in budget that is five attempts,
  and a user with several passkeys can spend them by picking the wrong one a
  few times. A WebAuthn assertion needs the private key in the
  authenticator, so there is no secret to brute force, and lockout after a
  few attempts buys nothing. The budget bounds resource cost, stated here
  against the 10/10min sign-in budget:
  - `generate-authenticate-options` is an anonymous GET that writes a
    `verification` row. Sustained challenge creation is six times higher
    (~1,440 to ~8,640 rows/day/IP). Expiry alone does not remove rows, so
    the sweep above is what makes this safe, not the budget.
  - A successful verification mints a session and never revokes the
    previous one; there is no cap on concurrent sessions. Sustained minting
    is ~180/hour/IP instead of ~30. Each one still needs a valid assertion
    AND user verification, so this is not anonymous session minting.
  - Worst-case BURST across a fixed-window boundary (a full limit just
    before expiry plus a full limit after) is ~59 accepted requests close
    together, against ~19 for sign-in, and ~119 for 60/10min. That is why
    the window is shorter instead of the ceiling higher.
  - After a rejection, the remaining wait is at most five minutes, not at
    most ten. It is not a fixed five-minute wait.

  The tests pin that ten fumbled ceremonies never 429, and that both halves
  of the ceremony are charged.
- **Requesting a magic link is charged to THREE buckets**, because no single
  key stops all three abuses. All are charged on every send, and any one can
  429: a **global** cap (90/day), a **per-IP** cap (10/10min) and a
  **per-address** cap (5/hour).
  - The **global** bucket is the only guard on the mail provider's quota,
    which is itself global (Resend free tier: 100/day). A per-IP cap cannot
    do that job: a handful of IPs would still drain the provider, and then
    nobody can recover an account. **90/day is a PRODUCT choice, not a
    security constant.** It is sized to the provider's quota only. To raise
    it, change `MAGIC_LINK_SEND_GLOBAL.limit` in
    `server/middleware/rate-limit.ts` and `MAGIC_SEND_GLOBAL_LIMIT` in its
    test, keeping headroom under the provider's daily limit. Raising it
    weakens nothing: the per-IP and per-address buckets are the anti-abuse
    controls, and neither should be relaxed for convenience.
  - The **per-address** bucket cannot be keyed by IP: an attacker who rotates
    IPs is a first-time caller every time, and could flood one victim's
    inbox, or farm tokens for one account, without touching an IP bucket. It
    is an anti-abuse control; do not relax it for convenience. Its key is a
    domain-separated HMAC (`createHmac`, `emailBucketKey`) of the lowercased
    address, with `BETTER_AUTH_SECRET` as the key. Lowercased, because
    better-auth treats `Victim@` and `victim@` as one account. HMAC, so
    `rate_limits` is never a plaintext or dictionary-reversible list of who
    uses the app.
  - The key **must not trim** the address. better-auth validates with
    `z.email()` and does not trim, so `"victim@x.com "` is rejected and no
    mail is sent. A trimming key would still charge the victim's real bucket,
    so an attacker on rotating IPs could burn the victim's 5/hour budget
    without sending any mail, and lock them out of the only way back into a
    passwordless account. The key must match the identity better-auth
    resolves: lowercase, no trim.
  - **Charge order is IP -> address -> global, and it matters.** A request
    the first two refuse never reaches the shared quota, so a flood cannot
    spend mail budget it was never going to use. In the reverse order, one
    host could block the whole app's recovery for a day.
  - **The global bucket is charged in `sendMagicLink` (`server/auth.ts`),
    NOT in the middleware, and that placement is a security control.** The
    middleware runs before better-auth parses the body, so it cannot tell a
    deliverable address from junk. If it charged the global bucket, ~90
    requests with `{"email": "not-an-email"}` from rotating IPs would drain a
    day of the only account-recovery path without sending a single email.
    Inside the callback, better-auth has already validated the address, so
    nothing that cannot become an email can spend the shared quota.
  - The middleware still **peeks** at the global bucket (a read, not a
    charge) and refuses early when it is spent. better-auth writes the
    `verification` row *before* it calls `sendMagicLink`, so without the peek
    every request at a drained quota would write a row before being refused.
    The peek can race, and that is fine: the atomic charge in the callback is
    the gate, and a test pins that a concurrent burst cannot over-send.
  - **Residual, accepted:** a charge refused in the callback leaves an
    orphan `verification` row (hashed, never emailed, 5-minute expiry),
    because better-auth writes it first. The peek limits this to the quota
    BOUNDARY: once the bucket is spent, requests never reach better-auth. So
    the orphans are bounded by how many requests can cross the boundary at
    once, which the per-IP and per-address buckets limit. No attacker sees
    the token. Charging earlier would mean validating the address ourselves,
    and a validator looser than better-auth's would be a quota BYPASS, a
    worse bug than the rows.
  - **The global counter counts VALIDATED SEND ATTEMPTS, not mail
    delivered.** It is charged just before `email.send`, so two concurrent
    sends cannot both see a free slot; a provider failure still spends one.
    Reserve-then-refund would fix that, but a process that dies mid-send
    would then leak the reservation until the window rolls. That is not
    worth it at 90 slots against a 100/day provider cap.
  - This order holds **only for requests that arrive over HTTP**. A
    server-side `auth.api.signInMagicLink(...)` call skips the Hono
    middleware (no IP charge, no address charge) but still charges the global
    quota. Nothing calls it that way today; anything that does steps around
    two of the three buckets.
- **Accepted trade-off:** if the global bucket is drained, nobody can
  recover an account until the window rolls. The effect is the same as the
  provider's quota running out, but it fails earlier and on purpose, and the
  two narrower caps in front of it make draining it expensive.
- **better-auth's own limiter is disabled** (`rateLimit.enabled: false`), so
  the rate-limit rule the magic-link plugin ships NEVER FIRES. Magic links
  are not self-policing. Every budget above is ours, and a test asserts it.
- **A budget belongs where its identity is known.** A semantic budget such as
  "5 magic links per email address" belongs in application code. A broad
  volume limit may belong in Caddy or the firewall if traffic ever needs one.
- CAPTCHA (Turnstile) is parked in `PARKED.md`; trigger: observed signup
  abuse or real user growth.

## Input validation

- Request bodies on `/api/*` are capped at 128 KB
  (`server/middleware/body-limit.ts`). The limit is registered before CSRF,
  rate limiting and auth, so an oversized payload is refused (413) without
  being read, without auth state and without spending rate budget. The two
  import routes get 2 MB, because the middleware runs before any route and a
  route-level limit cannot widen a global one. The cap is a transport bound,
  not a copy of the DTO: zod counts characters, body limits count bytes, and
  UTF-8 uses up to 3 bytes per character.
- zod DTOs in `shared/` validate on both sides of the API; tests pin the
  response shapes so drift fails CI.
- SQLite constraints (foreign keys, UNIQUEs, CHECKs) are the backstop against
  programmer error.

## Passwordless auth

Two ways in, and no third: a passkey ceremony, or an emailed magic link.
There is no password to phish, reuse, guess, reset or leak. No password
reset, password change or email-verification feature is configured.

**The mailbox is the root of trust.** That was already true whenever a
password could be reset by email. Without a password, it is stated openly
instead of hidden behind a second, weaker credential.

- better-auth still mounts `/reset-password` even though email/password is
  disabled. The database must contain no `account` row whose provider is
  `credential` and no `reset-password:*` token in `verification`; otherwise a
  valid old token could recreate a password credential. New databases start
  with neither, and their absence is a production invariant.
- Magic-link tokens are **hashed at rest** (`storeToken: 'hashed'`; the
  plugin default is plain text, which would leave session-minting tokens
  readable in the `verification` table), single-use through an atomic
  consume, and live **5 minutes**. `server/auth-options.node.test.ts` tests
  our storage and lifetime settings; we rely on better-auth to enforce them.
  Successful sign-in, and rejection after our deletion purge, run through
  the real app. These tests do not independently prove hashing, expiry,
  replay protection or atomic token consumption.
- The emailed URL points at the **SPA** (`/auth/magic`), not at
  better-auth's verify endpoint, and the SPA redeems only on a user CLICK.
  Mail scanners and link-prefetchers follow URLs in email; because
  redemption is single-use and has side effects, a scanner that hit the
  endpoint directly would use up the link before the user saw it.
- The token is in the **URL fragment** (`/auth/magic#token=...`). A browser
  does not put the fragment in the request line or the `Referer` header, so
  clicking the link does not write the live token into our server or proxy
  logs. The `Referer` part matters: `Referrer-Policy:
  strict-origin-when-cross-origin` sends the FULL URL on same-origin
  requests, so with `?token=` the landing page would send the token with
  every request it made. A `?token=` link is still accepted for
  compatibility (`src/auth/MagicLinkPage.tsx`).
- **What this does not do:** the token is still in the email. Resend and any
  receiving mail-security gateway see the whole message, and a gateway that
  rewrites URLs sees the fragment too. The fragment removes the token from
  the HTTP request path only. A compromised mailbox is a compromised account;
  that follows from email being the recovery root of trust, and single use
  plus the 5-minute expiry are what limit it.
- The page then **removes the token from the URL** (replace-navigation), so
  it does not stay in the address bar, in history or in a screen share.
- Redemption itself (`GET /api/auth/magic-link/verify?token=...`) still
  carries the token in a query string. That is better-auth's endpoint
  contract and cannot be moved. The risk is low (the token is consumed during
  that request) but not zero: an observer who saw it in flight could try to
  redeem it first. Single use and the 5-minute expiry limit it.
- Responses to a send request are **the same** whether or not the address
  has an account. Redeeming a link for an unknown address CREATES the
  account, so there is no existence signal to leak.
- Requesting a link is rate limited per IP **and per target address** (see
  "Abuse and rate limiting").

An account with zero passkeys is legitimate (someone who only uses email).
The UI strongly prompts for enrollment and says the account is not fully set
up, but it is a PROMPT, never a gate: locking an email-only user out of their
own data to force a credential they may not be able to create would be a
worse failure than the one it prevents.

## Fresh auth (sudo mode)

ADDING or REMOVING a passkey, and DELETING the account, need a **fresh
session** on top of a valid one: the session must have been CREATED within
24 hours (`session.freshAge`). To re-authenticate, the user does a sign-in
ceremony again (a passkey or a magic link), which mints a new session.

What this protects: sessions are 30-day sliding, so a stolen one expires. A
passkey added with a stolen session does not expire; it OUTLIVES the
session and gives permanent, silent access. Registering a credential is the
one path to persistence, and removal needs the same freshness so an attacker
cannot strip the owner's other sign-in methods.

RENAME is deliberately NOT gated. It changes a display label and cannot add,
remove or alter a credential, so a prompt there would add friction with no
threat behind it.

- **The session row IS the proof.** There is no separate re-auth record or
  endpoint. Freshness is a property of the session itself, which cannot be
  forged without doing the ceremony.
- Freshness is measured from `session.created_at` and is **never
  refreshed** by activity, so staying signed in cannot renew it. It is
  per-session: one browser re-authenticating does not make another
  browser's session fresh.
- A deny-by-default `hooks.before` inside better-auth (`server/auth.ts`)
  enforces it on every `/passkey/*` endpoint not in `PASSKEY_UNGATED`. Today
  that gates `generate-register-options`, `verify-registration` and
  `delete-passkey` (403 `SESSION_NOT_FRESH`), and any endpoint a future
  plugin version adds fails closed. The hook keys on the RESOLVED endpoint
  path, so there is no second URL parser to disagree with the router.
  `delete-user` enforces the same window inside better-auth's own route
  (400 `SESSION_EXPIRED`). Two error codes for one rule; the client handles
  both. Tests: `server/passkey-gate.test.ts`.
- Not gated: `update-passkey` (a label), the anonymous passkey SIGN-IN
  ceremony (gating it would make passkey sign-in impossible), and
  `list-user-passkeys` (a read).
- Deleting the account purges the user's `verification` rows, **including
  any pending magic link for that address, in any letter case**. Without
  that, a link requested before the delete would still work afterwards and
  silently recreate the account as a new, empty user. The plugin stores the
  submitted casing and the user row is lowercase, so the purge folds case on
  both sides (`server/repos/users.ts`, proven over HTTP in
  `server/auth-delete-user.test.ts`). It runs twice: before the delete
  (if it fails, the delete is aborted) and again after the user row is gone,
  because better-auth deletes the user in several awaited steps and another
  request can write a link or passkey challenge in between. The second purge
  fails open and logs: the account is already deleted, and anything it
  misses expires within minutes.

  Known gap, accepted: a magic-link request still in flight when the second
  purge runs (better-auth awaits token hashing before it stores the row)
  stores its link afterwards, and redeeming it creates a new, empty account.
  That is the same result as a link requested a moment after the delete,
  which is an ordinary sign-up, and it needs the emailed token. No data comes
  back. Closing it would need a record of deleted addresses checked at
  redemption: a separate behavior change, and a migration if it gets its own
  table. Trigger to revisit: a report of an account reappearing after
  deletion.
- Deleting the account needs the request to name the account
  (`x-grampacker-delete-user-id`, `DELETE_ACCOUNT_USER_HEADER` in
  `shared/auth.ts`). The `beforeDelete` hook refuses with 400
  `DELETE_ACCOUNT_MISMATCH` when the header is missing or is not the
  session's user id. better-auth deletes whoever the cookie belongs to, and
  the cookie can change after the user confirms: re-authenticating with a
  passkey from another account signs that account in (the passkey plugin
  limits the choice to the user's own passkeys only when the user has some),
  and so does a sign-in in another tab. Without the header, the delete would
  remove the other account. The client also offers "Use a passkey" only to
  an account that has one.

WebAuthn user verification is REQUIRED, and enforced rather than requested.
`authenticatorSelection.userVerification: 'required'` is only a hint: the
plugin hardcodes `requireUserVerification: false` at both of its
verification sites and has no option for it, so a response with the UV flag
clear would otherwise be accepted. `server/auth.ts` rejects those in the
`afterVerification` hooks of BOTH ceremonies, which run before the passkey
row is created and before the session is issued. Without a password the
passkey is the whole credential, so an unverified ceremony would mean that
holding the device alone is the account. Direct callback tests in
`server/auth-options.node.test.ts` prove that we accept verified results and
reject unverified ones. They do not prove WebAuthn cryptography or the
plugin's callback transaction timing.

## Supply chain

- `npm ci` everywhere, `ignore-scripts=true` and `save-exact=true` in
  `.npmrc`, exact pins, no core infrastructure on beta or RC releases. We
  never choose a prerelease ourselves: not as a direct dependency, not in
  `overrides`, and not instead of a stable release.
- **Routine updates wait; security fixes skip routine waiting and get
  prompt review.** Neither path makes a release safe or approves a deploy.
  - *Routine:* Dependabot npm version updates wait 7 days on the registry
    (`cooldown` in `.github/dependabot.yml`). That lowers exposure to a newly
    poisoned release, which is often pulled within days; it guarantees
    nothing. `ignore-scripts` stops install scripts only. Package code still
    runs in our build, our tests and production, and green CI shows the code
    works, not that it is harmless.
  - *Dependabot security updates* skip the cooldown and the weekly schedule.
    They need the dependency graph, Dependabot alerts and Dependabot security
    updates all enabled in the repository settings. On 2026-10-14 the owner
    confirmed that vulnerability alerts and automated security fixes were
    enabled and not paused.
  - *Container images get no security updates* from Dependabot (GitHub's
    supported-ecosystems table). The Node base image moves only through
    Dependabot's daily version updates (`.github/dependabot.yml`) and the
    monthly check (`docs/vps-runbook.md`, "Routine maintenance"). Caddy moves
    only through `grampacker-deploy caddy-update`.
  - *Gap:* Dependabot and `npm audit` act only on advisories in GitHub's
    advisory database, and Dependabot raises alerts and security updates only
    from GitHub-reviewed entries. A vulnerability a project publishes on its
    own repository reaches them only after GitHub reviews it, which can take
    days.
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
  - *Hearing about it:* watching someone else's repository for security
    alerts is not a reliable advisory subscription. The owner watches
    Releases on `better-auth/better-auth`, `honojs/hono`,
    `drizzle-team/drizzle-orm` and `caddyserver/caddy`. When last checked
    (2026-10-04), none of the first three named a separate announcement
    channel, and better-auth's and hono's release notes named their
    advisories.
- GitHub Actions are pinned to full commit SHAs. Triggers are
  `pull_request`, `push` to main and `workflow_dispatch`; there is no
  `pull_request_target`, which would run workflows with secrets against fork
  code. Only `image.yml`'s deploy job reads secrets, on a manual dispatch,
  under the limits below. That job runs the one third-party action in the
  repository, `tailscale/github-action`, pinned by commit SHA; its code runs
  on the deploy runner, so updating that pin needs the same review as a
  dependency. The repository is public; its full history was reviewed for
  secrets and data before it was made public. Fork pull requests run with a
  read-only token and no secrets.
- `image.yml` publishes the production image to GHCR on a manual dispatch
  from main, with `packages: write` on its publish job only. Accepted risk:
  a workflow runs the triggering branch's copy of its file, so a branch that
  edited a workflow to ask for `packages: write` (on a dispatch or on its own
  pull request) could push any image to `ghcr.io/joes703/grampacker`, under
  any tag. Nothing on GitHub stops that on this plan. What does is that only
  the owner can push workflow-file changes or dispatch (agent tokens have no
  Workflows permission and only read Actions; `docs/testing-and-ci.md`
  section 10). So a tag proves nothing: deploy only a digest that a
  successful run on main printed.
- The VPS deployment (`deploy/`; see `docs/vps-runbook.md`) runs as root,
  either by hand (the owner, over SSH, through `sudo`; also the recovery
  path) or from `image.yml`'s deploy job. That job runs only when a dispatch
  on main sets `deploy`, and sends only the digest its own publish job
  pushed.
  - Network: the provider firewall blocks public port 22. The job first
    joins the tailnet as an ephemeral node tagged `tag:ci` (a Tailscale
    OAuth client with only the `auth_keys` write scope, held in the
    `production` environment). The tailnet ACL lets that tag reach only the
    VPS on port 22. Tailscale SSH stays off on the VPS, so OpenSSH, and with
    it the forced command below, handles tailnet port 22. Accepted risk:
    whoever holds the OAuth secret can create `tag:ci` nodes, persistent ones
    included (ephemeral is the client's choice), limited by that ACL.
    Recovery is to revoke the client and delete the nodes
    (`docs/vps-runbook.md`, section 6.4). Deploying also needs the separate
    SSH key.
  - SSH: the job logs in as `deploy` and checks a host key pinned in GitHub.
    The key's `authorized_keys` line is `restrict` (no PTY, no forwarding,
    no `~/.ssh/rc`) with a forced command, `deploy/grampacker-deploy-ssh`,
    which accepts only `deploy sha256:<64 hex>` and runs itself through
    `sudo`. The sudo rule allows that one program, which checks the digest
    again as root and runs `grampacker-deploy deploy`. The parser is tested
    by `deploy/test-grampacker-deploy-ssh.sh`, run by hand; sshd's and
    sudo's limits are checked on the VPS as described in
    `docs/vps-runbook.md`, "Deployment files and access". The key is a
    secret of the `production` environment, whose `main` rule refuses it to
    a run on any other branch, even though a manual dispatch runs the chosen
    branch's copy of the workflow file. Accepted risk: whoever holds the key can deploy any digest in
    `ghcr.io/joes703/grampacker`, an older vulnerable image included, and
    nothing on the VPS can tell a main build from one a branch pushed (the
    `image.yml` entry above).
  - Runtime: the script accepts only an exact `sha256:` app image digest,
    never a tag. The app listens on `127.0.0.1` only, as UID/GID 10001, with
    a read-only root filesystem (`deploy/compose.yaml`). Its secrets stay in
    `/srv/grampacker/secrets/app.env`, outside Git.
  - Accepted risk: Caddy is `caddy:2`, which follows every 2.x release,
    because Caddy supports only its newest 2.x (its SECURITY.md); a minor or
    digest pin would stop its security fixes. So an upstream regression or
    compromise reaches production at the next `grampacker-deploy
    caddy-update`. Updates are explicit, never part of an app deploy, run at
    least monthly and promptly after a Caddy security release, and the new
    image must validate the Caddyfile before it replaces the running one.
- A merge changes `main`, not production. A dependency or base-image fix
  reaches the VPS only when an image is published from `main` and deployed:
  within 7 days for a routine update, and as soon as practical for a
  security fix (`docs/vps-runbook.md`, "Routine maintenance").

## Packing, food and public shares

Row caps are application resource policies, not SQLite engine limits: 500
categories and 500 inventory items per account, 100 lists per account, 300
gear rows and 30 packing locations per list, and 200 food items over at most
30 days (90 meal slots). They bound growth, response size and the work each
operation does; the exact values are product choices, not measured
ceilings. SQLite still allows 32,766 parameters per statement; list
duplication splits food-association inserts that could be larger.
Temporary negative ranks avoid unique-index collisions during swaps.
Parent and account cascades skip reranking rows that the same deletion will
remove, which keeps deletion work linear. The unused `_pack_reorder_guard`
and `_food_pack_reorder_guard` tables are always empty and need no cleanup;
the `_*_location_delete_state` tables are used by the location-delete
triggers.

Authenticated routes go through `reposForUser`. The anonymous share route
uses `createPublicSharesRepo` (`server/repos/public-shares.ts`), outside
`reposForUser` because there is no session; every statement gates itself on
the slug and `is_shared`.

- **Packing locations** are children of a list. The failure to guard
  against is cross-parent stitching: a location id from another of the
  caller's OWN lists must 404, not succeed, or the ownership check weakens
  from "this list" to "this user". A composite parent predicate on every
  write enforces it, and all three write verbs have wrong-parent tests
  (`server/routes/packing-locations.test.ts`).

  A status assertion alone proves nothing here. `rename` pre-reads, UPDATEs,
  then reads back through the owned parent, so with the parent predicate
  removed the route still answers 404 while the UPDATE has already
  committed. Only the row assertions catch that.

  One fixture is not enough either. An item-backed location returns
  `item_backed` (409) in the PRE-READ, before the scoped UPDATE. If the
  predicate is lost from the pre-read alone, a name-only target still 404s,
  but an item-backed one answers 409 through the wrong parent: an existence
  oracle that also reveals the kind of location. Both fixtures are tested;
  each catches a mutation the other misses. Item-backed containers add a
  cycle risk (a bag inside itself, or a loop of bags); assignment rejects
  both with zero writes. Cap: 30 locations per list.

- **The food estimate** splits on one line: the ITEMS are part of the pack,
  the PLAN is private. What you carry (`id`, `name`, `unitCount`,
  `weightGrams`, `sortOrder`) goes to the public share, like any gear row.
  When you eat it does not: day count, meal slots, `isPacked`/`isReady` and
  the packing-location fields never leave a session-gated route. "2 x 85 g
  ramen" is a thing in a pack; "Tuesday dinner: leftover curry" is a fact
  about someone's week. Caps: 200 items, 30 days.

  A per-meal item's carried count is `quantity` times the number of meals
  it is in. So the share repo reads `list_food_item_slots` in a second
  statement that selects only `food_item_id`, gated through the same
  shared-list join as every other query there, and counts in JS. No day,
  meal or slot id goes out; a reader can infer only a COUNT, which is the
  number they came for. The response carries `unitCount` and neither
  `quantity` nor `isPerMeal`, because quantity without the mode invites a
  wrong calculation and the mode is a step toward the plan.
  `server/routes/food.test.ts` asserts the exact key set on raw JSON and
  checks those two absences by name. The share sums food rows with the same
  definition the owner view uses.

  The food rows are never JOINED to the slot associations. That is the
  severe trap: a join would send one bag of trail mix five times if it were
  scheduled across five lunches, as duplicate rows and, if anyone adds a sum
  again, as five times its weight. A wire test on the share pins it.

- **The gear/food pack union** lets one bag hold rows from two tables in one
  shared order. Its risk is integrity, not disclosure: a client-supplied id
  in a reorder payload must be proven to belong to this list before it can
  move, and the reorder is one SQLite transaction, so a failure rolls back
  the whole reorder instead of leaving a partial write. Ownership checks are
  owned-set membership in JS: one query whatever the payload size.

  Rank uniqueness is **per table, not across the union**: a gear row and a
  food row may hold the same rank in the same bag, and the reorder planner
  allows for that (`server/repos/pack-reorder.ts`). Such ties render with a
  fixed tiebreak (gear before food). Deleting a packing location reads the
  destination rank and moves its contents inside one immediate transaction
  (`removeInTransaction` in `server/repos/packing-locations.ts`), so no
  other write can land between the read and the moves.

## Deferred - known gaps with triggers

- **Concurrent food edits can silently destroy scheduling.** Trimming the day
  count, replacing an item's schedule, or deleting a food item starts from a
  client snapshot. Another tab can change the same plan between that read and
  the write, and the later full replacement or cascade can erase the other
  tab's work. `FoodView` refetches on window focus, which narrows the window
  but does not close it. The server cannot tell a stale snapshot from a
  fresh one.

  The fix needs a food-plan revision carried by every food mutation. Every
  mutation must bump it; destructive writes must compare the client's
  revision inside the same immediate SQLite transaction and return 409 before
  writing when it is stale. Trigger: a second person using the app, or any
  report of a meal plan losing entries. Until then the damage is limited to
  one list within one account, with concurrent clients.

- **Resend is a single point of failure for recovery.** If it is down,
  anyone without a working passkey cannot sign in. Accepted: the data has
  low sensitivity, the failure is temporary, and nobody loses data. The
  alternative, a backup password, would bring back the credential the app
  is designed not to have. Worst case, a user with no passkey and no working
  mailbox loses access to their own data. Restoring service may mean
  replacing the Resend key or waiting for the provider; there is no password
  fallback.

- **The public share endpoint is not rate limited**
  (`GET /api/shares/v2/:slug`). Trigger for adding a limit: any sign of
  scraping, or a share link posted somewhere public. Until then this is
  accepted for a small app with a 62^6 slug space. `/api/health` is not
  rate limited either; it returns one boolean.

- **A same-list trigger abort on packing-location creation answers 400, not
  500.** The membership precheck runs inside the same immediate transaction
  (`server/repos/packing-locations.ts`), so the trigger firing anyway means
  a server defect, and the repository rule for that case is "let it 500"
  (foreign-key failures there do). The trigger abort is still mapped to
  `invalid_container_item`, a client error. Accepted because the answer is
  wrong only about blame, never about data. Trigger to revisit: this catch
  is ever seen firing in production logs, or the next change to that file.

## Not applicable by construction

Recorded so they are not argued again: SSRF (the only outbound HTTP is
Resend's fixed endpoint; no user-controlled URLs), mixed content (HTTPS only,
plus HSTS), CORS misconfiguration (no CORS at all), local network access,
user activation, and SRI (all executable assets are same-origin and
content-hashed by Vite).
