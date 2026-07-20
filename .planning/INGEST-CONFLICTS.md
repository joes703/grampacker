# Ingest Conflicts

## Conflict Detection Report

Re-run 2026-07-19, after the previous run's cross-ref-cycle blocker was
resolved via manifest override (.planning/ingest-manifest.yaml). All three
docs entered synthesis; the graph is acyclic
(food-planning-design.md -> authz-matrix.md is the only in-set edge).

### BLOCKERS (0)

(none)

### WARNINGS (0)

(none)

### INFO (3)

[INFO] Prior cycle blocker resolved by manifest cross_refs override
  Note: the previous run blocked on the cycle food-planning-design.md ->
    authz-matrix.md -> food-planning-design.md. The manifest
    (.planning/ingest-manifest.yaml) now sets authz-matrix.md's cross_refs
    to [] - its citations of food-planning-design.md are informational
    provenance from the downstream route registry, not dependency edges.
    Cycle detection now passes; both SPECs were extracted into
    constraints.md.
    source: .planning/ingest-manifest.yaml,
    .planning/intel/classifications/authz-matrix.json

[INFO] Stale "Status: PROPOSED" header on docs/food-planning-design.md
  RESOLVED 2026-07-19: the header now reads "Status: ACCEPTED - slices 1-7
    shipped to production 2026-07-19 ...; section 13 all-days summary strips
    remain deferred". Kept as a record of what the ingest saw.
  Note (as observed at ingest time): the header read "Status: PROPOSED
    (not yet implemented)" and
    "Nothing implemented yet", but the doc's own body records every slice
    shipped (12.1 revised via migration 0010, section 14 "shipped with
    slice 7b") and the rewrite completed with PR #83 on 2026-07-19. Same
    header drift the passwordless ADR had before its 2026-07-19 correction.
    Synthesis treated the doc's current body text as authoritative (per
    orchestrator direction); this affects no bucket, but the header should
    be corrected to an accepted/shipped status for future ingests.
    source: docs/food-planning-design.md (lines 3-4 vs sections 12, 14)

[INFO] Fresh-auth error codes: ADR and authz matrix describe different layers
  Note: docs/passwordless-auth-design.md (section 3) says the passkey
    plugin's freshSessionMiddleware answers 403 SESSION_NOT_FRESH;
    docs/authz-matrix.md (passkey fresh-route row) documents 403
    REAUTH_REQUIRED. Verified against the shipped code: our own
    server/middleware/fresh-auth.ts returns REAUTH_REQUIRED and fronts the
    plugin, so the matrix documents the actual wire contract while the ADR
    documents better-auth's native behavior one layer down. Both statements
    are simultaneously true; no contradiction and no resolution needed. The
    ADR-documented 400 SESSION_EXPIRED for delete-user matches the matrix
    exactly.
    source: docs/passwordless-auth-design.md, docs/authz-matrix.md,
    server/middleware/fresh-auth.ts:60
