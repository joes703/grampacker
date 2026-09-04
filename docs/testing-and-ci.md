# Testing and CI/CD: which tier, which check, how a merge reaches production

**Binding, maintained against the code** (AGENTS.md "Documents"). If a
sentence here disagrees with a config file or a workflow, that is a bug in
this document, and the change that made it wrong owes the fix.

Every section describes the tree as it is. A later change is headed
**Target state (lands in PR n)**; the PR that lands it flips the heading.
History and rationale live in `docs/incidents.md`; the plan these targets
come from is a dated record,
`docs/superpowers/plans/2026-09-04-testing-and-ci-simplification.md`.

## 1. The tiers

| Tier | Runner | Files | Proves |
| --- | --- | --- | --- |
| Node unit | `npm run test:unit` (Vitest, `environment: node`) | `scripts/**`, `shared/**`, `src/**` tests without a jsdom pragma, `server/**/*.node.test.ts` | Pure functions, DTO schemas, repo plumbing, server code with a mocked `Db` |
| jsdom component | same command; file opens with `// @vitest-environment jsdom` | `src/**` tests that render or need a DOM API | Rendering, DOM APIs, `localStorage` |
| workerd / D1 API | `npm run test:api` (`@cloudflare/vitest-pool-workers`) | every other `server/**/*.test.ts` | What the real Hono app, better-auth and D1 do on workerd: routes, middleware, authorization boundaries, constraints, triggers |
| Migration preservation | `npm run test:migrations` | `migrations/**` | Every post-baseline migration, applied the way deploy applies it, preserves the rows that already existed and the trigger behaviors it probes |
| Browser / end-to-end | none | none | Not needed today: the API tier drives the real app below the DOM and the jsdom tier covers rendering. Add one only for a cross-layer bug neither can express, in its own config |

`vitest.config.ts` and `vitest.workers.config.ts` are the source of truth
for membership.

## 2. Choosing a tier

Pick the cheapest runner that can prove what the test asserts:

1. Depends on what workerd, Hono-on-workerd, better-auth or D1 actually
   does (a status code, a constraint or trigger, an authorization boundary,
   a cookie)? **workerd / D1.** `server/**/*.test.ts`.
2. A pure function, or a repository driven through a hand-built fake `Db`,
   with no binding and no app? **Node.** Under `server/`, name it
   `*.node.test.ts`.
3. Renders React or needs a DOM API? **jsdom** pragma on line 1.
4. Adds or changes a migration? A fixture row for any new table and a
   `POST_CHECKS` probe for any trigger or rewrite, in
   `scripts/check-migration-safety.mjs`.

A test that would pass on both Node and workerd but was meant to prove
workerd belongs on workerd. The suffix is a claim the author makes and the
reviewer checks.

## 3. The Node/workerd boundary and what enforces it

`server/**/*.node.test.ts` runs on Node; every other `server/**/*.test.ts`
runs on workerd with its own D1. The name is the boundary so the runtime is
visible without opening a config.

- `vitest.config.ts` includes the glob; `vitest.workers.config.ts` excludes
  it. A file cannot run in both tiers.
- Node itself refuses `cloudflare:test` and `cloudflare:workers`, directly
  or through `server/test/*`, with a module-resolution error, so a test that
  secretly needs the Worker runtime fails the first time it runs.
- The one thing Node does not refuse is the app entry: `server/index.ts`
  loads on Node, so a misnamed API test could pass against Hono-on-Node
  while meaning to prove workerd. One `no-restricted-imports` rule in
  `eslint.config.js` refuses `./index`, `../index` and `../../index` from a
  `.node.test.ts`.

This guards against the accidental misfile, not deliberate evasion. The
residual is judgment, per section 2.

## 4. Real workerd and D1 where they are used, and not elsewhere

The bugs this app has shipped lived at the seams between Drizzle, Hono,
better-auth and D1, and none was visible on a fake (`docs/incidents.md`).
The API tier exists to see them. The same fact runs the other way: a
workerd test file pays a worker boot and a full migration replay before its
first assertion, which a pure function or a mocked repository gains nothing
from. Put each test where its claim needs to be, and nowhere more
expensive.

## 5. D1 isolation stays per file

Each workerd test file gets its own storage and replays the migrations into
it. Sharing storage across files (`--no-isolate`, `--max-workers=1`) was
tried and leaked rows between files; do not repeat it. The answer to the
per-file cost is fewer workerd files, never shared state.

## 6. jsdom

For rendering and DOM APIs only. Do not add the pragma to a test that needs
neither; whether a `localStorage`-only test is better served by a small
stub is a measured decision, not a default.

## 7. Migrations

- Immutable once on main: production applied each by name and never
  re-runs it. Never edit a shipped migration; add a new one. The baseline
  files are digest-pinned in the harness.
- Proven against a populated database before merge: the API tier migrates
  an empty database and cannot see a migration that destroys rows, so
  `npm run test:migrations` seeds fixture rows, applies each post-baseline
  migration the way deploy does, on real D1, and fails if any pre-existing
  row, column, trigger or index changed. Its `POST_CHECKS` probes are the
  only behavioral coverage of trigger bodies.
- What a migration may contain, and the contract-step rules for drops, are
  in AGENTS.md. A new table needs a fixture row; a trigger or rewrite needs
  a probe; the PR says what a backfill wrote, because the harness proves
  survival, not correctness.

**Target state (lands in PR 4).** Today every run replays all post-baseline
migrations. The target: on a pull request only the migrations the PR adds
get a populated-D1 pass, any change to a migration main already holds
fails the PR, and a change to the harness, schema, wrangler, drizzle, Node
or the lockfile forces the full run; on main the run stays full, because
main is the deploy gate.

## 8. Never delete or weaken a test to make CI faster

Runtime is bought by moving a test to a cheaper tier that proves the same
thing, by not repeating a proof, or by removing setup a test never needed.
A moved test keeps its assertions byte for byte; git shows a rename.

## 9. Measuring

Per-step CI timings: `gh api repos/joes703/grampacker/actions/runs/<id>/jobs`.
Per-file suite timings: `npx vitest run --reporter=json --outputFile=<scratch>/x.json`
(and `--config vitest.workers.config.ts`). Compare CI against CI on the same
runner class, before and after one change, at least two runs each. A local
number says how the pieces relate; it is not a CI saving.

## 10. GitHub Actions security

The rules are in AGENTS.md ("Git and supply chain") and `SECURITY.md`; the
decisions a workflow change must respect: least permissions per workflow
and job, with production credentials only on the steps that use them; SHA
pins with the tag in a comment, checked by `npm run check:action-pins`;
`pull_request`, never `pull_request_target`; no `workflow_dispatch` on a
workflow that names a secret; main protected by the ruleset (PR required,
`Verify` required and strict, squash only, no bypass), merged with
`--match-head-commit <sha>` after confirming CI yourself. Repository
secrets are visible to same-repository `pull_request` runs of any
workflow; only a `production` environment restricted to `main` would close
that, and it needs a plan that offers environments on private repositories.

## 11. Deployment

Principles: CI passes first; production changes are serialized and never
canceled mid-flight; a database change works with the deployed Worker and
the next one (deploy migrates, then swaps the Worker; expand first,
contract a release later); production mutations require explicit human
authorization, and the protected PR merge is that authorization - merge
means deploy, including the migrations the PR carries.

Mechanism today: a push to main runs `ci.yml`; its completion triggers
`deploy.yml` (`workflow_run`); a preflight job drops stale events; the
deploy job, inside the `deploy-production` concurrency group, re-verifies
through the API that `ci.yml` is green for main's head, builds, migrates,
deploys, records a deployment marker; `deploy-liveness.yml` compares main
against the marker every six hours. Recovery is a re-run of the failed run,
never a manual dispatch; the header of `deploy.yml` says which failures may
be re-run and which must not.

**Target state (lands in PR 5).** `ci.yml` runs `Verify` on pull requests
and is callable; `deploy.yml` runs only on a push to main, calls that same
`Verify` (one verification per main commit), then a `gate` job outside the
lock that skips if main has moved, then `deploy` inside the lock on the
exact verified SHA, recorded through the `production` environment. The
liveness check selects the newest deployment whose latest status is
`success`.

## 12. GitHub access from agent sandboxes

`gh` and `gh api` authenticate with the same fine-grained token supplied
through `GH_TOKEN`. The API is not a separate credential and cannot bypass
the token's permissions.

**Intended token profile.** Intended policy, not a claim derived from
`viewerPermission`; GitHub's token settings page is authoritative. Entries
the repository's own evidence has not confirmed say so. Do not probe
mutating endpoints to find out.

| Permission | Intended grant | Purpose |
| --- | --- | --- |
| Metadata | Read | Repository identity and basic metadata |
| Contents | Read/write | Read code and push task branches (intended - verify in token settings) |
| Pull requests | Read/write | Open and update pull requests (confirmed: PR #226 was opened from a sandbox) |
| Actions | Read | Runs, jobs and logs (confirmed; check-run annotations are not readable, see below) |
| Workflows | No access | Agents cannot push workflow-file changes (intended - verify in token settings) |
| Administration | No access | No settings or rules (confirmed: branch protection and secrets listing return 403) |
| Secrets and environments | No access | No credentials or production configuration (confirmed for reads) |
| Other permissions | No access unless explicitly documented | Fail closed |

**Command selection.** Prefer ordinary `gh` commands; use `gh api` for
machine-readable output or when a high-level command is incompatible with
the token. `gh api` is not read-only: GET reads, POST/PATCH/PUT/DELETE
mutate and need the same authorization as the equivalent command. Do not
try alternate routes around a denial or retry after one. Never print,
inspect, replace or refresh the token, run `gh auth token`, or start an
interactive login. Never request broader permissions for convenience.
Workflow-file commits are made and reviewed in the sandbox; Joe pushes them
from the host over SSH. `viewerPermission: ADMIN` describes Joe's account
relationship, not the token. Technical capability is not authorization.

**State-changing operations.** Push task branches and open or update PRs
when the approved task calls for it. Merge only with Joe's explicit
approval of the exact PR and reviewed head SHA. Re-running or canceling a
workflow is state-changing; never re-run a Deploy workflow without explicit
approval - it may apply D1 migrations or deploy production. Never change
branch rules, settings, environments, secrets, releases, deployments or
production resources without explicit authorization. Never force-push. An
available permission does not override any of this.

**CI monitoring.** `gh run watch` fails under this token with a 403 on
check-run annotations: a compatibility limitation, not an auth failure. Use
the Actions REST API, polling no more often than about every 30 seconds in
a bounded or background loop:

```bash
gh api repos/joes703/grampacker/actions/runs/<run-id> \
  --jq '{status, conclusion, head_sha, html_url}'
gh api repos/joes703/grampacker/actions/runs/<run-id>/jobs \
  --jq '.jobs[] | {name, status, conclusion, started_at, completed_at}'
```

**Failure classification.** `Blocked by network policy` in a body is a
Docker Sandbox network denial, not GitHub auth. 401: missing, invalid or
expired authentication. 403 from GitHub: insufficient token permission,
policy enforcement, or rate limiting - read the message and headers first.
`X-Accepted-GitHub-Permissions` names what an endpoint needs, not what the
token has. The `gh run watch` 403: switch to REST polling. A push rejected
for `.github/workflows/**`: the intentional absence of workflow-write; stop
and hand the exact commit SHA to Joe. A branch-protection rejection is not
a token problem and is never bypassed.

## 13. Checklist

- **Test:** tier by what it proves (section 2); `.node.test.ts` under
  `server/` only for pure or mocked code; jsdom only for rendering or a DOM
  API; `npm run test:api` as well as `test:unit` for anything under
  `server/`.
- **Migration:** fixture rows and probes; `npm run test:migrations`; the
  PR says what a backfill wrote; the old Worker on the new schema is safe
  for the deploy window.
- **Workflow:** `npm run check:yaml`, `npm run check:action-pins`; the
  deploy invariants in section 11 still hold; the commit goes to Joe for a
  host-side push.
- **Done:** the complete diff read; every check named with its result and
  anything not run said so; Codex review with a `VERDICT:` line.
