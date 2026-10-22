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
- 2026-10-01 Code-quality refactor packages from the 2026-09-26 audit (shared Button component, shared test fixtures, and the rest). Full list: `git show 89e4f1c:docs/audits/2026-09-26-code-quality-review.md`; the 2026-10 remediation phases delivered the big ones (menu shell, inline-edit machine, ListDetailPage and GearLibraryPage splits). Trigger: a feature that touches one of those files picks up its package.
- 2026-10-01 Stable `renderPackRowAction` so ticking one Pack checkbox re-renders one section, not every bag. PROFILED 2026-10-20 (Phase 6): a tick at 300 items / 30 locations commits in ~140ms jsdom (~15-45ms browser estimate), inside the interaction budget, and stable callbacks alone cannot restore the memo hits - every list-items write rebuilds packingTree's per-section arrays, so the real fix is stable callbacks PLUS identity-preserving tree builds. Numbers and details live in the KNOWN TRADE comment at renderPackRowAction (src/lists/ListDetailPage.tsx). Trigger: visible lag on a real list, more per-row work on this path, or raised caps - re-profile first.
- 2026-10-01 Share link previews (server-rendered Open Graph tags) - trigger: wanting a shared list to unfurl in chat apps.
- 2026-10-01 Bearer tokens for the API - trigger: a CLI or other non-browser client.
- 2026-10-01 One item editor instead of `QuickAddItemModal`, `GearItemDialog` and the inline category fields - trigger: the next time those editors drift apart.
- 2026-10-01 Lint hardening: `no-misused-promises`, `--max-warnings 0`, a rule stopping `src/` from importing `server/`, CSP `object-src 'none'` - trigger: a bug any of these would have caught.
- 2026-10-18 Investigate repeated CI compilation/installation and image readiness waits only when comparable job timings identify a material delay. Obtain at least two baseline and two after runs on the same runner class before claiming savings or changing gates. Candidate details: `git show fd89242:docs/audits/2026-10-18-test-audit.md`, F12. No workflow changes are required for the test cleanup.
- 2026-10-19 Converge the auth pages (src/auth/auth-ui.tsx) onto the app's shared style tokens - the shared presentation primitives (KebabMenu, InlineRenameInput, Modal header, COL_* tokens) exist since the 2026-10 remediation's Phase 4a, so this is adoption work, not design work. Trigger: the next visual change to those pages.
- 2026-10-20 Refactor `InlineText`/`InlineWeight`/`InlineQuantity` onto the shared inline-edit machine (`src/components/InlineRenameInput.tsx` / `useCommitOnce`) - each still carries its own draft/prev-prop-sync/editing state copy. Deferred from Phase 4a because the diff is not mechanical: those controls swap display<->edit modes, sync external value changes mid-edit and commit typed values, which the rename machine does not model. Trigger: the next behavior change to any of the three controls (change one, converge all three).

- 2026-10-20 Replace FoodView's single `foodBusy` flag (ORs six mutations +
  checkingDays and freezes every control) with per-operation pending state.
  Requires defining the food concurrency contract first: which operations may
  overlap (day changes replace the whole cached food document; slot edits,
  deletes, creates and quantity changes do not all commute), which stay
  mutually exclusive, and how controls track per-item pending. The existing
  global-freeze test in FoodView.test.tsx is then deliberately replaced as a
  named policy change, not deleted as redundant. REVISITED during the 2026-10
  Food redesign (the trigger it named): item writes now run from a modal
  dialog that already inerts the page, so the global freeze is only
  user-visible for the trip-length write, and per-operation state was not
  worth its contract work in that diff. New trigger: the first user-visible
  complaint about the freeze, or food writes issued outside the dialog again.
- 2026-10-22 All consumables (fuel, water treatment, ...) rolling into the
  Food view's shopping tally, so one list says everything to acquire before a
  trip - Joe's observation during the 2026-10 Food redesign ("really all
  consumables do" need acquiring). Trigger: the first time a non-food
  consumable is forgotten on a trip, or a request to see fuel on the tally.
