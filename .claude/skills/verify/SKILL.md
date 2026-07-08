---
name: verify
description: Drive the running grampacker app in a real browser to verify auth/UI flows end-to-end
---

# Verifying grampacker flows in a real browser

## Launch

- `npm run dev > /tmp/grampacker-dev.log 2>&1 &` - one server for SPA +
  /api/* + local D1 (port 5173). Capture the log: the dev EmailSender
  prints every auth email to it.
- Local D1 state persists in `.wrangler/`. Migrations:
  `npx wrangler d1 migrations apply grampacker --local`.

## Drive

- Playwright (chromium headless) against http://localhost:5173. Install
  it in a scratch dir, NOT the repo (keep the dependency out of
  package.json): `npm i playwright && npx playwright install chromium`.
- Email-link flows (verify-email, reset-password): grep the dev log for
  `[email:dev] to=<recipient>` blocks; the link is the URL in the
  following line. Wait ~500ms after the UI action before reading.
- Form fields have stable ids: `#name`, `#email`, `#password`; submit is
  `button[type=submit]`; errors render with `role=alert`.

## Gotchas

- The auth client refetches the session after every auth mutation; the
  route gates in `src/App.tsx` must never unmount children on a pending
  refetch (see the gate comment there - regression looks like form state
  vanishing after a successful submit).
- The rate limiter shares one `local` bucket for all headerless traffic,
  and it is fail-closed across methods: GETs count too unless allowlisted
  (get-session, list-user-passkeys). Long drives with many verify-email
  or passkey-challenge GETs eat the default 30/10min auth bucket.
  Driving 429 probes locks sign-in for 10 minutes; clean up after:
  `npx wrangler d1 execute grampacker --local --command "delete from rate_limits"`.
  To simulate distinct clients instead, set a `cf-connecting-ip` header.
- Sign-up creates NO session while the account is unverified; the
  verification link signs in and redirects (callbackURL /sign-in ->
  RedirectIfSession -> home).

## Production-mode preview (CSP)

Dev drops the CSP (Vite HMR needs inline scripts), so CSP must be
verified against the BUILT app: hide .dev.vars, `npm run build`, then
`npx vite preview --port 4173`. GOTCHA: the cloudflare vite plugin
copies .dev.vars into dist/grampacker/.dev.vars AT BUILD TIME and
preview loads it, overriding wrangler.jsonc vars - a build made while
.dev.vars exists previews in dev mode no matter what. Hide the file
BEFORE building. Auth writes fail under preview (origin mismatch with
the prod BETTER_AUTH_URL - expected); shell render + zero console CSP
violations is the check. Restore .dev.vars after.

## Passkeys

Playwright can drive the full WebAuthn ceremony headlessly via a CDP
virtual authenticator:

```js
const cdp = await page.context().newCDPSession(page)
await cdp.send('WebAuthn.enable')
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2', transport: 'internal',
    hasResidentKey: true, hasUserVerification: true,
    isUserVerified: true, automaticPresenceSimulation: true,
  },
})
```

Register from the home Passkeys section, sign out, then 'Sign in with a
passkey' completes without any prompt. Dev rpID is localhost (derived
from BETTER_AUTH_URL). With no credential on the authenticator the
sign-in fails fast with the cancelled-error copy - useful as a probe.
