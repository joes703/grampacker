# grampacker rewrite plan: Supabase -> portable TypeScript + SQLite

Status: DRAFT for review (2026-07-07). Reviewer: challenge everything; open questions at the bottom.

## 1. Context and decision

- grampacker today: React SPA on Cloudflare Pages, browser -> PostgREST -> Supabase Postgres, no app server. RLS is the security boundary. Auth is Supabase GoTrue (email/password + passkeys).
- Drivers for leaving: Supabase stability concerns and free-tier pricing risk. Hard constraint: the replacement must cost nothing to run.
- Verified 2026-07-07: the app has no real users. Five auth accounts exist; four signed in exactly once at creation and never returned. Only the owner's account is active. Therefore: NO data migration workstream, NO cutover choreography, NO availability contract. Owner's data walks over via the app's own CSV export/import.
- This is an active learning/tinkering project, mobilized now. Once the rewrite reaches parity, the Supabase version is killed.
- Old repo will be renamed to `grampacker-supabase` (reference only). Fresh repo `grampacker` is the new home.

## 2. Goals and non-goals

Goals:
- Behavior parity with the current app per SPEC.md, minus deliberately dropped behaviors (see section 8).
- Zero-cost hosting on Cloudflare free tier (Workers + D1).
- Portability: the same codebase must run on a plain Node box (Hetzner VPS or Raspberry Pi behind Cloudflare Tunnel) with a SQLite file. Vendor exit = copy a file + swap a driver.
- Keep the React SPA and its tests nearly intact. The product IS the UI layer (DnD, optimistic updates, density system, import UX).

Non-goals (scope freeze):
- No new features until parity ships. Every "while we're at it" idea goes to PARKED.md.
- No offline support (previously removed, stays removed).
- No SSR / OG tags for shares (parked; the new server makes it possible later).

## 3. Target architecture

```
browser (React SPA) -> Hono API (same origin) -> SQLite
```

- One Cloudflare Worker serves BOTH the static SPA assets and the `/api/*` routes. Same origin: no CORS, cookie sessions work cleanly.
- The API middleware is now the security boundary (replacing RLS), and bypassing it must be hard BY CONSTRUCTION, not convention: handlers never import the DB factory or Drizzle schema (lint-enforced import boundary). A handler receives an authenticated context exposing only user-scoped repositories - `repos.forUser(session.userId).lists.update(...)`. Handlers never take a user id from the client. The public share endpoint is the sole anon path and goes through a dedicated public repository (section 6).
- SQLite schema keeps the current shape: FKs with ON DELETE CASCADE (composite where they encode same-owner integrity), CHECK constraints (worn_xor_consumable, length and weight caps), per-user resource caps enforced in the repository layer (SQLite triggers optional hardening).

Portability rules (enforced by convention + review):
1. Every multi-row mutation is written as "compute full plan, then apply atomically" - satisfies both D1 `batch()` (no interactive transactions) and real transactions on Node.
2. No long-lived-process assumptions: no in-memory caches, no background jobs, no local file writes. Workers constraints are the baseline; Node is the permissive superset.
3. All DB access goes through one factory module - the only file that knows whether it holds a D1 binding or a SQLite file path.
4. Cloudflare-only primitives (KV, Queues, Durable Objects, Workers Cache) are allowed only where losing them degrades (slower) rather than breaks (rewrite). Anything load-bearing must run on both targets.

## 4. Stack (pinned at scaffold, 2026-07-07; from npm dist-tags)

| Package | Pin | Note |
|---|---|---|
| hono | 4.12.28 | router/middleware; no v5 exists |
| @hono/node-server | 2.0.8 | Node target adapter |
| drizzle-orm / drizzle-kit | 1.0.0-rc.4 (`@rc`) | DELIBERATE RC: stable is 0.45.x, 1.0 has breaking changes; starting on 0.x means migrating a month in. Zero users makes RC churn acceptable. |
| better-auth | 1.6.23 | email/password, sessions, passkey plugin; 1.7 is a minor |
| wrangler | 4.107.0 | dev + deploy |
| vite | 8.1.3 | Rolldown era |
| vitest | 4.1.10 | v5 still beta; shallow upgrade later |
| typescript | 6.0.3 | TS 7 (native compiler) is at RC; trial `tsgo` side-by-side, adopt at GA. Compiler is swappable, ORM is not - hence opposite calls. |
| react / react-dom | 19.2.7 | transplant |
| @tanstack/react-query | 5.101.2 | transplant; keep query-key architecture |
| react-router | 8.1.0 | transplant (old repo already on 8.0.1) |
| tailwindcss | 4.3.2 | transplant |
| zod | 4.4.3 | NEW: request validation at every API boundary |
| eslint | 10.6.0 | jsx-a11y still caps at eslint 9; exclusion carries over |
| @dnd-kit/core 6.3.1 + sortable 10 + utilities 3 | transplant as-is | @dnd-kit/react is still 0.5.x; existing deferral stands |
| better-sqlite3 or node:sqlite | decide at Node-target time | not needed day one; drizzle 1.0 is growing node:sqlite support |

Known pothole: better-auth's CLI schema generator has an open interop issue with Drizzle 1.x output (better-auth#10317). Mitigation: hand-write the better-auth tables in our Drizzle schema (preferable anyway for migration hygiene).

## 5. What transplants vs what is written fresh

Transplant nearly intact (with their tests):
- All React feature surfaces: gear library, lists, list detail, pack mode, food planning UI, share view, settings UI.
- DnD system (dnd-kit classic), optimistic update helpers, flat-table density system, toast system, CSV parse/serialize (`src/lib/csv/`), import planning (`src/lib/queries/import-plan.ts` logic), weight math, caps constants.
- CSV parsing stays CLIENT-side (keeps Worker CPU trivial); the server receives structured, validated plans.

Written fresh:
- The Hono server: routes, session middleware, scoped repository layer, zod request/response DTO schemas living in `shared/` so SPA and server import the same contracts. ESLint import boundaries from day one: handlers cannot import the DB factory/schema, the SPA cannot import server internals, `shared/` holds only DTO schemas and constants.
- The Drizzle schema + migrations (SQLite dialect; same logical model).
- Auth: better-auth config, sign-in/up/reset/passkey flows (SPA auth pages adapt to better-auth's client).
- `src/lib/queries/` transport: fetchers now call `/api/*`; API responses are shaped to match the EXISTING TypeScript types (e.g. `ListItemWithGear` with embedded `gear_item`) so SPA changes stay minimal and cache keys/invalidation rules port unchanged.

## 6. Security model (new SECURITY.md written before the API grows past auth)

Principle (strengthened per external review, 2026-07-07): authorization must be hard to bypass by construction. No direct DB access from handlers, all outputs through DTO allowlists, all unsafe methods CSRF/origin-protected, all sensitive account actions require recent auth, every route gets an authorization test.

- Boundary by construction: handlers receive an authenticated context exposing only user-scoped repositories (`repos.forUser(session.userId)`). The DB factory and schema are importable only by the repository layer (ESLint import boundary, not just review discipline).
- Route authorization matrix: every route documents resource, auth mode (session / fresh-session / anon), ownership path (direct user_id or via parent), allowed methods, and returned DTO. The matrix DRIVES the test suite (section 7).
- Child-resource ownership: scoped repositories filter by user_id on every table (all child tables carry user_id today; that ports), and parent-path consistency (this item belongs to THIS list) is validated in the repository. Composite same-owner FKs port to SQLite as the structural backstop against cross-owner stitching (ADR 12 continuity).
- Sessions: better-auth cookie sessions - httpOnly, Secure, SameSite=Strict, session rotation on privilege changes, revocation on password change. Removes the current localStorage-token exposure. Bearer tokens are out of scope until a CLI/API consumer exists.
- CSRF, explicitly: same-origin only (no CORS headers at all), SameSite=Strict, strict Origin check on every unsafe method, PLUS a required custom request header on unsafe `/api/*` calls as belt-and-braces.
- XSS is still load-bearing: httpOnly cookies stop token theft, not same-origin actions performed by injected script. The existing discipline carries verbatim: CSP, react-markdown with no raw HTML, no dangerouslySetInnerHTML, no eval.
- Security response headers: the SET ports from today's `public/_headers` (CSP, X-Content-Type-Options, X-Frame-Options + frame-ancestors 'none', Referrer-Policy, Permissions-Policy, HSTS, COOP), but the OWNER changes - that file is a Pages convention and dies with Pages. One shared header map applied by the Worker to both the SPA shell and `/api/*` responses; an integration test asserts the set on an HTML route AND an API route so it cannot silently drop. The CSP gets simpler: connect-src loses the two Supabase origins (API is same-origin now); script-src keeps the Cloudflare insights beacon only if Web Analytics stays. Framing stays denied everywhere including the share page (that is today's behavior; revisit deliberately if embedding is ever wanted).
- Fresh-auth (parity with current app, rebuilt server-side): password change, email change, account deletion, and passkey management require recent auth proof verified on the server. A valid session alone is never sufficient for these routes.
- Public share (`GET /api/share/:slug`): the only anon route; served by a DEDICATED public-share repository with explicit DTO builders - never raw rows. Column allowlist ported from the current public views; tests assert private columns are ABSENT from responses; 404 for unknown AND inactive slugs (same anti-probing contract as today).
- Rate limiting: a portable DB-backed limiter is the canonical control (keyed by route + IP + normalized identifier where relevant; better-auth's built-in if it can be SQLite-backed, otherwise our middleware). Cloudflare WAF is additional hardening only - never the sole control (portability rule 4).
- Things Supabase silently provided that we now own: verification/reset token generation (better-auth), account-enumeration posture (keep current documented trade-offs), password hashing params, the above rate limiting.
- Passkeys: rpId stays `grampacker.app`. No credential migration needed (no users); owner re-registers.
- Caps and DB backstops: friendly client-side checks (existing) + authoritative repository checks + SQLite constraints (FKs incl. composite, UNIQUEs, CHECKs: worn_xor_consumable, lengths, weights) + cap triggers where cheap. App-layer checks give friendly errors; constraints catch programmer mistakes.
- Secrets: only the better-auth secret, as a Worker secret / env var. Nothing in the client bundle. Auth email (verification/reset) goes through Cloudflare Email Service's `send_email` binding - no API key exists at all. Email sits behind an `EmailSender` interface (portability rule 3, same as the DB factory): the Node target uses the service's REST API or a swapped Resend/SMTP implementation.
- External checklist: SECURITY.md is written against MDN's web security docs (https://developer.mozilla.org/en-US/docs/Web/Security - attacks / defenses / practical implementation guides) at phase 1, and re-swept before the public share ships (phase 4). Topic-level gap check done 2026-07-07: this section already covered the app-shaped topics (CSRF, IDOR, XSS, cookies, CORS posture, input validation, supply chain); the two deltas it surfaced were header ownership (bullet above) and the phase-7 DNS cleanup. Not applicable by construction, recorded so we do not re-litigate: SSRF (no user-controlled outbound URLs; auth email leaves via the send_email binding, not HTTP), SRI (all assets same-origin + content-hashed by Vite), mixed content (HTTPS-only + HSTS), local network access, user activation.

## 7. Testing strategy

- Transplanted UI tests keep running under vitest 4 (jsdom), largely unchanged - fetch-layer mocks replace supabase-js mocks.
- pgTAP is replaced by integration tests running the real API against real SQLite (@cloudflare/vitest-pool-workers with local D1, or the Node target in plain vitest). Same discipline as today: every mutation gets a happy-path AND a rejection-path test (authz, caps, validation, atomicity).
- Atomicity tests: mid-plan failure in an import leaves zero partial rows.
- Authorization tests, driven by the route authz matrix: EVERY route gets owner / non-owner / anon cases; child routes get cross-parent stitching attempts; the public share endpoint gets private-column ABSENCE assertions; fresh-auth routes get valid-but-stale-session rejection cases.
- DTO schema tests: API responses validate against the shared zod DTOs (shape drift fails CI, not the UI).
- Cap tests include concurrent-ish mutation attempts (parallel requests racing the same cap).
- CI: GitHub Actions - build, lint, test, security checks. Supply-chain posture ports verbatim: `npm ci`, `ignore-scripts=true`, actions pinned to SHAs, no `pull_request_target`, lockfile committed.

## 8. Behavior audit (keep / drop / change)

Process: SPEC.md is copied into the new repo and annotated section-by-section AT PORT TIME (cheapest moment of honest evaluation). DECISIONS.md ADRs get re-affirmed or retired the same way. Cruft is behavior, not just code.

Early candidates to discuss during review (not decided):
- worn/consumable both-set-on-import silently clears both (SPEC calls it "a known oddity") - keep or reject-with-message?
- `is_ready` / ready-checks feature - earning its keep?
- The 62-char slug + no-regenerate rule - keep (simple) or revisit?
- Weight-unit localStorage persistence and display rules - keep as-is (documented, tested).

## 9. Sequence (tracer-bullet phases, each ending green)

0. Scaffold: wrangler + Hono serving static assets + Vite SPA shell + Drizzle rc.4 + local D1. `npm run dev` runs everything, no Docker. Commit STACK.md + PARKED.md.
1. Auth: better-auth wired (email/password first), session middleware, SPA auth pages adapted. Includes ONE small protected resource (user profile/settings read+write) to prove the scoped-repo + authz-matrix + per-route-test pattern BEFORE any real surface ports - gear-first risked baking in unsafe repository habits. Import-boundary lint rules land here too. Passkeys after sessions prove out.
2. Gear library end-to-end: schema (categories, gear_items), repository, routes, transplant GearLibraryPage + tests, reorder endpoint, CSV import/export. This is the proving slice for the whole transplant strategy.
3. Lists + list items + pack mode (embedded gear_item response shape, quantity/worn/consumable/packed semantics, reorder).
4. Public sharing (`/r/:slug` view + anon endpoint + projection allowlist).
5. Food planning (largest port: plans, days, meals, entries, targets, pack state, public projections; atomic multi-add as plan+batch).
6. Settings/account: password change (re-auth proof), delete account, passkey management.
7. Owner data walk-over via CSV export/import (dogfoods the import path), deploy to grampacker.app, kill the Supabase project + Pages site - INCLUDING the Pages custom-domain binding and any DNS records pointing at the dead `*.pages.dev` project (a dangling CNAME is the subdomain-takeover class). Old repo stays as read-only reference.

Docs-as-we-go: STACK.md at phase 0; SECURITY.md during phase 1; SPEC.md annotations at each phase; ADMIN_RUNBOOK.md replacement at phase 7.

## 10. Deployment

- Primary: Cloudflare Workers (free tier), single Worker, D1, `wrangler deploy`.
- Proven exit hatch (later, optional): same repo on a Node box (Pi behind Cloudflare Tunnel, or Hetzner) with a SQLite file + Litestream replication to R2. Standing goal: this deployment should always work; it is the anti-lock-in proof.
- D1 note: rows-read billing counts SCANNED rows, so covering indexes matter for billing as well as speed. Index review is part of each schema phase.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Drizzle rc.4 churn before GA | zero users; pin exact rc, upgrade deliberately; schema is small |
| better-auth CLI x Drizzle 1.x interop | hand-write auth tables in our schema |
| D1 batch-only transactions | portability rule 1 (plan-then-atomic-apply); atomicity tests |
| Workers CPU limits | CSV parsing stays client-side; server handles only structured writes |
| Session/CSRF mistakes (new territory) | SECURITY.md before code; better-auth defaults; integration tests per route class |
| better-auth acquired by Vercel (announced 2026-07-07) | Net positive for framework longevity (monetization pressure removed, Auth.js consolidated, bigger team; MIT + in-process + auth tables in OUR schema = no hosted dependency, fork is the floor). Watch item: Vercel/Cloudflare rivalry could slow Workers-runtime attention; mitigated by pinned versions + Workers-pool integration tests gating every upgrade. |
| Cloudflare Email Sending is beta | Only auth email depends on it, sent exclusively to verified destination addresses (free on all plans, no quota; the verification step doubles as the invite gate for a gated-registration app). EmailSender interface makes Resend/SMTP a one-file swap if the beta shifts terms. |
| Scope creep | PARKED.md + parity-first rule |
| Food-planning port size | it is phase 5, after the pattern is proven on three simpler surfaces |

## 12. Decisions from external review (Codex, 2026-07-07) - formerly open questions

1. API response shapes: keep PostgREST-like shapes as EXPLICIT DTOs (zod-schema'd in `shared/`, schema-tested), decoupled from storage. Internal storage may normalize freely; the DTO is the contract.
2. Cookie sessions: adopted. httpOnly + Secure + SameSite=Strict, session rotation, revocation on sensitive changes, CSRF custom header. Bearer tokens deferred until a CLI/API consumer exists.
3. Rate limiting: portable DB-backed limiter is canonical; Cloudflare WAF is hardening on top, never the only control.
4. Caps: repository checks AND SQLite constraint/trigger backstops; concurrent-ish integration tests required.
5. Phase order: auth-first confirmed; phase 1 proves the scoped-repo pattern on one trivial protected resource before gear ports.
6. Port map for mechanisms that do not carry over: RLS policies -> scoped repositories + route authz matrix + per-route tests; public SQL views -> public-share repository + DTO allowlists + absence tests; SECURITY DEFINER functions -> repository-internal privileged operations with inline checks; Supabase auth dashboard knobs -> better-auth config in version control; fresh-auth RPC proofs -> server-side recent-auth checks; pgTAP authz coverage -> API integration tests in the Workers pool.
7. Layout: single package - `src/` (SPA), `server/` (Hono), `shared/` (DTO schemas + constants) - with ESLint import boundaries from day one. Workspaces only if real pain appears (e.g., at Node-target packaging time).

## 13. Later decisions

1. (2026-07-07) Auth email: Cloudflare Email Service instead of Resend. Rationale: sends to verified destination addresses are free on ALL plans with no quota, and grampacker's only recipients are its account holders - verifying each account email doubles as the invite gate. The `send_email` Workers binding needs no API key (secret count drops to one); a REST API keeps the Node target viable. Beta status is accepted because the blast radius is one recoverable email type and the `EmailSender` interface makes Resend/SMTP a one-file swap (risk table). Vendor surface shrinks to Cloudflare + GitHub.
