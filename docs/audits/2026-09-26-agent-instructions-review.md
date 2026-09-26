# Agent instructions review (AGENTS.md, CLAUDE.md), 2026-09-26

This is a dated record, not binding. Nothing here has been applied.

**Proposed replacements:**
- `2026-09-26-proposed-AGENTS.md`: 207 lines (10.6 KB), down from 436 lines
  (26.6 KB).
- `2026-09-26-proposed-CLAUDE.md`: 52 lines, down from 91.

**Question from the owner:** has AGENTS.md "gotten out of control"? And are
its contracts "a hell of a thing to hang on"?

**Short answer:** yes, it has. The contracts themselves are the right ones.
All ten were checked against the code:
- nine hold as stated;
- one (#9, "a copied constant gets a test") is only partly followed.

What went wrong is everything around them:
- a 44-line essay on how to classify rules;
- about 110 lines on how the migration harness works inside;
- incident history repeated from `docs/incidents.md`;
- dated asides ("since 2026-09-01", "until 2026-09-12");
- rules that lint, `tsc` or a test already enforce.

The app's actual invariants appeared only in CLAUDE.md, so Codex (which reads
AGENTS.md, not CLAUDE.md) never saw them as a list.

## 1. What current guidance says

A research pass collected current vendor guidance and 2025-26 empirical work.

**Caveat on sources:** the sandbox network policy blocked most vendor sites.
Only the agents.md spec and the Codex source were read in full. The rest come
from search-result excerpts and paper abstracts. Treat figures from those as
reported, not verified.

**Guidance:**
- **Anthropic, Claude Code memory and best-practices docs:**
  - "Target under 200 lines per CLAUDE.md file. Longer files consume more
    context and reduce adherence."
  - For each line: "Would removing this cause Claude to make mistakes? If
    not, cut it."
  - Turn a rule into a hook if a tool can enforce it.
  - Move reference material into on-demand docs or skills.
- **agents.md spec** (github.com/agentsmd/agents.md, read in full): "a README
  for agents." It lists commands, testing, conventions and security. It gives
  no size guidance.
- **OpenAI Codex:** concatenates instruction files up to
  `project_doc_max_bytes = 32768` (verified in `codex-rs` source). The current
  files total about 31 KB: AGENTS.md 26.6 KB plus CLAUDE.md 4.7 KB. Codex reads
  only AGENTS.md (26.6 KB, under the cap), but the headroom is shrinking.
- **"Configuration Smells in AGENTS.md Files"** (arXiv 2606.15828,
  descriptive) found these problems, with the share of files that had each:
  - restating linter rules: 62%
  - bloat: 42%
  - rarely used procedures that belong on demand: 35%
  - conflicting instructions: 28%
  - stale setup-era content: 24%
  - links with no note on when to read them: 16%

  This repo shows all six, as section 2 shows.
- **"Why Does CLAUDE.md Keep Growing?"** (arXiv 2608.11095, measured):
  - Files grow about +226% over their lifetime, and rules are rarely deleted.
  - Once a rule's reason is lost, deleting it safely gets expensive.
  - Recording the reason next to the rule makes deletion possible.

  That supports the repo's "state the reason" policy, but as one line next to
  the rule. It does not support an essay.
- **Evidence on size:**
  - IFScale (arXiv 2507.11538): adherence falls as instruction count grows,
    but the task was not coding. A 2026 replication (Arize) reports the
    threshold rose about 10×.
  - McMillan (arXiv 2605.10039): no measurable adherence effect between 25 and
    500 lines, for a single trivial instruction.
  - ETH (arXiv 2602.11988): unnecessary requirements raised cost by more than
    20% and bought little.

  The strongest measured case against length is **cost and growth**, not an
  adherence cliff at any particular line count.

**Where the sources agree:**
- **Keep** exact commands, non-obvious traps, boundaries, and rules that
  apply to every task.
- **Cut** what a tool enforces, what the code shows, history, rarely needed
  procedures (link them instead, saying when to read them), and anything
  aspirational.

## 2. How the current files measure up

| Smell | Where it shows up here |
|---|---|
| **Restating what a tool enforces** | "`RefObject<T \| null>` … verify with `npm run build`" (the build enforces it). The ~15-line "route handlers never touch the DB" paragraph restates the lint config's exemption list. Action-pin comments (`check:action-pins` enforces them). The immutability and snapshot rules are restated in AGENTS.md, `docs/testing-and-ci.md` section 7, and the harness header. |
| **Bloat** | "How to read a rule" (44 lines of taxonomy before any instruction). The migration section (~110 lines, including batching-launch counts "81 launches where it was 182"). Why the spelling rule is phrased as transformations. A paragraph explaining that comments may be non-ASCII (it requires nothing). |
| **Rarely used procedure** | The harness's internals and what the contract-step gate does and does not prove. Only the author of a removal migration needs this, and `testing-and-ci.md` section 7 is its home. |
| **Conflicting instructions** | `.claude/settings.json` auto-approves `codex exec -s read-only *`, which CLAUDE.md retired, and `gh run watch *`, which CLAUDE.md says 403s. `git add *` covers the `-A` that AGENTS.md forbids. `git push *` covers `--force`. The merge procedure is written in both AGENTS.md and CLAUDE.md. AGENTS.md says 0009 wiped `list_items` "in production", while the old harness header says "a human reviewer caught 0009". The owner has not yet said which is true. |
| **Stale** | "since 2026-09-01", the `.planning/` parenthetical, and CLAUDE.md's "until 2026-09-12 … prescribed codex exec" history. "Exception to know: the `gear_items` cap trigger" suggests it is the only trigger outside Drizzle; every cap, rank and same-list trigger is. |
| **Links without a note on when to read** | "details and history: docs/incidents.md" is fine. Some pointers do not say which section, or when the reader needs it. |

**Also outside the repo:** `/home/joe/code/CLAUDE.md` (485 lines) is
generic sandbox boilerplate that loads into every session:
- "multi-language project … Use Prettier if configured … yarn …"
- Some of it contradicts this repo, for example the "run `npm install`"
  workflow, where this repo says to use `npm ci`.

It is not in the repo, so it is not in scope for this proposal. It is,
however, the largest single block of instructions loaded into each session,
and worth trimming at the sandbox level.

## 3. The contracts: are they true, and what enforces them?

**Method:** a verifier checked each contract against the code, cited files and
lines, and ran lint and the unit suite. The key discrepancies were then
re-checked by the author of this review.

| # | Contract | True? | Enforced by | Wording |
|---|---|---|---|---|
| 1 | A shared food item counts its weight once; a per-meal item counts per meal | Yes (`shared/food.ts:147-154`) | `shared/food-unit-count.test.ts`, `server/routes/food.test.ts:128`, weight-breakdown tests | Accurate |
| 2 | Route handlers never touch the DB | Yes today | Lint, `@typescript-eslint/no-restricted-imports` with `noInlineConfig`. The exemption list matches. | **Overclaims.** The lint matches imports only. **Probe (confirmed):** `c.env.DB.prepare(...)` in `server/routes/me.ts` passes lint (exit 0), while `import { db } from '../db'` fails (exit 1). |
| 3 | Queries are scoped to the session user | Yes (heuristic scan; not exhaustive) | The `reposForUser` closure; composite FKs; non-owner API tests. No lint rule. | Accurate |
| 4 | The public share returns only its strict DTO | Yes | Runtime `deepStrict().parse` and `shares.test.ts:126` (checks the raw JSON) | Accurate |
| 5 | Client ids are prechecked for ownership, within 100 parameters | Yes | Tests with more than 100 ids in 5 route files; composite FKs | Accurate |
| 6 | CSRF, then auth | Yes | `csrf.test.ts`; `food.test.ts:421` proves the order | Accurate |
| 7 | Owner / non-owner / anonymous proofs, recorded in the authz matrix | All 45 handlers have a row | Nothing (prose) | Accurate. Minor gaps: no row for the `/api/*` 404 fallback; the health row's tests column is stale |
| 8 | The `gear_items` 500-row cap is a hand-written trigger | Yes (0003, recreated in 0013) | `gear-items.test.ts:305` | **Incomplete.** Every cap trigger is outside Drizzle, not just this one, and "any rebuild must recreate it" is moot now that rebuilds are banned. |
| 9 | A TypeScript constant copied into SQL gets a test | **Partly** | `quantity-bounds.test.ts`; `pack-rank-constants.test.ts` (ties `LIST_ITEM_CAP` and `FOOD_ITEM_CAP` to the rank guards); `categories.test.ts:360` (the category cap) | **Not followed for six cap definitions:** there is no direct comparison between the constant and the database threshold. That covers the row-cap triggers for `GEAR_ITEM_CAP`, `LIST_CAP`, `LIST_ITEM_CAP`, `PACKING_LOCATION_CAP` and `FOOD_ITEM_CAP`, and the day CHECK for `FOOD_DAY_CAP`. `shared/food.ts:18-19` uses the forbidden "keep in lockstep" comment instead. Fix the code, not the rule: code-quality review work package 3. |
| 10 | better-auth's own limiter is off; the budgets are ours | Yes (`auth.ts:210-216`) | `rate-limit.test.ts:246` | Accurate. Nothing asserts `enabled: false` directly. |

**Verdict on "a hell of a thing to hang on":**
- The contracts are sound and mostly tested.
- Two are **prose-only**: #3 (scoping inside repos) and #7 (the per-route
  authz proofs). #9 is only partly tested, and is missing the threshold
  comparisons. Those three are the ones to back with machinery. The
  code-quality review's work package 7 adds a route sweep test and closes the
  lint gap from #2.
- What made them hard to hang on was that they were **scattered**:
  - two examples inside the taxonomy essay;
  - two in "Boundaries";
  - four only in CLAUDE.md's Codex section, invisible to Codex.

  The proposal puts all six app invariants in one "Invariants" section of
  AGENTS.md, which every agent reads.

## 4. What the proposal does with each part

**Categories:**
- **Keep:** stays, possibly shorter.
- **Enforced:** a tool already checks it; replaced by a pointer or dropped.
- **Move:** relocated to the named doc *before* deletion.
- **Delete:** no action follows from it.

| Current section (lines) | Disposition |
|---|---|
| Header and stack (1-10) | **Keep**, merged with "Do not reintroduce" into one stack line |
| How to read a rule (12-55) | **Delete**, reduced to 2 sentences: contracts are product decisions (Invariants preamble), and an expired reason means retire the rule (end of the file) |
| Documents (57-79) | **Keep**, shortened; the `.planning/` history parenthetical is dropped |
| Roles (81-111) | **Keep** the gates (merge = deploy, approve the exact head, no destructive git without approval, remote D1 human-gated). **Delete** the ruleset history. The merge command is kept once, not in both files. |
| Commands (113-130) | **Keep** (the most valuable section per every source); notes shortened |
| Verification (132-157) | **Keep** the minimum-gates list and the exit-code point. **Delete** "a passing test proves the path it exercises" as generic advice. |
| Traps (159-219) | **Keep** each as one line; history is already in `docs/incidents.md`. **Enforced:** `RefObject` (the build). **Move:** `noValidate` → `docs/ui-density.md` forms; "optimistic updates hide rejections" (a debugging tip) → incidents "Optimistic updates" |
| Boundaries: routes and authz | **Keep**, now under Invariants, with the lint wording corrected |
| Boundaries: generated files and the gear trigger | **Keep**, generalized to all triggers |
| Boundaries: migrations (~110 lines) | **Keep** 5 rules (≈20 lines). **Move** these to `testing-and-ci.md` section 7 first: the snapshot-staleness mechanics, the harness internals, what the gate proves and does not prove, `readsRemovedIn`, and the removal-only rule's reasoning. **Move** to incidents: the 0018/0021-0024 snapshot history. |
| Git and supply chain | **Keep**, compressed |
| Security | **Keep** |
| Conventions | **Keep** US spelling (the transformations), ASCII identifiers and scope. **Delete** the non-ASCII-comments paragraph. **Add** "comments explain why; history goes to commits or incidents", which the code-quality review found violated across the codebase. |
| UI styling | **Keep** the four traps, the density tiers, the Tailwind fact and the pointer. The food-view rework anecdote is dropped. |
| Do not reintroduce | **Merged** into the stack line |
| CLAUDE.md working style | **Keep** (the owner's stated preferences) |
| CLAUDE.md pipeline | **Keep**; the merge detail is deduplicated to AGENTS.md |
| CLAUDE.md Codex section | **Keep** the procedure. **Delete** the "until 2026-09-12" history. The invariant list is **moved** to AGENTS.md. |

**Also proposed, outside the two files:**
- **`.claude/settings.json`:** remove `codex exec -s read-only *` and
  `gh run watch *`, and add deny rules for `git add -A*`, `git add .`,
  `git checkout -- *`, `git checkout .`, `git push --force*` and
  `git push -f*`. This is the owner's call, since it changes what runs
  without a prompt.
- **Delete `npm run deploy`** from `package.json`. It is a one-word bypass of
  the gated pipeline that AGENTS.md forbids.

## 5. Risks, and how to apply this

- **Losing a reason that still matters.** Every "Move" must land in its
  target doc in the same PR, before the AGENTS.md text goes. Do not delete
  and plan to move later. The migration material is the largest move, and
  `testing-and-ci.md` section 7 must fully cover it first.
- **Adherence regressions.** Nothing measures whether a shorter file changes
  agent behavior here. The published evidence says the risk is low, and the
  costs of the current length (context, drift, contradictions) are real.
  Watch the first few sessions after the change for repeats of the incidents
  the traps list names.
- **Timing.** The migration-harness rewrite (PR 3) edits the same AGENTS.md
  sections. Apply this after it merges and rebase the proposal onto it; the
  proposal was written against PR 3's text.
- **Unresolved fact.** Did 0009 wipe `list_items` in production? The
  proposal avoids the claim. The owner's answer goes into
  `docs/incidents.md`.
- **Next step:** one PR replacing both files and making the moves. It gets a
  Codex review framed as "find a rule that was dropped without a home", then
  the owner's approval.

## Review record

Codex did a source-level adversarial review of the first draft (`7ac18a5`),
through the plugin. It is read-only and ran no suites. Its verdict: **accurate
with corrections**. All seven corrections were applied in the following
commit:
- B1's "permanent" claim is qualified.
- The removed-column fixtures are retargeted, not deleted.
- The route sweep exempts the anonymous routes.
- `FOOD_DAY_CAP` is recognized as a CHECK constraint, not a trigger.
- Three rules the proposal dropped are restored: never discard the user's
  changes; the full rejected-promise ownership rule; no slash-command
  hand-offs.
- The ownership wording allows the documented bounded-probe alternative.
- Contract #9 is described as partly followed, not violated outright.
