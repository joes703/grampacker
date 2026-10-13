# grampacker

**Reference, not policy.** Product and setup. `AGENTS.md` is the working
contract; `SECURITY.md` is the security posture.

Pack-weight planning for backpacking. Live at [grampacker.app](https://grampacker.app).

Build a gear library, assemble gear into trip lists, see what the pack weighs,
and share a read-only view of a list.

## Stack

TypeScript end to end: a React SPA and a Hono API running together on Cloudflare
Workers, with Drizzle over D1 (SQLite) and better-auth for sessions.

Portability to a Node + SQLite host was an early goal and is no longer one.
There is no Node entry point, no non-D1 driver and no Node-target test suite,
and the server uses D1 batch semantics directly. Treat Cloudflare as the
platform, not as an implementation detail behind an abstraction.

Sign-in is passwordless: magic link or passkey. There is no email/password path,
and that absence is deliberate.

- Dependency rationale and upgrade notes: [STACK.md](./STACK.md)
  (`package.json` is authoritative for versions; `AGENTS.md` holds the binding
  supply-chain rules)
- What is enforced, and what is knowingly deferred: [SECURITY.md](./SECURITY.md)
- Rules every agent follows in this repo: [AGENTS.md](./AGENTS.md)

## Development

```sh
npm ci             # never `npm install` - it can rewrite the lockfile
npm run dev        # SPA + /api/* Worker + local D1, one process (no Docker)
npm test           # unit tests (vitest) + api tests (workers pool)
npm run test:unit  # unit tests only
npm run test:api   # api tests only (needs to bind a port)
npm run typecheck  # wrangler types + tsc -b
npm run build      # typecheck + lint + client/worker production build
```

`npm run build` runs typecheck, lint and bundle. It is NOT the whole gate -
tests are separate (`npm run test:unit`, `npm run test:api`, and
`npm run test:migrations` when the schema changes). AGENTS.md has the full
list; [docs/testing-and-ci.md](./docs/testing-and-ci.md) explains the test
tiers, which one a new test belongs in, and how a merge reaches production.

None of the above needs a production credential. Local dev reads a disposable
secret from `.dev.vars`, and Miniflare creates a local SQLite database from the
D1 binding - the production database is never contacted.

## Deployment

Merging to `main` no longer deploys. The app is moving from Cloudflare
Workers to a Node server with SQLite on a VPS, so
`.github/workflows/deploy.yml`, which applied remote D1 migrations and then
ran `wrangler deploy`, is kept only as a legacy record and none of its jobs
run. The production Worker keeps serving the last commit it deployed until
the cutover. The Cloudflare credentials exist only as GitHub Actions secrets,
never locally.

## Layout

- `src/` - React SPA
- `server/` - Hono API on Workers; owns the DB via `server/db`
- `shared/` - zod DTO contracts imported by both sides
- `migrations/` - SQL migrations (drizzle-kit generate -> wrangler d1 apply)

## History

A ground-up rewrite of
[grampacker-supabase](https://github.com/joes703/grampacker-supabase), which is
archived and read-only. The rewrite is finished. Its plan, reviews and audits
were removed from the tree on 2026-10-01 and remain in git history (for
example `git show 89e4f1c:REWRITE_PLAN.md`). Deferred ideas live in
[PARKED.md](./PARKED.md).
