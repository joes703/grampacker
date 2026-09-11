# Engineering audit — 2026-09-10

| | |
| --- | --- |
| Audit date | 2026-09-10 |
| Audited baseline | `373cf05` |
| Branch | `main` |
| Primary reviewer | Claude |
| Independent reviewer | OpenAI Codex |
| Status | baseline audit, pre-remediation |

**This document records the state of the repository at `373cf05`.** It is a
dated record, not a binding document: it is evidence about what the code looked
like on that commit and is not automatically authoritative for later code.
Every finding below must be revalidated against the current tree before being
acted on. Remediation is tracked separately; this file is not updated to match
later reality.

---

# Grampacker engineering audit — 2026-09-10

Read-only pass over `main @ 373cf05`. Nothing in the repo was modified. Three independent Codex read-only reviews (correctness / security / architecture) ran in parallel with my own; every Codex claim below was verified against the code or `node_modules` before it was kept, and the two places where I disagree with Codex's severity are called out.

## Executive assessment

**This is a well-engineered application, and unusually so for a solo, AI-assisted codebase.** The authorization boundary is real and enforced by construction (lint-fenced repository layer, user-scoped repos, composite same-owner FKs, per-route owner/non-owner/anon tests). Every multi-row write is a single D1 batch. The migration pipeline is guarded against the one class of incident that actually happened. Baseline health is fully green: typecheck, lint, 1264 unit tests, 284 API tests on real workerd+D1, the migration harness, YAML, and action pins all pass.

There are **no P0 findings**. There is **one P1**: the List-view drag planner includes worn rows that the view hides, so an ordinary drag on any list with worn gear lands off-position and silently rewrites worn items' document order (which is also the public-share order). Everything else is P2/P3: a handful of narrow concurrency/failure-path defects the sequential tests cannot see, two log-hygiene/fail-open hazards, an unverified platform limit that two parts of the repo describe differently, and a moderate amount of *prose* cruft (stale comments and one stale binding doc) over a small amount of *code* cruft.

The dominant engineering risk is not correctness — it is the **weight of explanatory prose and hand-rolled tooling relative to product code**: a 2,743-line page component, a 4,436-line untyped migration harness, and comments that have drifted from behavior in several places, including one that the P1 defect hides behind.

---

## Phase 2 — Baseline health

| Check | Result |
|---|---|
| `npm run typecheck` (`wrangler types && tsc -b`) | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test:unit` | 126 files / 1264 tests pass, 24.8 s |
| `npm run test:api` (workerd + D1) | 19 files / 284 tests pass, 24.8 s |
| `vite build` | exit 0; Worker bundle 1.89 MB (410 KB gz), client entry 258 KB |
| `npm run test:migrations` | 8 post-baseline migrations preserve seeded data, exit 0 |
| `npm run check:yaml`, `check:action-pins` | exit 0 (6 pins verified upstream) |
| `npm audit` | 7 advisories (1 moderate, 6 high) — **all in the dev-only Cloudflare/miniflare/sharp/browserslist toolchain**; nothing ships to the Worker or client. `npm audit fix --force` is correctly banned (AGENTS.md). |

No flaky tests, no warnings beyond the proxy notice from wrangler. `npm ci` was not re-run (node_modules already matched the lockfile; `npm ls` shows a single wrangler/miniflare/workerd and the one documented nested zod).

---

## Detailed findings

Categories: **CD** confirmed defect · **ER** significant engineering risk · **MD** maintainability/design · **TG** test/verification gap · **PC** possible concern needing more info · **MC** minor cleanup.

### F1 · P1 · CD · confidence high — List-view reorder plans against rows the view does not render
- **Where:** `src/lists/ListDetailPage.tsx:306-309` (`planListItemReorder`, category branch) vs `src/lists/CategoryGroup.tsx:394`.
- **What it does:** `CategoryGroup` excludes worn rows from every ordinary section in *both* modes (`sectionItems = items.filter(!isWorn)`); worn gear renders only in the trailing Worn section. The planner's category branch excludes worn rows only when `mode === 'pack'`, and its comment asserts "List view genuinely renders worn rows inside their categories" — which is false.
- **Why it matters:** In List view, `arrayMove` runs over an array containing hidden worn rows, and `assignSortOrderSlots` redistributes `sortOrder` across them. Two effects: the dropped row lands offset from where it was released whenever a hidden worn row sits between source and target, and worn rows acquire new `sortOrder` values the user never touched — reordering the Worn section (which sorts by document order, `src/lib/use-stable-worn-items.ts:43`) and the public share.
- **Consequence:** Wrong-looking drops and silent reshuffles on any list with worn gear — the everyday case for backpacking lists. Non-destructive, but persisted.
- **Direction:** Exclude worn rows from the category branch in both modes (the pack branch already does, for exactly this reason); fix the comment; add a regression with interleaved worn ranks across two categories.
- **Codex:** independently found (A03 arch), with a reproduction against the extracted planner.

### F2 · P2 · CD · high — Account deletion misses mixed-case pending magic links
- **Where:** `server/repos/users.ts:69` (`purgeVerificationArtifacts`, `json_extract(value,'$.email') = ${email}`).
- **What it does:** Purges pending links by comparing the stored JSON email to the (lowercased) user row email. The installed magic-link plugin stores the *submitted* casing (`better-auth/dist/plugins/magic-link/index.mjs:74-80`), while the adapter lowercases on user create/lookup (`internal-adapter.mjs:127,146,570`).
- **Why:** A link requested as `Alice@x.com` survives deletion of `alice@x.com`; SECURITY.md ("Fresh auth") promises the opposite. The delete test's counting predicate uses the same case-sensitive comparison (`server/auth-delete-user.test.ts:149`), so it cannot see the survivor.
- **Consequence:** Within the 5-minute token life, redeeming the surviving link recreates an empty account — the documented guarantee is false for mixed-case requests. No data resurrection.
- **Direction:** Compare `lower(json_extract(...)) = lower(?)`; add an HTTP-level regression that requests a mixed-case link, deletes, then redeems.
- **Codex:** found by both the security and correctness passes (SEC-02, C2); I verified in `node_modules`.

### F3 · P2 · PC/ER · medium — Per-row statement batches at DTO maxima vs an unverified D1 per-invocation limit
- **Where:** `server/repos/gear-items.ts:218-245` (`importBatch`: up to 500 category + 500 item INSERTs = 1,000 statements in one batch); `server/repos/lists.ts:693` (`importFromCsv`: 1 + 300 + 300 + 300); `lists.ts:514` (`duplicate`: `list_food_item_slots` links chunked 22/statement → up to ~819 statements for a fully-scheduled 30-day, 200-item list, plus ~100 more); `categories.ts`/`gear-items.ts`/`list-items.ts`/`lists.ts` `reorder` (one UPDATE per entry, and `useReorderable` sends the *whole* array, so a lists-page drag is N statements).
- **Why:** The repo holds two contradictory beliefs about the same platform fact. `docs/incidents.md` ("D1: the queries-per-invocation limit") reads the limit as subrequest-scoped, "one `db.batch` = one call". `server/repos/pack-reorder.ts:302` says "D1 counts every batch statement against its ~1000 queries-per-invocation ceiling" and that belief drove the json_each chunking of the pack reorder. Only one can be right, and the import/duplicate/reorder paths were designed under the first while the reorder path was redesigned under the second. AGENTS.md itself says "suspect this limit first when a large batch fails in prod" and incidents.md admits "no maxed-out duplicate has been wire-verified in prod." Miniflare does not enforce the limit, so the green 500-item tests prove nothing about it.
- **Consequence:** If per-statement counting is right, a contract-valid maximum import (or a max duplicate) fails in production with an opaque D1 error and rolls back — not data loss, but a hard wall the DTO promises won't exist. If batch counting is right, the pack-reorder chunking was unnecessary complexity.
- **Direction:** Settle the platform fact once (a prod-tier experiment or Cloudflare support), record it in AGENTS.md as a platform fact, and either chunk the import/duplicate inserts into multi-row statements (the `max(sortOrder)+1` subquery can become `base + i`) or delete the belief that motivated the reorder chunking.
- **Codex:** correctness pass raised the same exposure (V1) with the same "verification gap, not confirmed failure" framing.

### F4 · P2 · CD · high — Bound SQL parameters are written to logs verbatim
- **Where:** `server/middleware/error-handler.ts:102-131` (`recordIncident` logs `message` and `stack`); `node_modules/drizzle-orm/errors.js:10` (`DrizzleQueryError` message is `Failed query: ${query}\nparams: ${params}`); `server/auth.ts` sets no `logger`, so better-auth's default console logger logs raw errors from session lookups (`better-auth/dist/api/routes/session.mjs:224`).
- **Why:** `server/repos/db-errors.ts` already knows the wrappers embed params (that is why it matches root causes only) — but the *logger* does not scrub them. A failed gear/list write logs names, descriptions, costs; a failed session lookup during a D1 outage logs the session token as a bound param via better-auth's own logger.
- **Consequence:** Private data and, in the outage case, live session tokens in Workers Logs. Single-user today, so exposure is to whoever reads the dashboard — but the log budget exists precisely because outages are when logs get read.
- **Direction:** Log the root-cause message (the SQLite text never embeds values) plus the Drizzle `query` without `params`; truncate/skip the first stack line; pass a `logger` to better-auth with the same policy; add a test asserting a representative bound value never appears in captured `console.error`.
- **Codex:** SEC-01; verified.

### F5 · P2 · ER · high — Email delivery fails open when the production secret is absent
- **Where:** `server/email/index.ts:21-25`; `server/env.d.ts` declares `RESEND_API_KEY?`.
- **What it does:** Any missing/empty key selects `ConsoleEmailSender`, which `console.log`s the full redeemable magic-link URL and resolves success.
- **Why:** A dropped or rotated-away secret turns the only account-recovery path into "sign-in reports success, sends nothing, and writes session-minting URLs to logs." Nothing distinguishes dev from prod here; `isDevEnvironment` (hostname === localhost) exists in `security-headers.ts` and is not consulted.
- **Consequence:** Silent, hard-to-diagnose lockout plus token disclosure — only after a misconfiguration, but with no fail-closed backstop.
- **Direction:** Gate the console sender on the dev origin (or an explicit `EMAIL_TRANSPORT=console` var) and throw in production when the key is absent.
- **Codex:** SEC-03.

### F6 · P3 · CD · high — `setDayCount` reads outside the batch that writes
- **Where:** `server/repos/food.ts:254-307`.
- **What:** Missing slots are computed in JS from a read, then inserted alongside the trim in one batch. Two concurrent day-count changes (5→7 and 5→3) leave days 1-3 and 6-7 with a hole; two concurrent expansions collide on `list_food_slots_day_meal_unique` and surface as an unclassified 500.
- **Context:** SECURITY.md already accepts concurrent food edits as an unguarded class (trim / reschedule / remove); this is a fourth path in that class that the entry does not list. Self-heals on the next day-count write (the contract repairs holes).
- **Direction:** Add it to the SECURITY.md entry; the designed revision guard closes it. Or use `INSERT ... ON CONFLICT DO NOTHING` over the full grid inside the batch.
- **Codex:** C1 (rated P2; I rate P3 because it is inside the documented, accepted concurrency class for a single-user app).

### F7 · P3 · CD · high — Food move to a concurrently deleted bag answers 500, not 400
- **Where:** `server/repos/food.ts:481-507` (precheck) and `:571` (recovery expects an FK error).
- **What:** Migration 0022's `list_food_items_location_same_list_update` BEFORE UPDATE trigger fires *before* the FK check and raises `SQLITE_CONSTRAINT_TRIGGER: packing location does not belong to this list`. The catch classifies range/unique/FK errors only, so this rethrows. The gear path (`list-items.ts:395-422`) puts the gate in the WHERE clause and answers `invalid_location`, so only food is affected. Batch rolls back correctly.
- **Direction:** Add `isTriggerAbort(err, 'packing location does not belong to this list')` to the catch (the locations repo already matches that text for its own trigger).
- **Codex:** C5 (rated P2; I rate P3 — a race-window status-code error with no partial write).

### F8 · P3 · CD · high — Food PATCH response composes pre-read fields with post-write fields
- **Where:** `server/repos/food.ts:520-525` (RETURNING only pack fields), `:618-641` (response from `patch ?? item`).
- **What:** A concurrent quantity write between the pre-read and this PATCH yields a 200 whose `quantity`/`unitCount` never existed in the DB. Client invalidation masks it today.
- **Direction:** RETURNING every scalar the DTO carries; read links in the same batch.
- **Codex:** C6 (P2 there; P3 here — contract blemish, no persisted damage).

### F9 · P3 · CD · high — Deleting container-backing gear leaves packing-location and food caches stale
- **Where:** `src/lib/queries/gear-list-items-fan-out.ts:137-149` (`makeSettled` invalidates gear + affected list-items only); used by `src/lists/use-list-gear-actions.ts:66` and `src/gear/use-gear-item-actions.ts:89`.
- **What:** Server-side the gear delete cascades `list_items` → `packing_locations.container_list_item_id` → SET NULL + rerank of gear *and food*. The membership-delete path already invalidates both dependent caches (`use-list-item-actions.ts:182-185`); the gear-delete path does not, so a ghost bag persists until the next mount/refetch.
- **Codex:** C3 (P2 there; P3 here — UI staleness that self-heals on navigation).

### F10 · P3 · CD · high — Location-delete append rank is computed before the write batch
- **Where:** `server/repos/packing-locations.ts:347` (`base` from a prior read batch); census at `:542` checks only the source bag.
- **What:** A food row arriving in Unassigned at rank `base` between the read and the write creates a legal cross-table tie, so the "orphans land after everything" property silently degrades to the deterministic tiebreak. Cosmetic, dissolves on the next reorder.
- **Codex:** C4 (P2 there; P3 here).

### F11 · P3 · CD · high — `costSchema` epsilon accepts what it promises to reject
- **Where:** `shared/gear.ts:48`; `shared/decimal.ts` comment explicitly says "gear's costSchema still uses the epsilon form; not touched here - different PR".
- **What:** `1e-9` passes and stores as 0 cents; the documented `99999999.00999999` case passes and rounds. The fix already exists in `decimalNumber`; the different PR never happened.
- **Codex:** C7.

### F12 · P3 · CD (documented) · high — First-list creation loses its error surface
- **Where:** `src/lists/ListsEmptyState.tsx:46-75`. Optimistic insert makes `lists.length !== 0`, unmounting the component that owns the draft and the call-site `onError`; the mutation sets no `meta.errorToast` (unlike `useCurrentListActions.createListMut`). A failed create silently drops the draft. Already recorded in `docs/incidents.md:147` as a known gap.
- **Codex:** A02.

### F13 · P3 · MC · high — `PUT /food/days` can answer 200 with a `null` body
- **Where:** `server/routes/food.ts:48` (`c.json(food satisfies ListFoodResponse | null)`). If the list vanishes between `setDayCount` and the re-read, the client's DTO parse throws. Should be a 404.

### F14 · P2 · MD · high — The most consequential guard is 4.4k lines of untyped JavaScript
- **Where:** `scripts/check-migration-safety.mjs` (4,436 lines; fixtures, a SQL DDL classifier, contract-migration declarations, D1 batch reader with nonce markers, six in-file self-tests). `tsconfig.node.json:23` type-checks only `check-migration-immutability.mjs`.
- **Why:** The complexity is *earned* (incident 0009 wiped `list_items` in production; the harness is the only behavioral trigger coverage), and Codex agrees. But it is the file whose correctness gates every production migration, and it is outside `tsc`, has no external tests (its self-tests run inside the same process they guard), and is hard to review as a single unit.
- **Direction:** Not a rewrite. Split fixtures/declarations from the engine, put the engine under `@ts-check` + `tsconfig.node.json` like its sibling, and move the self-tests into `scripts/*.test.ts` where `test:unit` runs them.

### F15 · P2 · MD · high — `ListDetailPage.tsx` has accumulated unrelated responsibilities
- **Where:** `src/lists/ListDetailPage.tsx` (2,743 lines; 6 of the repo's 7 `eslint-disable`s; legacy-URL rewriting, last-list cache write/heal, three DnD id kinds under one context, click-to-place mode, dialog state machine, worn/food union derivations, four confirm dialogs).
- **Why:** F1 is direct evidence that this size hides divergent predicates: rendering (`CategoryGroup`) and planning (`planListItemReorder`) answer "which rows are in this section" differently and the comment between them is wrong. The hooks already extracted (`use-list-item-actions`, `use-list-food`, `use-packing-location-actions`) are coherent; the drag/placement planning and the URL/last-list plumbing are the next natural seams.
- **Direction:** Extract the drag planners into `packing-dnd.ts`-style pure modules (the pack half already is) so rendering and planning share one "visible rows" predicate; move legacy-path and last-list effects into a hook.

### F16 · P3 · MD · high — Binding documents and live comments that contradict the code
- `SECURITY.md:659` — says the retired `groupWorn`/`readyChecksEnabled` **columns remain** because dropping rebuilds `lists`; migration 0027 dropped them via native `ALTER TABLE ... DROP COLUMN`. This is a BINDING doc per AGENTS.md.
- `.claude/skills/verify/SKILL.md` — describes `#password`, verify-email/reset-password flows and "sign-up creates NO session while unverified"; the app has been passwordless since 2026-07-11.
- `docs/testing-and-ci.md:99` — "`POST_CHECKS` probes are the only behavioral coverage of trigger bodies"; `server/routes/packing-locations.test.ts` ("packing location database triggers") exercises triggers on D1 too.
- Portability comments in `server/db/index.ts:4-6`, `server/db/app-schema.ts:30`, `server/email/index.ts:11`, `server/middleware/rate-limit.ts:336`, `server/middleware/security-headers.ts:6`, `wrangler.jsonc:17` still cite "portability rule 3" / "the Node target" — README retired that goal, and REWRITE_PLAN records an agent being misled by exactly this class of stale rule.
- `server/repos/pack-reorder.ts:189` describes rule 4 as "a PERMUTATION" though the implementation is index-safety; `:302` says "20 rows per statement ... ~54 statements" while `RANK_CHUNK = 100`.
- `src/lib/gear-status.ts:8` cites Supabase-era "migration 20260526173748"; `src/lib/export/takeout-files.ts:17` says "Full per-plan graphs ... (plan cap 100)" for a feature deleted by 0016; `server/repos/lists.ts:518-521` (`copyName`) comment is a garbled splice of two sentences.
- `migrations/0019` cites the removed `audit-pack-ranks.yml` — frozen file, already acknowledged in incidents.md; listed only for completeness.
- **Codex:** A05 found the first five; the rest are mine.

### F17 · P3 · MD/MC · high — `.planning/` is a committed, un-classified stale record
- **Where:** `.planning/PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, `intel/*` (committed 2026-07-19).
- **What:** Lists as *validated* "standalone food plans", "nutrition targets with grading", "portable to self-hosted SQLite", and `SHARE-02` food shape `{weightGrams, incomplete} | null` — all of which were deleted (0016, 2026-07-30) or retired. AGENTS.md's document taxonomy (binding / reference / dated) does not mention the directory, so an agent has no instruction not to trust it.
- **Direction:** Delete, or add to the "dated records, NOT binding" list with a header like REWRITE_PLAN's.

### F18 · P3 · MC · high — Small, demonstrated dead/duplicate code
- `server/repos/list-items.ts:307` and `:319` — identical `isPackRankRangeError` branches in `quickAdd`; the second is unreachable.
- `server/repos/food.ts:694` — a private `chunkIds` (80/statement) duplicating `server/repos/chunk-ids.ts` (90, parameterizable).
- Test-only helpers with no application caller: `nextMoveSortOrder`, `nextPackRankInCohort` (`src/lib/grouping.ts`), `makeOptimisticBulkDelete`, `makeOptimisticBulkUpdate` (`optimistic.ts` — bulk actions use the fan-out helpers), `isGearStatus`/`coerceGearStatus` (`gear-status.ts`), `shared/lists.ts` `ReorderPackPayload`.
- Four names for one payload shape: `ReorderPackPayload` (shared), `PackReorderPayload` (repo), `UnionRankUpdates` (`pack-rows.ts`), `UnionPackReorderUpdates` (`optimistic.ts`).
- `idSchema`, `tempIdSchema`, `uniqueIds`, `descriptionSchema`, `sortOrderSchema` each defined 2-3× across `shared/{food,gear,lists}.ts` — the comments justify it ("no dependency on the list DTOs"); harmless, noted not recommended.
- **Codex:** A06 covers the helpers and `chunkIds`.

### F19 · P3 · TG · high — A test that greps the source file
- `src/lists/list-category-footer-wiring.test.ts` asserts four exact JSX substrings exist in `ListDetailPage.tsx`. Passes on dead code, fails on harmless rewrites, proves nothing about rendered totals. **Codex:** A07.

### F20 · P3 · TG · medium — Specific authz-matrix cells without a test
Per Codex's enumeration (A04), which I spot-checked but did not exhaustively re-derive: food-item POST/DELETE as a non-owner; food-item PATCH/DELETE through another of the *same* user's lists; food PATCH with foreign `slotIds` asserting existing links survive; document `items/order` with another user's item (the existing negative is same-owner/wrong-list); pack-order through another owned parent. No bypass was demonstrated — the repo predicates cover these — but the matrix's own rule is "a row without tests fails review."

### F21 · P3 · PC · medium — D1 Free-tier daily limits are now enforced
Cloudflare's 2026-09-01 changelog: Free-plan D1 queries *fail* once the daily row read/write limit is hit. The rate limiter writes a row per non-allowlisted auth request, `/api/health` reads on every hit, and the share endpoint is deliberately unmetered. Nothing in the repo says which plan the account is on; this belongs in the operational assumptions if it is Free.

*Not re-raised as findings (already documented and accepted in SECURITY.md with triggers):* unscoped CI credentials (Codex SEC-04), concurrent food edits without a revision guard (Codex A03), unmetered public share, the `workers.dev` second origin.

---

## Architecture assessment

**Coherent, and the implemented architecture matches the intended one almost exactly — the drift is in the docs' description of goals, not in the code.** The one real divergence from your framing: *Node + SQLite portability is retired, not intended.* README says so plainly, REWRITE_PLAN marks it superseded, `server/db/index.ts` only accepts a `D1Database`, and the repo uses D1 batch semantics directly. The comments that still invoke "portability rule 3" (F16) are the residue. Likewise there is **no Playwright tier**: `docs/testing-and-ci.md` says "Browser / end-to-end: none", and the `verify` skill is an ad-hoc scratch-dir procedure (and a stale one).

**Strongest boundaries:**
- Routes → repos. Handlers cannot import the DB/schema/drizzle/auth (fail-closed ESLint over `server/**`, inline disables neutralized), get `reposForUser` from middleware, and every repo predicate carries `userId` and, for children, the parent `listId`. Backed by composite same-owner FKs and the 0014/0022 same-list triggers, so a missed predicate degrades to "this user" rather than "anyone."
- The public share: dedicated repo, five statements under one `is_shared` gate in one batch, field-by-field mapping, `deepStrict` re-parse on the way out, forbidden-key tests on raw JSON, `no-store`.
- Auth hardening: deny-by-default passkey freshness inside better-auth, UV enforced in both ceremonies, hashed magic-link tokens in the URL fragment redeemed on click, three-bucket rate limiting with the charge order argued and tested under a concurrent burst.
- Migrations: no-rebuild rule, digest-pinned baseline, immutability on PRs, seeded-replay harness.

**Weakest boundaries:**
- Client ↔ server *derived* logic is mirrored, not shared: `nextUnionPackRankFor`/`unionPackRows`/`assignUnionPackRankSlots` (client) mirror `nextUnionPackRank`/`unionOrder`/index-safety (server) with "must stay identical" comments. Tested on both sides, but a change to one is not caught by the other's tests.
- Rendering vs planning inside `ListDetailPage` (F1/F15).
- Operational facts (D1 limit semantics, plan tier, secret presence) are asserted in comments rather than checked (F3, F5, F21).

## Test assessment

**Well protected:** every route family has owner / non-owner / anon / cross-parent tests with post-request row assertions (not just status codes); atomicity of imports, duplicates, quick-add and location deletes is proven by counting rows after induced failures; the caps are tested at the API and by raw insert against the trigger; the rate limiter under 20-way bursts; the pack-rank machinery at full 300+200 cohorts, at the rank ceiling, and with induced park failures; precheck races are staged with a sabotaged `Db` proxy so the real FK error and real recovery probes run (`constraint-races.test.ts`); response-contract parity strict-parses one endpoint per schema; the SPA's optimistic lifecycles, session revalidation, cross-account teardown, and delayed/stale save completions are covered.

**Insufficiently protected:** true concurrency between *two requests* on the same rows (F6-F8, F10 — the workerd test transport serializes, so these can only be reached by the sabotage pattern, which is applied to prechecks but not to read-then-write windows); production-only platform limits (F3, F21); the specific matrix cells in F20; the fan-out cascade into packing-locations/food caches on gear delete (F9); log content (F4); F19 is the one implementation-coupled test I found.

## Cruft assessment

**Code cruft is small.** Two dead branches/duplicates, a handful of test-only helpers, one grep-the-source test, one committed stale planning tree. Every runtime dependency is used (`fflate` via dynamic import), the lockfile has no nested toolchain, and the unused-export scan turned up almost entirely type exports and deliberate test seams. The abstractions that look heavy (pack-rank park/settle + guard tables, migration harness, error-log budget, `deepStrict`, the sabotaged-Db test proxy) each trace to a named incident or a proven failure mode; Codex reached the same conclusion independently.

**Prose cruft is moderate.** The codebase carries an unusually high comment-to-code ratio, mostly high quality — but comments rot faster than code, and F16 lists a binding security doc, an operational skill, and five in-code comments that now describe behavior that no longer exists. F1 sits directly under one of them.

## Investigated and NOT a problem

- **`db.batch` correctness on D1** — every multi-statement write is one batch; guard-table rows cannot escape a batch; `db.run/all` never appear in a batch (the incident-documented crash).
- **The 100-parameter cap** — owned-set membership for prechecks, `chunkIds`/`chunkForParamCap` for writes, json_each for rank writes; verified by tests at >100 ids.
- **Raw `sql` fragments** — every one I read hand-writes qualified identifiers, binds ids/ranks/JSON as parameters, and carries `user_id`+`list_id` predicates; `sql.raw` is used only for the two literal table names.
- **CSRF** — custom header on every unsafe non-auth method, optional Origin match, no CORS emitted, `/api/auth/*` origin-validated by better-auth; documentation matches code precisely (including the "absent Origin is permitted" nuance).
- **XSS** — no `dangerouslySetInnerHTML`; `react-markdown` without raw HTML; `noopener noreferrer` on external links; strict CSP with path-restricted beacon; CSV export neutralizes formula injection.
- **Session handling** — token in fragment, scrubbed on landing, redeemed by navigation so better-auth's 302s work; cross-account teardown suppresses render synchronously; last-list pointer owner-tagged; 401 revalidation coalesced and time-bounded.
- **Rate limiter** — the atomic upsert has no lost-update window; the peek/charge split and IP→address→global order are correct as argued; email keys are domain-separated HMACs.
- **`ownsAllGearIds`/reorder without `listId` in the write predicate** — Codex flagged and cleared it: membership is prechecked and nothing can reparent a membership row.
- **`packing_location_id` as a single-column FK** — deliberate so SET NULL works; same-list integrity restored by triggers, proven in tests.
- **`error-handler` module state** — per-isolate, synchronous, documented as such; fine.
- **`ConsoleEmailSender` outbox in the bundle** — bounded, only constructed without a key (the *selection* rule is F5; the class is fine).
- **The `.dev.vars` copy in `dist/`** — SECURITY.md's three reasons check out.
- **Deploy pipeline** — `workflow_run` + file-path pin + in-lock re-verification + no `workflow_dispatch`; secrets scoped to the two wrangler steps; marker step ordering is right.
- **Dependencies** — pins are exact, `overrides` is a range for the reason incidents.md gives, one wrangler/miniflare/workerd, `@testing-library/dom` is a required peer.

## Unknowns (cannot be answered from the repo)

1. **Which D1 limit semantics apply** — per statement or per batch (F3). This decides whether ~900-statement imports/duplicates can ever succeed in production.
2. **Workers/D1 plan tier** — Free (daily row limits now fail closed) or Paid (F21).
3. **Whether `RESEND_API_KEY` is set in production** and whether any sign-in has ever hit the console sender (F5).
4. **GitHub secret scope and environment availability** for the deferred credential-scoping item.
5. **Whether a maximum-size import or duplicate has ever run in production** (incidents.md says no).
6. **Real traffic on `/api/shares/v2/*` and `/api/health`** — relevant to the unmetered decision and F21.

## Remediation order

1. **F1** — one predicate, one comment, one regression test. Highest user-visible payoff, smallest change.
2. **F2 + F4 + F5** (auth/log hygiene batch) — lowercase the purge, scrub Drizzle params from `recordIncident` and better-auth's logger, fail closed on a missing mail key. Each is a few lines; test each.
3. **F3** — settle the D1 limit fact, then either chunk the import/duplicate inserts (multi-row, `base + i`) or retire the contrary belief. Unblocks a class of latent production failures either way.
4. **F7, F8, F9, F11, F13, F6** — narrow food/pack failure-path fixes; do them as one "race-path classification" PR so each gets a sabotaged-Db test in `constraint-races.test.ts`.
5. **F15 + F18 + F19** — extract the List-view planner next to `packing-dnd.ts` so rendering and planning share one visibility predicate; delete the dead branch/duplicates/test-only helpers and the grep test in the same pass. This structurally prevents the next F1.
6. **F16 + F17** — one docs PR: fix `SECURITY.md:659`, rewrite or delete the `verify` skill, strip "portability rule" comments, fix the pack-reorder and misc comments, classify or delete `.planning/`.
7. **F14** — `@ts-check` + tsconfig inclusion for the harness, self-tests moved under `test:unit`. Low urgency, high review value.
8. **F20, F12, F10, F21** — fill the matrix cells; decide the first-list error surface; note F10 as accepted; record the plan tier.
