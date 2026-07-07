# grampacker

Pack-weight planning for backpacking. Ground-up rewrite of
[grampacker-supabase](https://github.com/joes703/grampacker-supabase) onto a
portable TypeScript stack: Hono + Drizzle + SQLite (Cloudflare Workers + D1
first; deployable to any Node + SQLite box).

The plan of record is [REWRITE_PLAN.md](./REWRITE_PLAN.md). Pinned versions
and upgrade policy live in [STACK.md](./STACK.md). Deferred ideas live in
[PARKED.md](./PARKED.md).

## Development

```sh
npm install
npm run dev        # SPA + /api/* Worker + local D1, one process (no Docker)
npm test           # unit tests (vitest)
npm run typecheck  # wrangler types + tsc -b
npm run build      # typecheck + client/worker production build
```

`npm run build` is the pre-commit verification gate, same discipline as the
old repo: it runs the full typecheck, not a subset.

## Layout

- `src/` - React SPA (transplants from the old repo starting phase 2)
- `server/` - Hono API on Workers; owns the DB via `server/db`
- `shared/` - zod DTO contracts imported by both sides
- `migrations/` - SQL migrations (drizzle-kit generate -> wrangler d1 apply)
