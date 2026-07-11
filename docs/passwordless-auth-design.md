# Passwordless auth: design

Status: PROPOSED (not yet implemented)
Date: 2026-07-11
Supersedes: REWRITE_PLAN.md decision 13.3 ("no magic links")

grampacker moves from email+password to **passkey-primary, magic-link-recoverable**
authentication. Passwords stop being a stored credential and stop being a
user-facing auth method.

Every claim about better-auth below was verified against the **installed** source
(`better-auth@1.6.23`, `@better-auth/passkey@1.6.23`), not from documentation or
memory. File refs point into `node_modules/`.

---

## 1. Why, and what changes

Today: `emailAndPassword.enabled: true`, passkeys are an optional add-on, and
"fresh auth" means "re-type your password". The password is the root credential:
it can be reset by email, so email is *already* the root of trust. The password
is a second thing to phish, store, hash, rotate, and rate-limit, and it buys no
security that control of the mailbox does not already confer.

After: the mailbox proves identity once (magic link), a passkey becomes the
day-to-day credential, and the password ceases to exist.

Non-goal: **email OTP.** A 6-digit code is strictly more user work than clicking
a link and is not adopted here.

---

## 2. Target model

| Flow | Mechanism |
| --- | --- |
| Sign up | `POST /api/auth/sign-in/magic-link` -> email -> SPA page `/auth/magic?token=` -> user gesture -> verify -> user created, `emailVerified: true`, session minted (see 4.1 for why the email does not link straight at the API) |
| Sign in (primary) | Passkey (`/api/auth/passkey/verify-authentication`) |
| Sign in (recovery) | Magic link (same endpoint pair as sign up) |
| Add a device | Sign in by magic link on the new device, then enroll a passkey there |
| Fresh auth ("sudo") | A recent **session**, per better-auth's native `freshAge` |
| Account deletion | Fresh session, no password |

There is one sign-in surface. `POST /sign-in/magic-link` creates the user when
none exists, so "sign up" and "sign in" are the same request; the UI does not
need two pages. (`plugins/magic-link/index.mjs:128-137`.)

### Onboarding: email first, then passkey

better-auth **cannot** do passkey-first signup cleanly. `verify-registration`
only inserts a `passkey` row - it never calls `createUser` and never mints a
session (`@better-auth/passkey/dist/index.mjs:380-384`). Registering without a
session requires `registration.requireSession: false` plus a
`registration.resolveUser()` that invents a user out of an unauthenticated
request, and the user is *still signed out afterwards*. That is a worse flow and
a bigger attack surface (anonymous user creation).

So: **magic link proves the email, then the app enrolls a passkey into the
resulting session.** This is also what makes the whole model safe - see 4.1.

### "Not fully set up until a passkey exists"

Represented as **derived state, not a server flag**: the account is
"incomplete" iff `passkey` row count is 0. No column to drift out of sync, no
migration, and it self-heals if the user deletes their last passkey.

`GET /api/me` gains `passkeyCount: number`. The SPA shows a persistent,
non-dismissible setup prompt while it is 0.

It is deliberately **not** a hard server gate on the rest of the API. A user
whose only passkey was on a lost phone must still be able to sign in by magic
link and reach Settings to enroll a new one. Gating the app on passkey count
would lock out exactly the person the recovery path exists for.

---

## 3. Fresh auth, rebuilt

**The `fresh_auth` table and `POST /api/me/reauth` are deleted.**

They are password machinery end to end: `isFresh()` inner-joins `account` on
`providerId = 'credential'` and compares `granted_at >= account.updated_at`
(`server/repos/fresh-auth.ts:74-86`). With no credential row that join matches
nothing, so the gate would fail **closed** and lock every user out of managing
their own passkeys.

The replacement is better-auth's own concept, which I did not know existed when
I built the table:

- `session.freshAge` (default 24h) marks a session fresh iff
  `Date.now() - session.createdAt < freshAge`
  (`context/create-context.mjs:148`, `api/routes/session.mjs:361-364`).
- `POST /delete-user` already enforces it natively **when no password is sent**
  (`api/routes/update-user.mjs:304-307`).
- The passkey plugin already mounts `freshSessionMiddleware` on
  `generate-register-options` and `verify-registration` whenever
  `registration.requireSession` is true, which is the default
  (`@better-auth/passkey/dist/index.mjs:58,308`).

In a passwordless world "re-authenticate" means **run a ceremony again**, and
every ceremony mints a *new* session - which is fresh by definition. So
freshness needs no new storage:

- Re-auth by passkey: `authClient.signIn.passkey()` -> new session -> fresh.
- Re-auth by magic link: `magic-link/verify` -> new session -> fresh.

Confirmed against source, including the part that could have been a hole:
minting a new session does **not** revoke the old one - `createSession` issues a
new token and `setSessionCookie` only overwrites the response cookie
(`db/internal-adapter.mjs:162`, `cookies/index.mjs:123`). The old session row
stays valid until it expires. That is fine *precisely because* freshness is
evaluated per-session against that session's own `createdAt`
(`api/routes/session.mjs:361`): a stolen old cookie stays stale forever and
cannot ride on someone else's re-auth. Re-authenticating in one tab does not
hand a sensitive-action window to a thief holding a cookie from another.

Proposed `session.freshAge = 60 * 60` (1 hour), down from the 24h default.

Bounded blast radius: a stolen session cookie can only perform a sensitive
action if it was stolen within an hour of sign-in. Sessions are 30-day sliding,
so an attacker who lifts a cookie from a long-lived session gets a *stale*
session and cannot add a passkey, remove one, or delete the account. Cost to a
legitimate user: one biometric tap if they manage credentials more than an hour
after signing in.

### What is gated

| Endpoint | Gate | Enforced by |
| --- | --- | --- |
| `passkey/generate-register-options` | fresh session | plugin (`requireSession: true`) |
| `passkey/verify-registration` | fresh session | plugin |
| `passkey/delete-passkey` | fresh session | **ours** (`requireFreshAuth`) |
| `delete-user` | fresh session | better-auth core |
| `passkey/update-passkey` (rename) | session only | - |
| `passkey/generate-authenticate-options`, `verify-authentication` | anonymous | - |
| `passkey/list-user-passkeys` | session only | - |

`requireFreshAuth` shrinks to a session-age check with no DB read of its own.
`delete-passkey` is the only endpoint we must gate ourselves; the plugin does not.

**Rename stays ungated** (PR #45). A rename writes only the `name` column -
verified: `update-passkey` validates `{ id, name }` and updates nothing else
(`@better-auth/passkey/dist/index.mjs:591,617`). It cannot change which
credentials sign in, so a gate there is friction with no threat behind it.
"All mutations require fresh auth" is a tidier sentence, not a better threat
model. **This is a live decision - see 8.1.**

### Two different failure codes

better-auth reports staleness two ways and the client must handle both:
- `freshSessionMiddleware` -> **403** `SESSION_NOT_FRESH` (`api/routes/session.mjs:364`)
- `delete-user` inline check -> **400** `SESSION_EXPIRED` (`api/routes/update-user.mjs:307`)

---

## 4. Security model

### 4.1 The magic link is now the root of trust

This is the central risk of the change and must be stated plainly: **whoever
controls the mailbox controls the account.** That was already true (password
reset went to email), but it is now the *explicit* design rather than a side
door, so the link itself must be hardened.

- **`storeToken: 'hashed'`.** The plugin default is `'plain'`
  (`plugins/magic-link/index.mjs:27`) - it writes the emailed token into the
  `verification` table in cleartext. Since that token mints a session for any
  account, a leaked DB read (or backup) would be a total compromise. Hashing
  means the DB copy is useless to an attacker.
- **Short-lived.** `expiresIn: 300` (5 min, the default).
- **Single-use, atomically.** `consumeVerificationValue` reads and deletes under
  a consume lock, so one token mints at most one session
  (`db/internal-adapter.mjs:677-720`). Verified, not assumed.
- **Unguessable.** 32 chars of `[a-zA-Z]` (`generateRandomString`).
- **No enumeration.** `POST /sign-in/magic-link` always returns `{status: true}`
  whether or not the address has an account.

#### We email OUR url, not the plugin's

The plugin's `url` points straight at `GET /api/auth/magic-link/verify`, which
is **side-effecting**: it consumes the token, creates the user, and mints a
session (`plugins/magic-link/index.mjs:84,123,129`). Corporate mail scanners and
mail-client link previews follow links in email. One of them will burn the
single-use token before the human ever clicks, and the user - who is by
definition already locked out, since this is the recovery path - gets "invalid
link", retries, and eats the send budget until it too is exhausted.

So `sendMagicLink` ignores the supplied `url` and emails
`${baseURL}/auth/magic?token=<token>` instead: a **frontend** page that does
nothing on load and calls `magicLink.verify` only on a real user gesture ("Sign
in to grampacker"). A scanner fetching that page consumes nothing.

This is not defense-in-depth garnish. Without it, the recovery path is
unreliable for exactly the users who most need it (anyone behind a corporate
mail gateway).

### 4.2 Rate limiting (the part that must not be got wrong)

better-auth's rate limiter is **disabled** in this repo
(`server/auth.ts:127-134`) because our Hono middleware owns it. The magic-link
plugin ships its own limit rule - and it will **never fire**
(`api/rate-limiter/index.mjs:333`). Anyone reading the plugin source would
reasonably assume they are covered. We are not. The limits must be added to
`server/middleware/rate-limit.ts` by hand.

THREE distinct abuses, and no single key stops all three. All three buckets are
charged on every send; any one can 429. (Retuned 2026-07-11 after shipping - see
"charge order" below.)

| Abuse | Key | Budget |
| --- | --- | --- |
| Attacker drains the mail quota (it is GLOBAL) | **nothing - one shared bucket** | 90 / day |
| Attacker sprays links at many addresses from one host | **IP** | 10 / 10 min |
| Attacker floods a victim's inbox / farms tokens for one account | **email** | 5 / hour per address |
| Token guessing on verify | IP | 10 / 10 min |

The **global** bucket is the only one that guards the provider's quota, because
the quota is itself global (Resend free tier: 100/day). A per-IP cap cannot do
this job - at N/day per IP, a handful of IPs still drains the provider - which is
why the original "20/day per IP" rule was replaced: it was a quota guard that did
not guard the quota, and its 24-hour window was also the likeliest way for a
legitimate user to lock themselves out for a day. It is the one number tied to
the provider; raise it when the quota rises (e.g. moving to SES).

The per-**email** bucket is the one that cannot be IP-keyed: an attacker rotating
IPs looks like a first-time caller on every request. It is an anti-abuse control,
not a quota control, and should not be relaxed for convenience.

**Charge order is IP -> email -> global, and it is load-bearing.** A request the
narrower caps already refused never reaches the shared quota, so a flood cannot
spend mail budget it was never going to use: the global count tracks mail actually
SENT, not attempts made. Reverse the order and a single host could 429 the entire
app's recovery path for a day.

**Accepted trade-off:** a drained global bucket means nobody can recover an
account until the window rolls. This is no worse than the provider's quota running
out (identical effect), but it fails earlier and on purpose, and the two narrower
caps in front of it are what make draining it expensive.

The email key must be **normalized then HMAC'd**, and each half matters:

- **Lowercase, but do NOT trim.** better-auth lowercases on create and lookup
  (`db/internal-adapter.mjs:78,473`), so `Victim@x.com` and `victim@x.com` are the
  same account - keying the raw input would let an attacker walk around the
  victim's bucket by varying case. But it validates with `z.email()` and does NOT
  trim, so `"victim@x.com "` is rejected and no mail is sent: trimming would fold
  that rejected string onto the victim's real bucket and let an attacker burn the
  victim's recovery budget without sending a single email. Match the identity
  better-auth actually resolves - no more, no less.
- **HMAC, not a bare hash**, with `BETTER_AUTH_SECRET` as the pepper. `rate_limits`
  would otherwise become a list of every address that ever requested a link, and
  a plain SHA-256 of an email address is trivially dictionary-reversible - it is
  not a secret, it is a lookup key.

The old `EMAIL_SEND` rule was **5/day**, sized for verification mail. Magic links
make email the primary recovery path, so 5/day would lock out a legitimate user
having a bad day. The budgets above raise it deliberately, and the mail provider
becomes a real availability dependency - noted as accepted risk.

`GET /api/auth/magic-link/verify` is a **GET that creates a user and a session**.
It must never enter `READ_ONLY_GET_PATHS`. (This is the trap AGENTS.md already
warns about for the passkey challenge endpoint.)

### 4.3 WebAuthn user verification

Unchanged, and still enforced by hooks rather than trusted to the plugin: it
hardcodes `requireUserVerification: false` at both verify sites, so
`authenticatorSelection.userVerification: 'required'` is only a client hint. The
`registration.afterVerification` / `authentication.afterVerification` hooks in
`server/auth.ts` do the real enforcement. This is why a passkey means "this
human, on this device", not merely "this device".

### 4.4 Passkey sign-in ignores `emailVerified`

`verify-authentication` never reads `user.emailVerified`
(`@better-auth/passkey/dist/index.mjs:393-478`). This is safe **only because**
the sole route to owning a passkey is an authenticated session, and the sole
route to a session is a magic link, which sets `emailVerified: true`. The
invariant "a passkey implies a proven email" holds by construction - and it is
exactly what `registration.requireSession: false` would break. We keep the
default (`true`).

---

## 5. Deleting the passwords

`emailAndPassword` is removed from `authOptions` entirely.

Removing it is **not sufficient on its own**, and this is the sharpest edge in
the whole migration:

- `POST /reset-password` is **not gated on `emailAndPassword.enabled`** and, given
  a valid token, will **re-create a credential account for a user who has none**
  (`api/routes/password.mjs:152-158`). Left half-configured, the app would keep
  minting reset tokens and silently resurrect password login.
- Dropping `sendResetPassword` is what actually closes it:
  `/request-password-reset` then 400s with `RESET_PASSWORD_DISABLED`
  (`api/routes/password.mjs:42-48`).
- `/change-password` and `/set-password` are likewise **not** gated on `enabled`;
  they only require a credential row to exist. Deleting the rows closes them.

So the password dies only if **both** the config block goes *and* the credential
rows go.

### Data migration (production-impacting, and it ships SEPARATELY)

```sql
DELETE FROM account WHERE provider_id = 'credential';
DELETE FROM verification WHERE identifier LIKE 'reset-password:%';
DROP TABLE fresh_auth;
```

The **middle statement is not optional.** Dropping `sendResetPassword` stops new
reset tokens being *issued*, but `POST /reset-password` is mounted
unconditionally (`api/index.mjs:120`), is not gated on
`emailAndPassword.enabled`, and given a still-valid token will **re-create a
credential account for a user who has none** (`api/routes/password.mjs:147-158`).
Any reset token minted before the cutover therefore remains a live path to
resurrect a password. Purging them is what actually closes it.

The deletion itself is safe on the installed source: nothing in core reads
`account` during session creation, `getSession`, `changeEmail`, or `updateUser`.
The only readers are the password flows being removed, and they degrade to
explicit 400s, not crashes. The passkey plugin never touches `account`. There is
no FK from `session` or `user` to `account`.

**Why it ships in its own PR: CI applies migrations BEFORE deploying the new
Worker** (`.github/workflows/deploy.yml:57-63`). Bundling this with the code
change opens a window in which the **old** Worker runs against the **new**
schema - it would still route `/api/me/reauth` and the passkey gate through code
that queries the now-dropped `fresh_auth` table, and 500. The workflow's own
comment says a destructive migration needs its own ordering plan; it was right
and I did not have one.

So the destructive SQL lands only **after** the passwordless Worker is live and
provably no longer reads those rows. Each deploy is then safe in either order.

**This is irreversible.** Every existing password hash is destroyed. Before
merging it, the live account must be able to get in without one: a working
passkey, or a working magic link. Resend is configured in production, so magic
link is the safety net even if every passkey is lost. That safety net gets
smoke-tested on production between the two deploys, not assumed.

The `account.password` **column** stays - it is part of better-auth's base model
and the CLI will keep emitting it. Only the rows go. Documented rather than
fought.

Also noted, because it will look like a bug later: magic-link verification
*already* deletes credential accounts for any user whose email was never
verified, and revokes their sessions
(`db/revoke-unproven-account-access.mjs:15-21`).

---

## 6. What is removed

Server: the `emailAndPassword` block, `emailVerification` (sign-up is gone, so
`sendOnSignUp` has nothing to fire on), `POST /api/me/reauth`
(`server/middleware/reauth.ts`), `server/repos/fresh-auth.ts`, the `fresh_auth`
table, the `delete-user` PASSWORD_REQUIRED gate and the change-password purge
hook in `server/index.ts`, and the `CHANGE_PASSWORD` / `REAUTH` rate-limit rules.

Shared: `shared/auth.ts` (exists only for `MIN_PASSWORD_LENGTH`),
`reauthRequestSchema` in `shared/me.ts`.

Client: `ForgotPasswordPage`, `ResetPasswordPage`, `ChangePasswordForm`, the
password fields in `SignInPage` / `SignUpPage` / `DeleteAccountSection`, the
reauth password prompt in `PasskeySection`, and the `/forgot-password` +
`/reset-password` routes.

Tests: `password-min-length.test.tsx`, `ChangePasswordForm.test.tsx`,
`auth-reset-sessions.test.ts`, the password arms of `reauth.test.ts`,
`fresh-auth.test.ts`, `rate-limit.test.ts`, `auth-delete-user.test.ts`,
`DeleteAccountSection.test.tsx`.

Docs: `AGENTS.md`'s `MIN_PASSWORD_LENGTH` trap, the SECURITY.md fresh-auth
section, the authz-matrix reauth row, and REWRITE_PLAN decision 13.3.

### The test-helper choke point

`server/test/auth-helpers.ts` mints every session in the repo by driving the real
`/sign-up/email` + `/sign-in/email` endpoints with a `TEST_PASSWORD`. **Every**
server test depends on it, including ~80 that have nothing to do with auth
(gear, lists, shares, categories). It must be rewritten to mint sessions the
passwordless way **before** anything else is deleted, or the entire suite goes
red at once and stops being a safety net exactly when it is needed.

It will drive the real magic-link flow (send -> capture the emailed URL through
a test `EmailSender` -> verify -> cookie), so the tests keep exercising the
production path rather than seeding session rows behind auth's back.

That capture point **does not exist yet**: `createEmailSender` picks Resend or
the console logger off `Env` and nothing more (`server/email/index.ts:20`), and
the console sender only logs (`server/email/console.ts:4`). The cutover adds a
capturing `EmailSender` for tests. Without it the helper would drift back toward
seeding `verification` rows by hand - which would mean the auth tests no longer
test auth.

---

## 7. Rollout

Merging to `main` deploys, and CI applies migrations **before** the new Worker
goes live. Two constraints fall out of that, and they pull in opposite
directions:

- Server and client must ship **together**. A server that has dropped
  `emailAndPassword` while the client still posts to `/sign-in/email` is a
  broken production.
- The destructive SQL must ship **apart**, and afterwards - see 5.

Hence three PRs:

1. **This design.** Docs only, no behavior change. Codex read-only review (done -
   its findings are folded in above).
2. **The cutover.** Server + client + tests, in one atomic deploy. Adds magic
   link, removes password config and UI, rebuilds fresh auth on `freshAge`,
   rewrites the test helper. **No destructive migration.** After this deploy the
   `fresh_auth` table and the credential rows still exist - they are simply dead:
   nothing reads them. Passwords are unusable (`/sign-in/email` 400s) but not yet
   erased.
   *Between 2 and 3, smoke-test magic-link sign-in and passkey enrollment on
   production.* That is the point of no return, and it is deliberately a
   human-verified checkpoint rather than a CI gate.
3. **The teardown.** The destructive migration alone: delete credential rows,
   purge reset tokens, drop `fresh_auth`. Plus the doc/grep cleanup sweep.

A residual window exists inside step 2: reset tokens minted before the cutover
stay valid for up to an hour, and `/reset-password` would honor one and
re-create a credential account. It cannot be used to sign in (`/sign-in/email`
is already 400ing by then), and step 3 purges the tokens. Called out rather than
hidden; if it matters, step 3 can follow step 2 within the hour.

---

## 8. Decisions (settled 2026-07-11)

### 8.1 Rename is NOT gated

The brief proposed "all passkey mutations require fresh auth, for audit
simplicity". Rejected, for the same reason it was rejected in PR #45: a rename
writes only the `name` column (verified in plugin source) and cannot change which
credentials sign in. A gate there is friction with no threat behind it. The rule
is "**changing which credentials can sign in** requires fresh auth", which is a
threat model rather than a slogan.

### 8.2 `freshAge` = 24 hours (better-auth's default)

Chosen over 1 hour. The friction of re-tapping is real and constant; the attack
it prevents requires an attacker to steal a session cookie *and* use it within
the window. Sessions are 30-day sliding, so the common theft case (an old,
long-lived cookie) is stale on arrival either way - 24h vs 1h only changes the
exposure for a cookie stolen in the first day.

Set explicitly in config rather than left to default, so the number is auditable
and an upstream default change cannot silently move it.

### 8.3 Resend free tier: accepted risk

With no password, a user with no working passkey and a dead Resend has no way in.
Free tier is 100 emails/day and it is now the *whole* recovery path, not a
convenience. Accepted (single user, own data, passkeys synced by a password
manager). Recorded in SECURITY.md as an accepted risk, not left implicit.

### 8.4 Lockout: the honest worst case

Passwordless removes a credential; it does not remove the need to get back in.
The recovery chain is **passkey -> magic link -> mailbox**. Lose every passkey AND
the mailbox and the account is unrecoverable - there is no support channel. With
a password, a memorized secret was a third leg of that stool.

Acceptable here, and written down so it is a decision rather than a surprise.

### 8.5 PR #45 merged first

Merged and deployed ahead of this work rather than folded in, so the rename
decision is already law in `main` before the fresh-auth machinery is rebuilt on
top of it.
