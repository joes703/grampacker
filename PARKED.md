# Parked

**Reference, not policy.** Ideas deliberately deferred, each with the
condition (trigger) that would make it worth doing. Nothing here is
rejected. An idea with no trigger does not belong on this list.

Format: `- YYYY-MM-DD <idea>. Trigger: <condition>.` One line per idea.

- 2026-07-07 Turnstile CAPTCHA on signup (needs a third-party script and a CSP change; rate limits and the per-address bucket cover it until then). Trigger: first observed signup abuse, or real user growth.
- 2026-07-07 Google social login (a config-level addition in better-auth). Trigger: a real reason to offer it.
- 2026-07-07 Apple social login. Trigger: willingness to pay for the Apple Developer Program ($99/year).
- 2026-09-19 Extend `shared/deep-strict.test.ts` with optional/nullable OBJECT fixtures and a union fixture, and narrow the comment in `shared/deep-strict.ts` that reads as a guarantee for every shape (today no response schema uses those branches, so nothing tests them). Trigger: the first response schema that contains an optional/nullable object or a union.
- 2026-10-01 The remaining refactor packages from the 2026-09-26 code-quality audit (list: `git show 89e4f1c:docs/audits/2026-09-26-code-quality-review.md`). Trigger: a feature that touches one of those files picks up its package.
- 2026-10-01 Stable `renderRowAction` plus identity-preserving `packingTree` builds, so ticking one Pack checkbox re-renders one section, not every bag (profiled at the caps and accepted; see the KNOWN TRADE comment in `src/lists/PackDocument.tsx`). Trigger: visible lag on a real list, more per-row work on this path, or higher caps; profile again first.
- 2026-10-01 Share link previews (server-rendered Open Graph tags). Trigger: wanting a shared list to unfurl in chat apps.
- 2026-10-01 Bearer tokens for the API. Trigger: a CLI or other non-browser client.
- 2026-10-01 One item editor instead of `QuickAddItemModal`, `GearItemDialog` and the inline category fields. Trigger: the next time those editors drift apart.
- 2026-10-01 Lint and CSP hardening: `no-misused-promises`, `--max-warnings 0`, a rule that stops `src/` from importing `server/`, CSP `object-src 'none'`. Trigger: a bug one of these would have caught.
- 2026-10-18 Reduce repeated CI compile/install steps and image readiness waits (candidates: `git show fd89242:docs/audits/2026-10-18-test-audit.md`, F12). Trigger: comparable job timings show a real delay; measure at least two runs before and two after on the same runner class before claiming savings.
- 2026-10-19 Move the auth pages (`src/auth/auth-ui.tsx`) onto the app's shared style tokens and components. Trigger: the next visual change to those pages.
- 2026-10-20 Move `InlineText`, `InlineWeight` and `InlineQuantity` onto one shared inline-edit component with `InlineRenameInput` (each still keeps its own draft, prop-sync and editing state; they switch display/edit modes and sync outside changes mid-edit, which the rename component does not model). Trigger: the next behavior change to any of the three; change all three together.
- 2026-10-20 Replace FoodView's single `foodBusy` flag, which freezes every control, with per-operation pending state (first define which food writes may overlap, then replace the global-freeze test in `FoodView.test.tsx` as a named policy change). Item writes run in a modal that already blocks the page, so the freeze is visible only for the trip-length write. Trigger: the first user complaint about the freeze, or food writes issued outside the dialog again.
- 2026-10-22 One list of everything to buy before a trip: all consumables (fuel, water treatment, ...), not just food. This would be a new surface. Trigger: a non-food consumable forgotten on a trip, or a request for a buy list.
- 2026-10-27 Unify the CI verify gates copied between `ci.yml` and `image.yml` into a reusable workflow (kept separate so the publish path runs its own gates even if `ci.yml` changes; both files say the copies move together; the risk is a gate added to one file only). Trigger: the first gate that silently missed one of the two files, or the next CI restructuring.
