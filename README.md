# grampacker

Pack-weight planning for backpacking. Live at [grampacker.app](https://grampacker.app).

Build a gear library, assemble gear into trip lists, see what the pack weighs,
and share a read-only view of a list.

## Stack

TypeScript end to end: a React SPA and a Hono API running together on Cloudflare
Workers, with Drizzle over D1 (SQLite) and better-auth for sessions. Portable by
design - nothing depends on a Cloudflare-only API, so it can move to any
Node + SQLite host.

Sign-in is passwordless: magic link or passkey. There is no email/password path,
and that absence is deliberate.

- Pinned versions and upgrade policy: [STACK.md](./STACK.md)
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

`npm run build` is the verification gate: it runs the full typecheck, not a
subset.

None of the above needs a production credential. Local dev reads a disposable
secret from `.dev.vars`, and Miniflare creates a local SQLite database from the
D1 binding - the production database is never contacted.

## Deployment

Merging to `main` deploys. `.github/workflows/deploy.yml` applies remote D1
migrations and then runs `wrangler deploy`, so a merge is a production database
migration as well as a code push. The Cloudflare credentials exist only as
GitHub Actions secrets, never locally.

## Layout

- `src/` - React SPA
- `server/` - Hono API on Workers; owns the DB via `server/db`
- `shared/` - zod DTO contracts imported by both sides
- `migrations/` - SQL migrations (drizzle-kit generate -> wrangler d1 apply)

## History

A ground-up rewrite of
[grampacker-supabase](https://github.com/joes703/grampacker-supabase), which is
archived and read-only. The rewrite is finished;
[REWRITE_PLAN.md](./REWRITE_PLAN.md) is kept as the record of what was decided
and why. Deferred ideas live in [PARKED.md](./PARKED.md).
