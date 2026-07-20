# Decisions (from ADRs)

Extracted from 1 ADR: docs/passwordless-auth-design.md (Status: ACCEPTED,
shipped to production 2026-07-12; header corrected 2026-07-19). The
classification marks the ADR locked, so every decision below is LOCKED: it
cannot be auto-overridden by any lower-precedence source in a future ingest.

---

## Passkey-primary, magic-link-recovery authentication; passwords removed

- source: docs/passwordless-auth-design.md
- status: LOCKED (shipped; teardown = migration 0006, no rollback path)
- decision: grampacker uses passkey-primary auth with magic link as the only
  recovery path. Passwords cease to be a stored credential and a user-facing
  auth method. Both halves are required: the `emailAndPassword` config block
  is removed AND every credential row is deleted (removing config alone
  leaves `POST /reset-password` able to resurrect a credential account from
  a still-valid token; those tokens were purged in the same migration).
- supersedes: REWRITE_PLAN.md decision 13.3 ("no magic links")
- scope: authentication

## No email OTP

- source: docs/passwordless-auth-design.md
- status: LOCKED (shipped)
- decision: email OTP is an explicit non-goal; a 6-digit code is strictly
  more user work than clicking a link.
- scope: authentication

## Onboarding is magic-link-first, then passkey enrollment

- source: docs/passwordless-auth-design.md
- status: LOCKED (shipped)
- decision: better-auth cannot do passkey-first signup cleanly (verify-
  registration never creates a user or mints a session), so the magic link
  proves the email and the app enrolls a passkey into the resulting session.
  `registration.requireSession` stays true (default) - it is what upholds the
  invariant "a passkey implies a proven email". "Account not fully set up"
  is DERIVED state (`passkeyCount === 0` on `GET /api/me`), never a server
  flag, and deliberately NOT a hard API gate (a gate would lock out exactly
  the user the recovery path exists for).
- scope: authentication, onboarding

## Fresh auth is session age; the fresh_auth table and /api/me/reauth are deleted

- source: docs/passwordless-auth-design.md
- status: LOCKED (shipped; fresh_auth dropped in migration 0006)
- decision: freshness = better-auth's `session.freshAge` (session `createdAt`
  within the window). Re-auth = run a sign-in ceremony again (passkey or
  magic link), which mints a new session that is fresh by definition. No
  proof table, no reauth endpoint. Minting a new session does not revoke the
  old one, and that is safe because freshness is evaluated per-session: a
  stolen old cookie stays stale forever.
- scope: session freshness, fresh-auth gate

## freshAge = 24 hours, set explicitly

- source: docs/passwordless-auth-design.md (decision 8.2)
- status: LOCKED (shipped)
- decision: 24h (better-auth's default) chosen over the section-3 1-hour
  proposal; the common theft case (an old long-lived cookie) is stale either
  way. Set explicitly in config so the number is auditable and an upstream
  default change cannot silently move it.
- scope: session freshness

## Fresh-gated set = "changing which credentials can sign in"; rename is NOT gated

- source: docs/passwordless-auth-design.md (decision 8.1; PR #45 precedent
  merged first per 8.5)
- status: LOCKED (shipped)
- decision: fresh session required on passkey generate-register-options,
  verify-registration, delete-passkey, and delete-user. Passkey rename
  (`update-passkey`) writes only the `name` column and stays ungated; the
  sign-in ceremony endpoints are anonymous; list is session-only. The rule
  is a threat model ("changing which credentials can sign in requires fresh
  auth"), not "all mutations".
- scope: fresh-auth gate, passkeys

## The magic link is the hardened root of trust

- source: docs/passwordless-auth-design.md (section 4.1)
- status: LOCKED (shipped)
- decision: whoever controls the mailbox controls the account - explicit
  design, so the link is hardened: `storeToken: 'hashed'` (never plaintext
  at rest), `expiresIn: 300` (5 min), single-use via atomic consume,
  unguessable 32-char token, no account enumeration (`{status: true}`
  regardless). The email carries OUR frontend URL
  (`/auth/magic#token=`) that verifies only on a user gesture - never the
  plugin's side-effecting GET - so mail scanners cannot burn the single-use
  token. The token rides in the URL FRAGMENT (never query string) so it
  never enters request lines, logs, or Referer; the page scrubs it on mount.
- scope: magic links, security

## Magic-link rate limiting: three buckets, charge order IP -> email -> global

- source: docs/passwordless-auth-design.md (section 4.2)
- status: LOCKED (shipped; budgets retuned 2026-07-11)
- decision: better-auth's limiter is disabled and its plugin's rule NEVER
  fires; our Hono middleware is the only limiter. Magic-link send charges
  three buckets - global 90/day (guards the global Resend quota; the one
  number to raise on a quota change), per-IP 10/10min, per-address 5/hour -
  because no single key stops all three abuses. Charge order IP -> email ->
  global is load-bearing: the global count tracks VALIDATED send attempts,
  charged in sendMagicLink just before email.send - a provider failure
  still spends the charge (server/middleware/rate-limit.ts). The
  email key is the LOWERCASED, UNTRIMMED address, HMAC'd with
  BETTER_AUTH_SECRET (matches the identity better-auth resolves; keeps
  rate_limits from becoming an address list). `GET /magic-link/verify`
  creates a user and mints a session and must never be treated as a
  read-only GET.
- scope: rate limiting, magic links

## Destructive teardown ships separately, after the cutover; irreversible

- source: docs/passwordless-auth-design.md (sections 5, 7)
- status: LOCKED (shipped as migration 0006_passwordless-teardown)
- decision: three-PR rollout (design docs / atomic server+client cutover /
  destructive migration alone). CI applies migrations BEFORE deploying, so
  the destructive SQL (delete credential rows, purge reset-password tokens,
  drop fresh_auth) may only land after the passwordless Worker is live and
  no longer reads those rows; the between-deploys production smoke test is
  a human-verified checkpoint, and it was met, not assumed. The
  `account.password` COLUMN stays (better-auth base model); only rows go.
  The test-helper choke point (`server/test/auth-helpers.ts`) was rewritten
  to drive the real magic-link flow through a capturing EmailSender before
  anything was deleted.
- scope: rollout, data migration

## Resend free tier as the whole recovery path: accepted risk

- source: docs/passwordless-auth-design.md (decision 8.3)
- status: LOCKED (shipped; recorded in SECURITY.md)
- decision: with no password, a user with no working passkey and a dead
  Resend has no way in. Accepted (single user, own data, passkeys synced by
  a password manager); the mail provider is a real availability dependency.
- scope: authentication, operations

## Lockout worst case accepted: passkeys + mailbox both lost = unrecoverable

- source: docs/passwordless-auth-design.md (decision 8.4)
- status: LOCKED (shipped)
- decision: the recovery chain is passkey -> magic link -> mailbox; lose
  every passkey AND the mailbox and the account is unrecoverable (no support
  channel). Written down as a decision, not a surprise.
- scope: authentication

## WebAuthn user verification enforced by our hooks, not trusted to the plugin

- source: docs/passwordless-auth-design.md (sections 4.3, 4.4)
- status: LOCKED (shipped)
- decision: the passkey plugin hardcodes `requireUserVerification: false`,
  so the `afterVerification` hooks in `server/auth.ts` do the real
  enforcement (a passkey means "this human, on this device"). Passkey
  sign-in ignoring `emailVerified` is safe only by the construction
  "session requires magic link requires verified email" - which is why
  `registration.requireSession` must not be flipped to false.
- scope: passkeys, security
