---
name: verify
description: Drive the running grampacker app in a real browser to verify auth/UI flows end-to-end
---

# Verifying grampacker flows in a real browser

## Launch

- `npm run dev > /tmp/grampacker-dev.log 2>&1 &` - one server for SPA +
  /api/* + local SQLite (port 5173). Capture the log: the dev EmailSender
  prints every auth email to it.
- Local state persists in `.data/grampacker.db`; the dev server applies
  migrations when it starts.

## Drive

- Playwright (chromium headless) against http://localhost:5173. Install
  it in a scratch dir, NOT the repo (keep the dependency out of
  package.json): `npm i playwright && npx playwright install chromium`.
- Auth is PASSWORDLESS (magic link + passkeys; there is no sign-up form,
  no password, no verify-email or reset-password flow). The sign-in page
  has one field, `#email`, and `button[type=submit]`; errors render with
  `role=alert`. Requesting a link for a new address IS sign-up: redeeming
  it creates the account and mints a session.
- Magic links: grep the dev log for `[email:dev] to=<recipient>` blocks;
  the link is the `/auth/magic#token=...` URL in the following lines. Wait
  ~500ms after the UI action before reading. Opening the link does
  nothing by itself - the page verifies only on a click of its button
  (src/auth/MagicLinkPage.tsx), so mail scanners cannot burn the token.
  The token lives in the URL FRAGMENT: pass the whole URL to
  `page.goto`, not just the path.

## Gotchas

- The auth client refetches the session after every auth mutation; the
  route gates in `src/App.tsx` must never unmount children on a pending
  refetch (see the gate comment there - regression looks like form state
  vanishing after a successful submit).
- The rate limiter shares one `local` bucket for all headerless traffic,
  and it is fail-closed across methods: GETs count too unless allowlisted
  (get-session, list-user-passkeys). Long drives with many magic-link
  verifies or passkey-challenge GETs eat the auth buckets (magic-link
  send is 10/10min per IP and 5/hour per address; verify 10/10min).
  Each bucket is its own fixed window (10 min for the IP and verify
  buckets, 1 hour for the per-address one, a day for the global mail
  quota); a 429 carries `Retry-After`. Clean up after 429 probes rather
  than waiting:
  Stop the dev server, then run
  `sqlite3 .data/grampacker.db "delete from rate_limits"`.
  To simulate distinct clients instead, set an `x-forwarded-for` header.
- Passkey enrollment and deletion need a FRESH session (created within
  24h): an aged session answers 403 SESSION_NOT_FRESH, and the fix is
  to sign in again, which mints a new one.

## Gear page (/gear)

- Item dialog fields have stable ids: `#gi-name`, `#gi-desc`, `#gi-weight`,
  `#gi-cat`, `#gi-status`; submit is `dialog[open] button[type=submit]`
  (disabled while the name is empty).
- Row kebab trigger: `[aria-label="Item actions"]`; category kebab:
  `[aria-label="Category actions"]`. Menu rows are plain `button`s
  (src/components/RowMenuItem.tsx); the quick-status rows are buttons with
  `aria-pressed` marking the current status (GearStatusMenuItems.tsx).
- Always suffix menu selectors with `:visible` - the closed
  MobileOptionsModal keeps a hidden copy of the menu content in the DOM,
  so `button:has-text(...)` can match two elements.
- Status badges are compact (icon-only): assert
  `[aria-label="Needs repair"]` etc., NOT `text=`.
- Select-mode row toggles: `[aria-label="Select <ItemName>"]`. The bulk
  move dialog is a `<select>` + a Move button, not per-category buttons.
- DnD: rows reorder headlessly via KEYBOARD (focus the row's
  `[aria-label="Reorder <ItemName>"]` grip, Space / ArrowDown / Space).
  Category grips carry the same sortable attributes. If a keyboard drag
  does not take, drive it with the mouse: mouse.down on the grip, move
  ~25px to beat the activation constraint, glide to the target, mouse.up.
- After any write, hard `page.reload()` and re-assert - optimistic UI
  masks server rejections: the rollback flashes past in milliseconds.

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

Register from Settings (the header cog, `[aria-label="Settings"]`, opens
the Settings modal; the Passkeys section is in it - a fresh session is
required), sign out, then 'Sign in with a passkey' completes without any
prompt. Dev rpID is localhost (derived
from BETTER_AUTH_URL). With no credential on the authenticator the
sign-in fails fast with the canceled-error copy - useful as a probe.
