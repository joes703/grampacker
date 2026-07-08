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
- The rate limiter shares one `local` bucket for all headerless traffic.
  Driving 429 probes locks sign-in for 10 minutes; clean up after:
  `npx wrangler d1 execute grampacker --local --command "delete from rate_limits"`.
  To simulate distinct clients instead, set a `cf-connecting-ip` header.
- Sign-up creates NO session while the account is unverified; the
  verification link signs in and redirects (callbackURL /sign-in ->
  RedirectIfSession -> home).
