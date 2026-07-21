# Codex implementation brief: Organize Pack

> **Post-launch note (2026-07-20):** The feature has shipped. A later
> user-requested amendment raises Organize from `/pack/organize` to the peer
> `/organize` list mode with Pack/Organize pill toggles. See the amendment at
> the top of `docs/organize-pack-design.md`; it supersedes the route and
> persistence instructions in this historical implementation brief.

You are implementing a fully-specified, already-reviewed feature in the
grampacker-next repo. A detailed design doc exists and is the contract. Your job
is to build it, phase by phase, with tests, following this repo's rules.

## Start here (read before writing code)

1. `AGENTS.md` — the shared source of truth: stack, exact commands, the
   verification gate, and the traps (D1 100-param limit,
   `noUncheckedIndexedAccess`, optimistic-update blind spots, the import
   boundary, security invariants). Everything there is binding.
2. `CLAUDE.md` — interactive working rules (they apply to you too).
3. `docs/organize-pack-design.md` — **the plan you are implementing (rev 6,
   implementation-ready).** It went through five adversarial design reviews;
   treat its decisions as settled. Build exactly what it specifies.

The branch `feat/organize-pack` already contains the design doc and nothing else.
Work on that branch.

## What the feature is

A per-list "packing locations" layer for Pack Mode (bear canister, hip belt
pocket, pot bag) — where gear physically goes on a trip, separate from permanent
gear categories. Each list item belongs to zero-or-one location. Deleting a
location never deletes gear; its items become unassigned. Full spec, data model,
API, frontend, migration, and testing strategy are in the design doc.

## How to build it

**Follow the four phases in section 7 of the design, in order, backend-first:**

- **Phase 1 — data + API (no UI).** Migration `0014` (table, three indexes, cap
  trigger, the three integrity triggers, the `ALTER TABLE ADD COLUMN`, the column
  index, snapshot + journal), schema, repo, routes, validation, the assignment
  field on the item PATCH, duplication copy/remap, `docs/authz-matrix.md` rows,
  `FORBIDDEN_KEYS`, the `check-migration-safety.mjs` FIXTURES entry **and the nine
  literal POST_CHECKS spelled out verbatim in design section 5**, the
  `hasListItemEdits` field, and the full API test matrix in section 6.
- **Phase 2 — Organize Pack UI, no drag.** The `/pack/organize` route, the mode
  audit, the generalized `groupBy` + unconditional stability hook, CRUD + reorder,
  `Move to…`, Unassigned, the grouping-state switch (4.4), the worn handling
  (4.5), the `LocationSection` header/count (4.6), and the self-contained takeout
  `packing.json` (5). This is the shippable slice.
- **Phase 3 — drag and drop.** dnd-kit between locations; `Move to…` stays the
  accessible path.
- **Phase 4 — polish.** Per-location progress, collapse persistence, empty state.

**Discipline (from AGENTS.md / CLAUDE.md):**

- **TDD.** Write the failing test, watch it fail, then implement. The design's
  section 6 lists the required tests; several are explicitly red-green (e.g.
  `listItemsArrayEqual`, `hasListItemEdits`).
- **Verification gate before claiming a phase done:** `npm run build` +
  `npm run test:unit` + `npm run test:migrations` must pass. `npm run test:api`
  runs on real workerd in CI. Do not assert completion without running these.
- **Atomic commits**, one logical change each. Stage exact paths — never
  `git add -A`/`git add .`.
- **D1 100-param limit:** ownership prechecks use owned-set membership in JS +
  chunked batch writes, never an unbounded `inArray`. The design already accounts
  for this (reorder, duplication, delete-unassign).
- **Ownership is structural.** Authenticated repo queries filter by the session
  `user_id`; no route touches another user's rows. The public-share projection is
  a field-by-field allowlist and must not gain packing fields (the design keeps
  them in `FORBIDDEN_KEYS`).
- **CSRF:** custom header required on writes (POST/PATCH/PUT/DELETE); GET is
  exempt. 401 without a session on every route.
- **Before each commit, do an adversarial self-review of the diff** (this repo's
  GATE 2): correctness, ownership, races, the D1 cap, test coverage. The design's
  invariants are the checklist.

**Do not touch:** `.dev.vars`, `.env`, `.dev.vars.example` (a sandbox-masked
device that must never be staged), or the untracked host dotfiles in the repo
root (`.bashrc`, `.zshrc`, `.claude/*`, `.gitconfig`, etc.). Stage only the
feature's source/test/migration/doc files.

**Human-gated:** do not push, open a PR, or merge without the human's OK. A merge
to `main` is a production deploy that applies remote D1 migrations. Flag the human
at each outward gate. Build on `feat/organize-pack`; the human decides when it
ships.

## One caveat to verify yourself

The design's rev-6 changes (the self-contained `packing.json` shape in section 5,
and the file-inventory line) were the only parts not re-run through the design
review. Sanity-check them against the real `DownloadAllData` / takeout code as you
reach Phase 2, and raise anything that does not fit before building it.
