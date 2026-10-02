// The SPA route a magic-link email points at. Shared because BOTH sides must
// agree on it and neither owns it: the server builds the emailed URL from it
// (server/auth.ts sendMagicLink), and the SPA mounts its route on it
// (src/App.tsx). A drift between the two is a dead link in someone's inbox, and
// nothing in a type check or a unit test would catch it - so it is one constant.
//
// The email deliberately does NOT link at better-auth's own
// /api/auth/magic-link/verify: that endpoint is a side-effecting GET which
// consumes the single-use token and mints a session, so a mail scanner
// following the link would burn it before the human clicked. This page verifies
// only on a real user gesture.
export const MAGIC_LINK_PATH = '/auth/magic'

// "Sudo mode" window. A session is FRESH for this long after it was CREATED,
// and sensitive actions (enroll a passkey, delete a passkey, delete the
// account) require a fresh one. Re-authenticating means running a sign-in
// ceremony again, which mints a new session.
//
// Single source of truth, and it has to be: better-auth enforces it natively
// on delete-user and on passkey registration, and the deny-by-default
// passkey gate (hooks.before in server/auth.ts) reads the SAME value back
// out of session.freshAge at request time - one number, one definition of
// "fresh", nothing to drift.
//
// 24h is better-auth's default, pinned explicitly so an upstream change cannot
// move it silently. See docs/passwordless-auth-design.md section 8.2.
export const FRESH_AGE_SECONDS = 60 * 60 * 24

// Request header naming the account the user confirmed they want to delete.
// The server deletes whoever the session cookie belongs to, and the cookie can
// change after the user confirms: a passkey for another account picked during
// re-authentication, or a sign-in in another tab. The delete-user hook in
// server/auth.ts refuses unless this header equals the session's user id, so
// the delete only ever removes the account the user saw and confirmed.
export const DELETE_ACCOUNT_USER_HEADER = 'x-grampacker-delete-user-id'
