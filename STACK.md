# Stack

**Reference, not policy.** `package.json` and `package-lock.json` are the
authoritative version records. This page keeps only the context that is useful
when changing dependencies.

- Node and `better-sqlite3` run the app against one SQLite file on the VPS.
- Hono owns the HTTP API; Vite builds the React client and serves it during
  local development.
- Drizzle owns schema definitions and migration generation. The app's own
  migration runner applies those files.
- better-auth owns sessions, magic links and passkeys. `@better-auth/passkey`
  stays version-aligned with `better-auth`.
- drizzle-orm remains on 0.45.x while better-auth peers on `^0.45.2`. Watch
  better-auth's peer range before trying drizzle 1.x.
- TypeScript remains on 6.x while typescript-eslint rejects 7.x. The linter's
  peer range, not this repository, is the blocker.
- `overrides` address transitive advisories. Their rules are in `AGENTS.md`.

## Watch list

- drizzle 1.x, when better-auth supports it
- eslint-plugin-jsx-a11y with ESLint 10 support
- TypeScript 7, when typescript-eslint supports it
- @dnd-kit/react 1.0; the app uses the classic packages until then
