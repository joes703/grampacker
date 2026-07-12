-- Passwordless teardown. IRREVERSIBLE: this destroys every password hash.
--
-- Safe to apply before the Worker deploy (the order CI uses): the passwordless
-- Worker has been live since PR #47 and reads none of these rows. Nothing in
-- better-auth core touches `account` during session creation, getSession,
-- changeEmail or updateUser; the passkey plugin never touches it; there is no
-- FK from `session` or `user` to `account`.

-- The password itself. `emailAndPassword` is already unconfigured, so
-- /sign-in/email 400s - but /change-password and /set-password are NOT gated on
-- `enabled`, they only require a credential row to exist. Deleting the rows is
-- what actually closes them.
DELETE FROM `account` WHERE `provider_id` = 'credential';
--> statement-breakpoint

-- Pre-cutover reset tokens. NOT optional. POST /reset-password is mounted
-- unconditionally and is not gated on `enabled`, and given a still-valid token
-- it will RE-CREATE a credential account for a user who has none
-- (better-auth password.mjs:147-158). Any token minted before the cutover is
-- therefore a live path back to a password. Purging them closes it.
--
-- Scoped by better-auth's own identifier format, `reset-password:${token}`
-- (password.mjs:68). Magic-link rows live in this same table but key off a bare
-- SHA-256 base64url hash (we set storeToken: 'hashed' - server/auth.ts) with no
-- prefix of any kind, so they cannot match this LIKE and survive untouched.
DELETE FROM `verification` WHERE `identifier` LIKE 'reset-password:%';
--> statement-breakpoint

-- The old sudo-mode table. Fresh auth is now session freshness (better-auth's
-- session.freshAge - server/middleware/fresh-auth.ts). This table could not have
-- survived the cutover in any case: its check inner-joined the credential row to
-- compare against the password's updated_at, so with no credential row the join
-- matches nothing and the gate fails closed.
DROP TABLE `fresh_auth`;
