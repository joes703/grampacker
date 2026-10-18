# Parked

**Reference, not policy.** The list of deferred ideas and what would un-defer
them.

Ideas deliberately deferred, each with the condition that would un-defer it.
Nothing here is rejected - an idea with no trigger does not belong on this
list, it belongs in the bin.

One line per idea, date it, say what would change your mind.

Format: `- YYYY-MM-DD <idea> - <why it waits>`

- 2026-07-07 Turnstile on signup - trigger: first observed signup abuse. A third-party script + CSP change is not justified pre-abuse; rate limiting + required verification carry until then.
- 2026-07-07 Google social login - better-auth makes it a config-level add; wait for an actual reason.
- 2026-07-07 Apple social login - blocked by cost-zero (Apple Developer Program is $99/year).
- 2026-09-19 Extend `shared/deep-strict.test.ts` to cover the walker branches its fixtures cannot reach today - optional/nullable OBJECT fixtures and a response-union fixture - and narrow the comment at `shared/deep-strict.ts:10-15`, which reads as a blanket accessor-compatibility guarantee but only holds for the schemas currently exported. The suite enumerates nesting paths by hand and covers all 12 current `*ResponseSchema`s; nullable PRIMITIVES cannot demonstrate recursive strictness, so the optional/nullable-object and union branches could stop working without a test noticing. Trigger: the first response schema that composes an optional/nullable object or a union - at that point the branch becomes load-bearing for the public share DTO and the fixture is no longer hypothetical. Found by adversarial review of the PR #245 dependency bump (zod 4.5.4 to 4.6.2); the throwing-path guard `assertNoContainerChecks` IS covered and was not the gap.
- 2026-10-01 Code-quality refactor packages from the 2026-09-26 audit (shared Button and menu components, an inline-edit hook, shared test fixtures, splitting ListDetailPage and GearLibraryPage). About 60 items open; full list: `git show 89e4f1c:docs/audits/2026-09-26-code-quality-review.md`. Trigger: a feature that touches one of those files picks up its package.
- 2026-10-01 Stable `renderPackRowAction` so ticking one Pack checkbox re-renders one section, not every bag - trigger: visible lag on a large list (profile 300 items / 30 locations first).
- 2026-10-01 Share link previews (server-rendered Open Graph tags) - trigger: wanting a shared list to unfurl in chat apps.
- 2026-10-01 Bearer tokens for the API - trigger: a CLI or other non-browser client.
- 2026-10-01 One item editor instead of `QuickAddItemModal`, `GearItemDialog` and the inline category fields - trigger: the next time those editors drift apart.
- 2026-10-01 Lint hardening: `no-misused-promises`, `--max-warnings 0`, a rule stopping `src/` from importing `server/`, CSP `object-src 'none'` - trigger: a bug any of these would have caught.
- 2026-10-18 Investigate repeated CI compilation/installation and image readiness waits only when comparable job timings identify a material delay. Obtain at least two baseline and two after runs on the same runner class before claiming savings or changing gates. Candidate details: `git show fd89242:docs/audits/2026-10-18-test-audit.md`, F12. No workflow changes are required for the test cleanup.
