# Roadmap: grampacker

## Overview

The core journey is already complete: a full rewrite of grampacker from
Supabase onto Cloudflare Workers + D1 (Hono, Drizzle, better-auth, React/Vite),
shipped incrementally to production between 2026-07-07 and 2026-07-19 and
finished with the food-planning targets frontend (PR #83). Phases 1-7 below
record that shipped work as the as-built baseline; they were executed pre-GSD
via reviewed PRs, not GSD plans. The only remaining known work is the v1.1
polish backlog the design docs explicitly deferred: visual-parity/design-token
cleanup and all-days summary strips. The potential self-hosted port stays a
standing constraint, not a scheduled phase.

## Milestones

- ✅ **v1.0 Rewrite** - Phases 1-7 (shipped 2026-07-19)
- 📋 **v1.1 Polish** - Phases 8-9 (planned, not started)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Platform Foundation** - Workers/D1/Hono/Drizzle scaffold with CI merge-to-main deploy
- [x] **Phase 2: Auth and Production Cutover** - better-auth live at grampacker.app, Supabase out of the request path
- [x] **Phase 3: Gear and Lists** - gear/categories/lists with CSV, reorder, duplication, pack mode
- [x] **Phase 4: Public Shares and Settings** - read-only /r/:slug, takeout, account deletion
- [x] **Phase 5: Passwordless Auth Migration** - passkey-primary + magic-link recovery; passwords destroyed
- [x] **Phase 6: Security Hardening** - authz matrix, CSRF, headers, fail-closed rate limiting
- [x] **Phase 7: Food Planning and Nutrition Targets** - the full food domain, slices 1-7
- [ ] **Phase 8: Visual Parity and Design Tokens** - emerald -> blue action color, token gap cleanup
- [ ] **Phase 9: All-Days Summary Strips** - deferred section-13 plan-detail summaries

## Phase Details

<details>
<summary>✅ v1.0 Rewrite (Phases 1-7) - SHIPPED 2026-07-19</summary>

### Phase 1: Platform Foundation
**Goal**: The app builds, runs, and deploys itself from a single repo with zero-cost infrastructure
**Depends on**: Nothing (first phase)
**Requirements**: PLAT-02, PLAT-03
**Success Criteria** (what must be TRUE):
  1. Merging to main deploys the Worker and applies remote D1 migrations automatically
  2. One local dev server serves SPA + /api + local D1
  3. Schema is Drizzle-managed and portable to plain SQLite (pragmas documented)
**Plans**: Shipped pre-GSD (reviewed PRs, phases 1-2 of the rewrite plan)
**Status**: Complete (2026-07-08)

### Phase 2: Auth and Production Cutover
**Goal**: grampacker.app is served by the rewrite; the Supabase version is out of the request path
**Depends on**: Phase 1
**Requirements**: PLAT-01
**Success Criteria** (what must be TRUE):
  1. grampacker.app resolves to the Workers deployment; sign-in works at the apex
  2. Sessions persist across browser refresh
  3. Infrastructure cost is zero (free tiers only)
**Plans**: Shipped pre-GSD (cutover PRs, prod smoke-verified)
**Status**: Complete (2026-07-08)

### Phase 3: Gear and Lists
**Goal**: The core gear-planning workflow works end to end
**Depends on**: Phase 2
**Requirements**: GEAR-01, GEAR-02, GEAR-03, LIST-01, LIST-02, LIST-03
**Success Criteria** (what must be TRUE):
  1. User manages categorized gear with weights and status, including CSV import
  2. User builds lists with base/worn/consumable totals
  3. User reorders items and categories; bulk operations stay under the D1 100-param cap
  4. User packs a list in pack mode with a progress counter
  5. User duplicates lists and creates lists from a gear selection
**Plans**: Shipped pre-GSD (PRs #19-#28, migration 0004)
**Status**: Complete (2026-07-09)
**UI hint**: yes

### Phase 4: Public Shares and Settings
**Goal**: Lists are shareable read-only, and the user owns their data lifecycle
**Depends on**: Phase 3
**Requirements**: SHARE-01, SET-01, SET-02
**Success Criteria** (what must be TRUE):
  1. Anyone can view a shared list at /r/:slug; unknown slug and unshared list are the same 404
  2. The share response never leaks private fields (allowlist enforced field-by-field, forbidden-key tests)
  3. User downloads all their data as an archive from Settings
  4. User deletes their account with type-to-confirm; all owned rows cascade away
**Plans**: Shipped pre-GSD (PRs #29-#34)
**Status**: Complete (2026-07-10)
**UI hint**: yes

### Phase 5: Passwordless Auth Migration
**Goal**: Passkey-primary authentication with magic-link recovery; passwords cease to exist
**Depends on**: Phase 4
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, SET-03
**Success Criteria** (what must be TRUE):
  1. User signs in with a passkey; the magic link is the only recovery path
  2. No password hash exists anywhere (config removed AND rows deleted; migration 0006, no rollback)
  3. Changing which credentials can sign in requires a session younger than 24h; rename is ungated
  4. Magic-link send charges three rate buckets (IP -> email -> global); the token is hashed, 5-minute, single-use, fragment-carried
  5. User manages passkeys from Settings (list, rename, fresh-gated delete)
**Plans**: Shipped pre-GSD (PRs #46-#51; teardown deployed 2026-07-12)
**Status**: Complete (2026-07-12)

### Phase 6: Security Hardening
**Goal**: Every surface has an explicit, tested authorization and abuse contract
**Depends on**: Phase 5
**Requirements**: SEC-01, SEC-02, SEC-03
**Success Criteria** (what must be TRUE):
  1. Every API route has an authz-matrix row driving owner/non-owner/anon tests; row-less routes fail review
  2. Unsafe non-auth requests require the x-grampacker-request header + matching Origin; every response carries the security-header map
  3. /api/auth/* rate limiting is fail-closed across all methods; the global mail quota is guarded
**Plans**: Shipped pre-GSD (authz matrix + review-fix batch, PRs through 2026-07-12)
**Status**: Complete (2026-07-12)

### Phase 7: Food Planning and Nutrition Targets
**Goal**: Trip food is planned, weighed, packed, shared, and graded alongside gear
**Depends on**: Phase 6
**Requirements**: FOOD-01, FOOD-02, FOOD-03, FOOD-04, FOOD-05, FOOD-06, SHARE-02
**Success Criteria** (what must be TRUE):
  1. User manages an account-wide foods library and standalone plans at /food (days, meals, entries)
  2. A plan backs at most one list; attaching a held plan is 409; reuse is duplication with fresh ids
  3. An attached plan projects a derived Food weight row on its list; food is never a list_items row; public and authenticated totals are byte-identical
  4. Pack mode includes a per-food checklist whose toggle is a CAS on the observed plan id (no cross-plan bleed)
  5. Public shares carry food weight as { weightGrams, incomplete } | null
  6. User sets daily and per-meal nutrition targets with grading; defaults snapshot onto new plans; takeout is v4
**Plans**: Shipped pre-GSD (slices 1-7, PRs #77-#83, migrations 0010-0012)
**Status**: Complete (2026-07-19)
**UI hint**: yes

</details>

### 📋 v1.1 Polish (Planned)

**Milestone Goal:** Close the two deferred items the shipped docs name - nothing else.

### Phase 8: Visual Parity and Design Tokens
**Goal**: The UI matches the design-token spec everywhere it drifted
**Depends on**: Phase 7 (shipped)
**Requirements**: VIS-01, VIS-02
**Success Criteria** (what must be TRUE):
  1. Action-colored controls render blue; no emerald action styling remains anywhere in the app
  2. Numeric displays use the mono-numeric token consistently
  3. Kebab-menu targets use the shared target token consistently
  4. A visual sweep of gear, lists, food, and settings surfaces shows no remaining token drift
**Plans**: TBD
**UI hint**: yes

Note: verify with the .claude/skills/verify browser skill (Playwright against
local dev) plus the existing visual-parity plan notes (2026-06-17).

### Phase 9: All-Days Summary Strips
**Goal**: Plan detail gives an at-a-glance per-day summary across the whole trip
**Depends on**: Phase 7 (shipped)
**Requirements**: SUMM-01
**Success Criteria** (what must be TRUE):
  1. The food-plan detail page shows a summary strip for every day of the plan (per food-planning-design.md section 13)
  2. Strip numbers obey the projection discipline: full precision through the math, round once at the boundary; incomplete propagates rather than reading as zero
  3. Strips stay correct after entry/meal/day mutations (coarse invalidation per section 5.5)
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 8 -> 9 (1-7 are shipped history).

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Platform Foundation | v1.0 | pre-GSD | Complete | 2026-07-08 |
| 2. Auth and Production Cutover | v1.0 | pre-GSD | Complete | 2026-07-08 |
| 3. Gear and Lists | v1.0 | pre-GSD | Complete | 2026-07-09 |
| 4. Public Shares and Settings | v1.0 | pre-GSD | Complete | 2026-07-10 |
| 5. Passwordless Auth Migration | v1.0 | pre-GSD | Complete | 2026-07-12 |
| 6. Security Hardening | v1.0 | pre-GSD | Complete | 2026-07-12 |
| 7. Food Planning and Nutrition Targets | v1.0 | pre-GSD | Complete | 2026-07-19 |
| 8. Visual Parity and Design Tokens | v1.1 | 0/TBD | Not started | - |
| 9. All-Days Summary Strips | v1.1 | 0/TBD | Not started | - |
