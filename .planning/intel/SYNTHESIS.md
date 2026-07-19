# Synthesis Summary

Mode: new (fresh bootstrap; this run overwrites the previous BLOCKED run)
Precedence: ADR > SPEC > PRD > DOC (no per-doc integer overrides)
Date: 2026-07-19 (re-run after cycle resolution via manifest override)

## Doc counts

- Classified: 3 (1 ADR, 2 SPEC, 0 PRD, 0 DOC, 0 UNKNOWN)
- Synthesized: 3 (all)
- Cycle detection: PASS. Only in-set edge is
  food-planning-design.md -> authz-matrix.md; authz-matrix.md's back-edge
  was dropped by manifest override (.planning/ingest-manifest.yaml).

## Decisions

- 11 decision entries from docs/passwordless-auth-design.md in decisions.md
- Locked: 11 (all). The ADR header now reads ACCEPTED/shipped and the
  classification marks it locked; no lower-precedence source can
  auto-override these in a future ingest.

## Requirements

- 0 (no PRDs in the ingest set) - see requirements.md. All ingested docs
  describe shipped production work; derived requirements are
  satisfied-as-built.

## Constraints

- 17 entries in constraints.md:
  - docs/food-planning-design.md: 11 (schema 4, api-contract 4, protocol 2,
    nfr 1)
  - docs/authz-matrix.md: 6 (api-contract 3, protocol 3)

## Context topics

- 0 (no DOCs in the ingest set) - see context.md

## Conflicts

- 0 blockers, 0 competing-variants, 3 info
- No LOCKED-vs-LOCKED possible (one locked ADR); no PRD acceptance
  variants; no UNKNOWN/low-confidence docs; MODE=new so no existing-context
  checks. Neither SPEC contradicts the ADR: the authz matrix's freshAge
  (24h), fresh-gated route set, ungated rename, and three-bucket
  magic-link limits (incl. charge order and the HMAC'd untrimmed key)
  match ADR decisions 8.1/8.2 and section 4.2 exactly. The one apparent
  divergence (403 SESSION_NOT_FRESH vs REAUTH_REQUIRED) was verified
  against shipped code as two layers of the same stack - see INFO 3.
- Detail: .planning/INGEST-CONFLICTS.md

## Status

READY - safe to route. No gate is held by this report.

Note for the roadmapper: every ingested doc describes SHIPPED work (the
rewrite completed 2026-07-19 with PR #83, food targets frontend). This
intel establishes the as-built baseline and its locked decisions; it does
not itself contain unshipped scope.

## Files

- .planning/intel/decisions.md
- .planning/intel/requirements.md
- .planning/intel/constraints.md
- .planning/intel/context.md
- .planning/INGEST-CONFLICTS.md
