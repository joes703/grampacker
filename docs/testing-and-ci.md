# Testing and CI/CD

**Binding, maintained against the code.** `vitest.config.ts` (its `unit` and
`api` projects) and `.github/workflows/` are the executable sources of truth.

## 1. Test tiers

| Tier | Command | Files | Proves |
| --- | --- | --- | --- |
| Node unit | `npm run test:unit` | `scripts/**`, `shared/**`, `src/**`, `server/**/*.node.test.ts` | Pure functions, UI behavior and mocked server code |
| jsdom component | same command, with a jsdom pragma | DOM-rendering tests under `src/**` | Rendering and browser APIs |
| Node/SQLite API | `npm run test:api` | every other `server/**/*.test.ts` | The real Hono app, better-auth, repositories, constraints, triggers and transactions against a fresh SQLite database per file |
| Migrations | `npm run test:migrations` | `migrations/**` and its checks | Drizzle bookkeeping, schema snapshot agreement and the ban on destructive new migration statements |

There is no browser end-to-end tier. Add one only for a cross-layer defect
that the API and jsdom tiers cannot express.

## 2. Choosing a tier

Use the cheapest tier that proves the behavior:

1. Real app, better-auth, SQLite, HTTP status, cookie, authorization,
   constraint, trigger or transaction: API test.
2. Pure function or server code driven through a fake `Db`: unit test. Under
   `server/`, name it `*.node.test.ts`.
3. React rendering or DOM API: jsdom pragma on line 1.
4. Database rule: an API test that exercises the real rule. A TypeScript
   constant copied into SQL also needs a test that compares the copies.

The suffix is a claim the author makes and the reviewer checks.

## 3. Isolation

Each API test file gets a fresh in-memory SQLite database through
`server/test/node-env.ts`. Tests in one file may share process state, so reset
module-level counters and outboxes explicitly. Do not read a real secret or a
developer database.

Unit tests do not open SQLite or create the full app. A test that needs either
belongs in the API tier.

## 4. jsdom

Use jsdom only when the assertion needs a DOM. A test that uses only
`localStorage` may use a small stub if that makes the proof clearer and
cheaper; measure before moving existing tests.

## 5. Migrations

Production records applied files in `__drizzle_migrations`. The migration
check proves:

- every journal entry has SQL and every SQL file has a journal entry;
- the newest snapshot matches `server/db/schema.ts`;
- no two snapshots claim the same parent (`drizzle-kit check`: two branches
  that each generated a migration from the same snapshot);
- migrations absent from the merge base do not rebuild or rename tables,
  drop tables, change `PRAGMA foreign_keys`, touch the migration ledger, or
  write the SQLite schema table;
- files already present on `main` are unchanged. This part runs in CI on
  pull requests only (`check-migration-safety.mjs --immutability`).

The API suite proves that the complete migration set builds a working SQLite
database and that its rules behave as expected. Nothing automatically proves
that a new migration preserves rows in an existing production-shaped
database. Any exception to the destructive-SQL ban needs its own preservation
test and rollback rehearsal.

Do not collapse migration history without a separate design and a rehearsal
against a copy of production. The application runner hashes the files it
records, so replacing applied history is not routine maintenance.

## 6. Deleting or moving tests

Speed alone is not a reason to delete a test. A test may go only when:

1. the behavior or reachable input no longer exists;
2. another named test proves the same behavior at the same boundary;
3. the test cannot fail for a realistic production defect; or
4. its maintenance cost exceeds its material value for this app. Name the
   accepted gap and an appropriate manual check; owner approval of the exact
   PR head accepts that tradeoff.

The change must name the reason and evidence. Moving a test to a cheaper tier
keeps its assertions unless the behavior changed.

Test our configuration, callbacks, transformations, and observable application
outcomes. Trust dependencies to implement their own hashing, expiry, WebAuthn,
SQL, schema primitives, and compression. Real dependencies are appropriate
when they prove our wiring or access boundary; neither a security label nor
third-party ownership alone determines whether to keep a test.

Exact class strings and DOM rails have limited value without a layout engine.
Shared-control sizing, alignment, print layout and keyboard access remain UI
requirements. Check them in a browser or print preview when changing those
surfaces; this suite accepts less automated protection for cosmetic changes.
For changes to the public share's dependencies, inspect the emitted bundle
instead of maintaining a custom import parser. The existing page-level print
filter test protects missing content separately.

## 7. Measuring

Use CI job timings for CI claims and compare the same runner class before and
after, with at least two runs each. For local per-file data:

```bash
npx vitest run --reporter=json --outputFile=<scratch>/results.json
```

A local number explains relative cost; it does not prove a CI saving.

## 8. GitHub Actions security

- Least privilege per workflow and per job.
- Pin third-party Actions to full commit SHAs with the tag in a comment.
- Use `pull_request`, never `pull_request_target`, for code from a pull
  request.
- `image.yml` builds and checks the production image on every pull request.
  A manual dispatch from `main` reruns all checks and publishes the image.
  Only when `deploy=true` does its final job use the production environment's
  SSH key to deploy that exact digest to the VPS.
- The `production` environment admits `main` only. Its SSH key is never a
  repository-level secret.
- A tag is not proof of provenance. Deploy only the digest printed by a
  successful `image.yml` run on `main`.

Run `npm run check:action-pins` after workflow edits. It checks pin format
only; check by eye that each pin's tag comment matches its SHA.

## 9. Deployment checks

The production deployment is `deploy/`: Compose, two Caddyfiles,
`grampacker-deploy`, and the SSH forced-command wrapper. Before a change to
those files merges, run:

- shellcheck on the three shell scripts;
- `deploy/test-grampacker-deploy-ssh.sh`;
- `docker compose config` with production-shaped and rehearsal-shaped env
  files;
- `caddy validate` on both Caddyfiles with `caddy:2`;
- the empty-database rehearsal in `docs/vps-runbook.md`, "Change or test
  deployment files".

Who merges and deploys, and when: AGENTS.md "Shipping". Deploy, failure and
rollback procedures: `docs/vps-runbook.md`.

## 10. GitHub access from agent sandboxes

`gh` and `gh api` use the same supplied token. The API is not a second
credential and cannot bypass the token's permissions.

Expected profile: repository contents and pull requests read/write; Actions
read; workflows, administration, secrets, environments and production
settings unavailable. GitHub's token settings page is authoritative.

Prefer ordinary `gh` commands. Use `gh api` for machine-readable reads. Do
not probe mutation endpoints to discover permissions, print or refresh the
token, start an interactive login, or work around a denial. A workflow-file
push rejected for missing Workflows permission is handed to the owner with
the exact commit SHA.

Push task branches and open or update pull requests when the task calls for
it. Merge only after the owner approves the exact PR head. Never force-push.
Dispatching or canceling a deploy, changing repository settings or secrets,
and mutating production all require explicit authorization.

If `gh run watch` gets a 403 while reading annotations, poll the run and jobs
through the Actions REST API no more often than about every 30 seconds:

```bash
gh api repos/joes703/grampacker/actions/runs/<run-id> \
  --jq '{status, conclusion, head_sha, html_url}'
gh api repos/joes703/grampacker/actions/runs/<run-id>/jobs \
  --jq '.jobs[] | {name, status, conclusion, started_at, completed_at}'
```

## 11. Checklist

- Code: `npm run build` and `npm run test:unit`.
- Server: also `npm run test:api`.
- Migration or schema: also `npm run test:migrations`.
- Workflow: `npm run check:action-pins`.
- Deployment files: section 9 above.
- Done: read the complete diff; report every check run and any check omitted.
