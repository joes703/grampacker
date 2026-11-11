# Server rules and traps

**Binding, kept current with the code.** Read before changing anything under
`server/` or `migrations/`. The contracts these rules protect are in
`AGENTS.md`, "Invariants".

## Repositories and transactions

- A repository operation that reads before it writes is one transaction. Its
  reads, checks, writes and response read-back run inside one
  `db.transaction(..., { behavior: 'immediate' })`, so nothing can change
  between a check and its write. The callback is synchronous: no `await`
  inside.
- A foreign-key failure inside such a transaction is a defect, not a race:
  let it 500. A single statement needs no explicit transaction. A slug
  collision retries the whole transaction (`withFreshSlug` in
  `server/repos/lists.ts`).
- Check client-supplied ids against the user (and parent) inside the write's
  transaction. Usually that is owned-set membership in JS: one query,
  whatever the input size (`server/repos/ownership.ts`).

## SQL and Drizzle

- No unbounded `inArray` over client input. SQLite allows 32766 bound
  parameters per statement (`server/db/sqlite.test.ts`). Bind a client list in
  one statement only where a request schema caps it far below that, and say so
  in a comment (`server/repos/food.ts`). List duplication splits its multi-row
  INSERTs to a quarter of the limit (`PARAM_BUDGET_PER_STATEMENT` in
  `server/repos/chunk-ids.ts`), because its food associations can exceed it.
- Never put `${table.column}` in a raw `` sql`` `` fragment that correlates to
  an outer table. Drizzle renders it unqualified, so both sides of a predicate
  can resolve against the inner table and return plausible but wrong data.
  Use a join, and assert the values in an API test.

## Hono

- `c.res = res` merges headers, and the old value wins for every header
  except `content-type`. Set `c.res = undefined` first.

## Migrations

`npm run test:migrations` enforces bookkeeping and the ban on destructive
statements; a separate pull-request CI check refuses edits to shipped files.
What they do not prove: `docs/testing-and-ci.md`, "Migrations".

- Create every migration with `drizzle-kit generate` (schema change) or
  `generate --custom` (data only), so its journal entry and snapshot exist.
- No table rebuilds, renames or `DROP TABLE`, and never touch the migration
  ledger. A rebuild's `DROP TABLE` can cascade into child rows and wipe them.
  A deliberate exception needs its own data-preservation proof and rollback
  rehearsal.
- `DROP COLUMN`, `DROP INDEX` and `DROP TRIGGER` are fine once the deployed
  application no longer uses the object.
- Never edit or delete a shipped migration: production applied it by name and
  never re-runs it.
- Every SQLite connection goes through `openSqlite` in `server/db/index.ts`.
  It enables foreign keys, WAL, synchronous NORMAL and a five-second busy
  timeout (`server/db/sqlite.test.ts` pins all four). SQLite turns foreign keys
  off per connection by default, so a connection that skips this silently
  loses cascade and ownership enforcement.
- The SQL triggers (every row cap; the rank-range, rerank, same-list, cycle
  and owner guards) are hand-written; `drizzle-kit` never emits or checks
  them. Never hand-edit generated files: the Drizzle snapshots and the
  better-auth schema.

## Auth and rate limits

better-auth has behaviors that look safe and are not: some GETs write, its
own rate limiter is off on purpose, config alone does not disable a route,
and `hooks.before` sees an unvalidated body. Read `SECURITY.md` and the
comments in `server/auth.ts` and `server/middleware/rate-limit.ts` before
changing either.
