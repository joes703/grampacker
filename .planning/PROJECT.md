# grampacker

## What This Is

An ultralight backpacking gear + food planning app at grampacker.app. Single
operator (Joe), no external users. This repo is the completed rewrite of the
legacy Supabase version onto Cloudflare Workers + D1 (SQLite) with Hono,
Drizzle, better-auth, and a React/Vite SPA - deliberately portable to a
self-hosted SQLite deployment (Pi/Hetzner).

## Core Value

The rewrite serves grampacker.app at zero infrastructure cost with the legacy
Supabase version retired. If everything else fails, the app must keep serving
at zero cost from the operator's own control.

## Requirements

### Validated

Shipped to production and verified as-built (rewrite complete 2026-07-19).
See .planning/REQUIREMENTS.md for the full ID'd list; highlights:

- Passkey-primary auth with magic-link recovery; passwords removed (irreversible)
- Gear/categories/lists with CSV import, reorder, duplication
- Read-only public shares at /r/:slug with a strict allowlist DTO
- Standalone food plans (one plan per trip), derived Food weight on lists,
  pack-mode food checklist, food weight on public shares
- Nutrition targets (daily + per-meal) with grading and account defaults
- Settings: takeout (full data download), passkey management, account deletion
- Route authz matrix, CSRF, security headers, fail-closed rate limiting
- CI deploy: merge to main deploys and applies remote D1 migrations

### Active

- [ ] All-days summary strips on the food-plan detail page
  (food-planning-design.md section 13; deferred from slice 7b v1)
- [ ] Visual parity: action color drift emerald -> blue
- [ ] Visual parity: mono-numeric and kebab-target design-token gaps closed

### Out of Scope

- Self-hosted port (Pi/Hetzner) - portability is a standing constraint kept
  alive in every change (SQLite pragmas documented in docs), not scheduled work
- Email OTP - LOCKED non-goal; a 6-digit code is more user work than a link
- Password auth in any form - LOCKED; teardown (migration 0006) has no rollback
- Offline queue / service worker / PWA - removed deliberately; online
  optimistic updates only
- Public-share gear copy - reverted in PR #72; public shares are read-only
- Cross-tab session teardown on account delete - confirmed won't-fix; other
  tabs 401 on next request
- Richer public food share (per-day/per-meal views) - share carries one
  weight number by design; additive later if ever wanted
- Sample-plan onboarding, diff-based targets save RPC, stored "off" target
  rows - deliberate non-ports from the legacy version
- Distinct badges for need_to_buy vs loaned_out - shared badge is intentional

## Context

- Stack: Cloudflare Workers + D1 (SQLite), Hono, Drizzle, better-auth
  (passkey + magic-link plugins), React/Vite SPA, Resend for mail
- Deploy: merge to main = CI deploy (.github/workflows/deploy.yml), which
  applies remote D1 migrations BEFORE deploying; squash-only merges
- Source-of-truth docs: docs/authz-matrix.md (normative per-route contract),
  docs/food-planning-design.md (food domain spec), docs/passwordless-auth-design.md
  (locked ADR), SECURITY.md, AGENTS.md (agent conventions and traps)
- No external users; single operator's real data lives in prod
- Verification: .claude/skills/verify (Playwright against local dev, incl.
  headless WebAuthn); passkeys cannot be tested on *.pages.dev previews
  (rpId is grampacker.app)

## Constraints

- **Cost**: Zero infrastructure cost - free tiers only (Workers, D1, Resend
  free tier is the whole mail path; accepted availability risk)
- **Portability**: No CF-only primitives in domain logic; must remain portable
  to self-hosted SQLite (required pragmas documented)
- **D1 limits**: Max 100 bound params/query - no unbounded inArray; chunked
  writes (floor(90/columns)), owned-set membership for prechecks; low
  compound-SELECT cap
- **Authz discipline**: Every API route gets an authz-matrix row BEFORE it
  ships, with owner/non-owner/anon tests; row-less routes fail review
- **Projection contract**: ONE canonical pure projection function in shared/
  for food math; full precision through the math, round ONCE at the DTO
  boundary; public and authenticated totals byte-identical
- **Caps**: 1000 foods/user, 60 days/plan, 20 meals/plan, 2000 entries/plan,
  100 plans/user, 100 lists/user
- **Deploy = merge**: A merge to main is a deploy and applies remote D1
  migrations; destructive changes are flagged before merging
- **Supply chain**: npm ci only; lockfile checked in; squash-only merges

## Key Decisions

<decisions locked="true">

The 11 passwordless-auth decisions from docs/passwordless-auth-design.md are
LOCKED - shipped 2026-07-12 with no rollback path (credential rows deleted,
reset tokens purged, fresh_auth dropped in migration 0006). No lower-precedence
source may override them. Full text: .planning/intel/decisions.md.

1. Passkey-primary + magic-link-recovery; passwords removed (config AND rows)
2. No email OTP
3. Onboarding is magic-link-first, then passkey enrollment;
   registration.requireSession stays true; "not fully set up" is derived state
4. Fresh auth = session age; fresh_auth table and /api/me/reauth deleted
5. freshAge = 24h, set explicitly in config
6. Fresh-gated set = "changing which credentials can sign in"; rename ungated
7. Magic link is the hardened root of trust (hashed token, 5 min, single-use,
   fragment-carried, gesture-verified, no enumeration)
8. Magic-link rate limiting: three buckets, charge order IP -> email -> global;
   HMAC'd lowercased untrimmed address key; our Hono limiter is the only one
9. Destructive teardown shipped separately after cutover; irreversible
10. Resend free tier as the whole recovery path: accepted risk
11. Lockout worst case accepted (all passkeys + mailbox lost = unrecoverable);
    WebAuthn user verification enforced by our hooks, not the plugin

</decisions>

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| One food plan per trip; reuse = duplication (migration 0010) | A menu is a per-trip decision; cross-trip propagation was an ambush | ✓ Good |
| Food is never a list_items row | Derived at read time; storing it is a voluntary cache-invalidation bug | ✓ Good |
| lists.food_plan_id FK is NO ACTION composite (not SET NULL) | SQLite has no column-list SET NULL; skipped detach fails loudly | ✓ Good |
| food_pack_state: row presence = packed; toggle is CAS on observed plan id | Cross-plan bleed is a wrong answer, not a stale one; ABA accepted | ✓ Good |
| Public share food = one nullable {weightGrams, incomplete} | Shakedown culture consumes food as one number; richer share additive later | ✓ Good |
| Nutrition targets: "off" is unrepresentable (absent row); save is full replace | Uniform model; no mode='off' crossing the wire | ✓ Good |
| Plan creation snapshots target defaults by value | Editing defaults never mutates existing plans | ✓ Good |
| Merge to main = deploy (CI-only; prod token lives only in GitHub secrets) | One gate; no local deploy path to leak credentials | ✓ Good |
| Offline support removed entirely | Queue + SW cache complexity not worth it for this app | ✓ Good |
| Public shares are read-only (gear-copy reverted, PR #72) | Copy affordances on anon surface not wanted | ✓ Good |
| TS7 upgrade deferred | Repo is TS-6-ready; bump only when Joe says | - Pending |

---
*Last updated: 2026-07-19 after new-project ingest (rewrite complete, PR #83)*
