> **DATED RECORD. NOT AUTHORITATIVE.** A planning tool's snapshot from
> 2026-07-19, kept for the reasoning it holds. Several things it lists as
> validated or intended were retired afterwards: the standalone food-planning
> feature and nutrition targets (deleted by migration 0016, 2026-07-30), and
> portability to a self-hosted Node + SQLite deployment (retired; README).
> Do not cite anything here to justify or block a decision, and do not update
> it to match later reality. `AGENTS.md` says which documents bind.

# Requirements: grampacker

**Defined:** 2026-07-19 (retroactive baseline from ingest; rewrite already shipped)
**Core Value:** grampacker.app serves at zero infrastructure cost with the legacy Supabase version retired

## v1 Requirements (Rewrite - SHIPPED)

All v1 requirements below are satisfied-as-built: the rewrite completed
2026-07-19 (final PR #83). They are recorded as the baseline, mapped to the
shipped phases in ROADMAP.md.

### Platform

- [x] **PLAT-01**: grampacker.app is served entirely by the Workers deployment at zero infrastructure cost; Supabase retired
- [x] **PLAT-02**: Merge to main triggers CI deploy that applies remote D1 migrations before deploying
- [x] **PLAT-03**: Domain logic stays portable to self-hosted SQLite (no CF-only primitives; required pragmas documented)

### Authentication

- [x] **AUTH-01**: User signs in with a passkey as the primary method (WebAuthn user verification enforced by our hooks)
- [x] **AUTH-02**: User signs up and recovers via emailed magic link - the only recovery path
- [x] **AUTH-03**: No password or OTP exists as a stored credential or auth method (teardown irreversible)
- [x] **AUTH-04**: Credential-changing operations (passkey register/delete, delete-user) require a fresh session (< 24h)
- [x] **AUTH-05**: Magic-link send is rate-limited across three buckets (global/IP/address) with a hardened single-use token (hashed at rest, 5 min, URL fragment, gesture-verified)

### Gear

- [x] **GEAR-01**: User manages gear items in categories with weight, description, and status
- [x] **GEAR-02**: User imports gear via CSV
- [x] **GEAR-03**: User reorders items and categories; bulk ops verify every id owned and stay under the D1 param cap

### Lists

- [x] **LIST-01**: User builds lists of gear with base/worn/consumable weight totals
- [x] **LIST-02**: User packs a list in pack mode with a progress counter
- [x] **LIST-03**: User duplicates lists, creates from selection, and imports list CSVs

### Public Shares

- [x] **SHARE-01**: Anyone can view a shared list read-only at /r/:slug; unknown slug and unshared list are the same 404; response is a strict allowlist DTO
- [x] **SHARE-02**: A shared list with an attached food plan carries food weight as `{ weightGrams, incomplete } | null`

### Settings

- [x] **SET-01**: User downloads all their data as an archive (takeout, incl. food-data.json v4)
- [x] **SET-02**: User deletes their account with type-to-confirm; all owned data cascades away
- [x] **SET-03**: User lists, renames, and deletes passkeys (delete fresh-gated; rename ungated)

### Security

- [x] **SEC-01**: Every API route has an authz-matrix row with owner/non-owner/anon tests before it ships
- [x] **SEC-02**: Unsafe non-auth requests require the CSRF header + matching Origin; every response carries the shared security headers
- [x] **SEC-03**: /api/auth/* is rate-limited per the documented contract, fail-closed across all methods

### Food Planning

- [x] **FOOD-01**: User manages an account-wide foods library at /food (Foods | Plans tabs)
- [x] **FOOD-02**: User builds standalone food plans (days, meals, entries); a plan backs at most one list; reuse is duplication
- [x] **FOOD-03**: An attached plan projects a derived Food weight row on its list; food is never a list_items row
- [x] **FOOD-04**: Pack mode includes a per-food checklist; the toggle is a CAS on the observed plan id with the three lifecycle rules
- [x] **FOOD-05**: User imports/exports food data via CSV; takeout includes the full food graph
- [x] **FOOD-06**: User sets daily and per-meal nutrition targets with grading; account defaults snapshot onto new plans

## v1.1 Requirements (Active backlog)

The only known future work - explicitly deferred by the shipped design docs.

### Food Summary

- [ ] **SUMM-01**: Plan detail shows all-days summary strips (food-planning-design.md section 13; deferred from slice 7b v1, "deferred, not dead")

### Visual Parity

- [ ] **VIS-01**: Action controls use blue, not emerald (design-token drift corrected)
- [ ] **VIS-02**: Mono-numeric and kebab-target design-token gaps closed

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Self-hosted port (Pi/Hetzner) | Standing portability constraint, not scheduled work; pragmas documented |
| Email OTP | LOCKED non-goal (passwordless ADR) |
| Password auth | LOCKED; teardown irreversible (migration 0006) |
| Offline queue / SW cache / PWA | Deliberately removed; online optimistic updates only |
| Public-share copy affordances | Public shares are read-only (PR #72 revert) |
| Cross-tab teardown on account delete | Confirmed won't-fix; other tabs 401 on next request |
| Richer public food share | Weight-only by design; additive later if wanted |
| Sample-plan onboarding, diff-based targets save, stored "off" rows | Deliberate non-ports from the legacy version |
| Distinct need_to_buy / loaned_out badges | Shared badge intentional (locked in gear-status.test.ts) |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PLAT-02 | Phase 1 | Complete |
| PLAT-03 | Phase 1 | Complete |
| PLAT-01 | Phase 2 | Complete |
| GEAR-01 | Phase 3 | Complete |
| GEAR-02 | Phase 3 | Complete |
| GEAR-03 | Phase 3 | Complete |
| LIST-01 | Phase 3 | Complete |
| LIST-02 | Phase 3 | Complete |
| LIST-03 | Phase 3 | Complete |
| SHARE-01 | Phase 4 | Complete |
| SET-01 | Phase 4 | Complete |
| SET-02 | Phase 4 | Complete |
| AUTH-01 | Phase 5 | Complete |
| AUTH-02 | Phase 5 | Complete |
| AUTH-03 | Phase 5 | Complete |
| AUTH-04 | Phase 5 | Complete |
| AUTH-05 | Phase 5 | Complete |
| SET-03 | Phase 5 | Complete |
| SEC-01 | Phase 6 | Complete |
| SEC-02 | Phase 6 | Complete |
| SEC-03 | Phase 6 | Complete |
| FOOD-01 | Phase 7 | Complete |
| FOOD-02 | Phase 7 | Complete |
| FOOD-03 | Phase 7 | Complete |
| FOOD-04 | Phase 7 | Complete |
| FOOD-05 | Phase 7 | Complete |
| FOOD-06 | Phase 7 | Complete |
| SHARE-02 | Phase 7 | Complete |
| VIS-01 | Phase 8 | Pending |
| VIS-02 | Phase 8 | Pending |
| SUMM-01 | Phase 9 | Pending |

**Coverage:**
- v1 (shipped baseline): 28 total, 28 mapped, 0 unmapped
- v1.1 (active backlog): 3 total, 3 mapped, 0 unmapped

---
*Requirements defined: 2026-07-19*
*Last updated: 2026-07-19 after ingest-based project initialization*
