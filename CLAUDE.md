# Working with Claude on grampacker-next

Stack: Cloudflare Workers + D1 (SQLite), Vite, React, TypeScript, drizzle, better-auth.
This is the rewrite of the old Supabase-backed grampacker. Much of the old project's
conventions were Supabase/Postgres-specific and do NOT apply here (see "Removed
pending D1 equivalents" at the bottom). Don't reintroduce Postgres/RLS/PostgREST
patterns.

## Verification

- **Verify with `npm run build` before committing.** It runs the real typecheck +
  bundle that deploy runs, and catches project-reference and lib-type issues that a
  bare `tsc --noEmit` does not. A passing `tsc --noEmit` does NOT guarantee the build.
- After any multi-site refactor (extracting a hook, splitting a module, removing a
  feature), run a final grep to confirm the migration is complete. Trust grep, not
  "it's done."
- For any TypeScript change touching React types (refs, event handlers), verify with
  `npm run build` specifically. Lib types are subtle and small "cleanups" can break
  compatibility. `RefObject<T | null>` is correct for refs from `useRef<T>(null)`;
  the `| null` is load-bearing, don't "tighten" it.
- Tests: `npm test` (Vitest). Exit code 0 = pass; error text in output can be
  intentional error-path assertions. When testing a DB helper, verify the production
  code path you think uses it actually does — production callers diverge from what a
  helper was "designed for." A passing test on one path tells you nothing about
  another that "shares a helper." Trace production callers and match tests to them.
- Optimistic updates hide server rejections: a failed write rolls back in
  milliseconds, so the UI flashes correct then snaps back. During development, hard-
  refresh after a write to confirm the server accepted it. Optimistic UI is a latency
  tool, not a correctness signal.
- Local dev D1 is plain SQLite; deploy/remote-D1 ops need the hand-sourced Cloudflare
  token (`~/.cf-token`) and stay human-gated. Don't attempt remote D1 writes without me.

## TypeScript

- `noUncheckedIndexedAccess` is enabled — indexed access returns `T | undefined`.
  Prefer destructuring with defaults, length guards, or `.find()` over non-null
  assertions. If you must use `!`, comment why.

## Working style

- This codebase belongs to someone learning. Explain reasoning when proposing changes.
- Multi-step refactors: survey → show the plan → execute in checkpoints. Don't bundle
  structural decisions into one diff.
- Single commit per logical change. Don't fold unrelated cleanups into a focused PR.
- "Don't make other changes" = don't expand scope, NOT leave a change half-finished.
  If a type change implies cleanup at five sites, those five are in scope.
- Don't add features inside refactor PRs. New behavior is a new commit.

## Git & supply chain

- NEVER `git add -A` / `git add .`. Stage exact files by path. (Also: the sandbox
  surfaces masked dotfiles as untracked; explicit staging avoids ever touching them.)
- `npm ci`, not `npm install`. Keep `package-lock.json` checked in.
- `.npmrc` sets `ignore-scripts=true` (supply-chain safety). If you ever remove it,
  re-test `rm -rf node_modules && npm ci` + build first.
- Don't add `target="_blank"` without `rel="noopener noreferrer"` on the same anchor.

## Async / failure feedback (verify these still hold in the rewrite)

- Optimistic mutation with a visible rollback: the snap-back usually IS the failure
  signal; don't add a toast for ordinary optimistic rollbacks. Exception: reorders,
  whose rollback is otherwise invisible.
- Non-optimistic mutations: opt into explicit feedback rather than hand-rolling an
  `onError` toast where a shared handler covers it.
- Non-optimistic async actions that aren't mutations: wrap the body in try/catch,
  show an error toast on failure, and CONSUME the error (no rethrow — a toast-then-
  rethrow still leaves an unhandled rejection).
- Fire-and-forget rejected promises are prohibited. An async handler invoked without
  await/.catch must catch internally, or its contract becomes `() => Promise<void>`
  and is awaited+caught at the call site.

> NOTE: the four bullets above came from the Supabase version. Confirm the React
> Query / mutation architecture carried into grampacker-next before treating them as
> binding; update or delete once verified against the new code.

## Removed pending D1 equivalents (do NOT reintroduce)

The old grampacker CLAUDE.md had detailed rules for Supabase/Postgres that do not
apply to Cloudflare D1. Do not carry these over or write code assuming them:

- PostgREST `.upsert()` / RLS `WITH CHECK` / `SECURITY DEFINER` RPCs / `supabase.rpc()`
- Row Level Security, `auth.uid()`, RLS-visible rows — D1 has no RLS
- pgTAP CI tests, `supabase db start`, `supabase test db`
- The Supabase join-based domain model (`list_items` embedding `gear_item` via a
  PostgREST join) — the D1 data-access layer is different

When the D1 equivalents of these (schema/migrations via drizzle, data-access
patterns, cache invalidation) are established in this codebase, document them here
as new sections. Until then, ask rather than assume.
