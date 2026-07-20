# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-19)

**Core value:** grampacker.app serves at zero infrastructure cost with the legacy Supabase version retired
**Current focus:** None - v1.0 rewrite milestone complete; v1.1 polish backlog not started

## Current Position

Phase: none active (7 of 7 v1.0 phases complete; phases 8-9 planned)
Plan: -
Status: Milestone complete - production healthy
Last activity: 2026-07-19 - Post-v1.0 fix batch from first real use: PRs #85-#88 (currency-symbol CSV import, one `cost` column on gear export, cost through the list CSV path, decimal gear weights + migration 0013). All merged, deployed and smoked.

Progress (v1.0 Rewrite): [██████████] 100%
Progress (v1.1 Polish):  [░░░░░░░░░░] 0% (not started)

## Performance Metrics

**Velocity:**
- Total plans completed: 0 (v1.0 shipped pre-GSD via ~80 reviewed PRs; no plan-level metrics exist)
- Average duration: n/a
- Total execution time: n/a

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1-7 (v1.0) | pre-GSD | - | - |

*Metrics begin when Phase 8 planning starts*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions. The 11 passwordless-auth
decisions are LOCKED (shipped, no rollback path). Recent decisions affecting
future work:

- Public shares are read-only; do not re-add copy affordances
- Food projection: one shared function, round once at the DTO boundary -
  Phase 9 summary strips must obey it
- Visual parity direction settled: action color is blue, not emerald (Phase 8)
- Gear weight is REAL grams at 1dp; `roundGrams`/`formatGrams` in
  src/lib/weight.ts are mandatory on any path that produces or renders grams.
  `formatGrams` is load-bearing on AGGREGATES (sums are not snapped), so
  Phase 9 summary strips must use it rather than interpolating raw grams
- A migration that changes a column's declared type must declare it in
  EXPECTED_TYPE_CHANGES (scripts/check-migration-safety.mjs) or the run fails

### Pending Todos

None yet.

### Blockers/Concerns

None. Production is healthy; no known defects outstanding.

## Deferred Items

Items acknowledged and carried forward:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Food UI | All-days summary strips (section 13) | Planned as Phase 9 | 2026-07-19 (slice 7b v1) |
| Visual | Emerald -> blue + token gaps | Planned as Phase 8 | 2026-06-17 (parity plan) |
| Ops | Self-hosted port (Pi/Hetzner) | Standing constraint, unscheduled | - |

## Session Continuity

Last session: 2026-07-19
Stopped at: PRs #85-#88 shipped and deployed; owner confirmed 12.4 g entry works
in production. No phase active. Next candidate work is Phase 8 (visual parity).
Resume file: None
