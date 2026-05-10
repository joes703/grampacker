# grampacker — Phase 14 fixes (2026-05-06)

**Source:** `REVIEW-quality.md` — UX-visible half of the M-cluster: M-2 (`updated_at` bump in optimistic apply), M-3 (`ListSelector` device-class flip), M-7 (`RootRedirect` sort → reduce).
**Scope:** three small UX/perf fixes + summary. **Four commits.** No new tests in this phase — these touch mutation/render paths that need jsdom + `@testing-library` (deferred to the T-cluster phase).
**Why bundle these three:** all are user-observable correctness/polish items, all small, all touch optimistic-update or render code without requiring new infrastructure. The defensive half of the M-cluster (M-1, M-5, M-8, M-10) is a separate phase because it adds observability/guards rather than fixing UX bugs.

> **Note on file paths:** all paths are repo-relative.
> **Phase 13 baseline:** main bundle = **187.41 KB gzip**. Bundle delta expected: **slightly negative** (M-7's reduce is shorter than spread+sort; M-2 adds ~30 chars across three sites; M-3 adds ~120 chars for the effect + ref).
> **Risk profile:** low. M-2 surfaces only affect display freshness within a round-trip window; M-3 is defense-in-depth for a UX wart, not a bug; M-7 is mechanical and runs only on a cold-path code branch.

---

## How to execute this file

Four commits. Order does NOT matter — none depend on each other.

C1 → C2 → C3 → C4.

After every commit:

```bash
npm run build && npm run lint && npm test -- --run
```

Build, lint, and tests must all pass before moving to the next commit.

---

## Verification: audit-vs-current-code

| Audit ref | Audit said | Current code | Verdict |
|---|---|---|---|
| M-2 site 1 | `ListDetailPage.tsx:284-292` (notesMut) | `notesMut` is at `ListDetailPage.tsx:316-323`, apply at line 322 | shifted but real |
| M-2 site 2 | `ListsPage.tsx:143-151` (renameMut) | `renameMut` is at `ListsPage.tsx:134-142`, apply at line 140 | shifted but real |
| M-2 site 3 | `NavBar.tsx:202-210` (renameMut) | `renameMut` is at `NavBar.tsx:202-210`, apply at line 208 | exact |
| M-3 framing | "opens both desktop popover and Vaul drawer when isMobile flips mid-open" | The two surfaces at `ListSelector.tsx:87` and `:119` are mutually exclusive via `!isMobile` / `isMobile` — they cannot both render simultaneously | **partially audit-stale** |
| M-3 fix | "Force-close on isMobile flip" | UX concern remains: open surface persists across device-class flip and changes appearance without user action | recommendation stands as UX polish |
| M-7 | `RootRedirect.tsx:28-31` | the sort+take-first is at `RootRedirect.tsx:48` | shifted but real |

**M-3 stale-framing detail.** Reading `ListSelector.tsx:33-67`:

- Line 87: `{open && !isMobile && pos && createPortal(...desktop popover...)}`
- Line 119: `{isMobile && (...mobile drawer...)}`

The `!isMobile` and `isMobile` predicates are mutually exclusive. There is no code path where both render. The audit's "opens both" claim is either historical (fixed by some earlier change) or always was misleading. **The recommendation is still useful** — the user opens the drawer on mobile, rotates to landscape past `md`, the drawer unmounts and the popover appears on the same `open` state. That's a UX wart (the user didn't ask for the popover) but not a correctness bug. Force-close-on-flip resolves it cleanly.

---

## Commit 1 — M-2: bump `updated_at` in optimistic apply

**Origin:** `REVIEW-quality.md` M-2 (Medium).

**Why:**

Three `useMutation` sites use `makeOptimisticUpdate` with an `apply` function that overlays the patch fields onto the cached row but never bumps `updated_at`. The lists card grid at `ListsPage.tsx:659` displays "Updated Xm ago" via `formatRelativeDate(list.updated_at, now)`. Between optimistic apply and server settle (typically <500ms on fast networks, longer on flaky ones), the card shows the *previous* edit's timestamp even though the user just edited the list. The display visibly snaps to "just now" on settle, which is jarring.

**`RootRedirect.tsx:48`** also reads `updated_at` for the cold-path most-recent tiebreaker, but RootRedirect's data source is the server fetch — not the optimistic cache — so this surface isn't affected by the bug. The fix is purely about the lists card grid display window.

**Files:**

- Modify: `src/lists/ListDetailPage.tsx:322` — `notesMut` apply.
- Modify: `src/lists/ListsPage.tsx:140` — `renameMut` apply.
- Modify: `src/layout/NavBar.tsx:208` — `renameMut` apply (in `ListHeading`).

**What to do:**

For each apply, add `updated_at: new Date().toISOString()` to the spread. Computing the timestamp inline (rather than once per render via a hoisted `now`) is correct here — the apply is called at *mutation time*, not render time, and we want the timestamp at the moment the user clicks save.

```ts
// Before (ListDetailPage.tsx:322):
apply: (item, description) => ({ ...item, description: description || null }),

// After:
apply: (item, description) => ({
  ...item,
  description: description || null,
  updated_at: new Date().toISOString(),
}),
```

Same shape at the other two sites — add `updated_at: new Date().toISOString()` to the patch overlay.

**Why this is safe:**

- The optimistic value is overlaid by the server's authoritative `updated_at` on settle (the standard `makeOptimisticUpdate` settle invalidation refetches). Brief client-vs-server timestamp drift in the optimistic window is harmless and self-corrects.
- No stability comparator looks at `updated_at`. `listItemsArrayEqual` (in `grouping.ts`) ignores it. `groupListItemsByCategory` and the other grouping helpers don't read it. So bumping doesn't churn memo references downstream.
- The other `updated_at: now` sites in the codebase (`ListDetailPage.tsx:248` and `GearLibraryPage.tsx:210`) are *insert* factories inside `optimistic:` for `addGearItemToList` and `createGearItem` — they're already correct (full new-row creation needs a full timestamp). They're not in M-2's scope.

**Verification:**

- `npm run build`, `npm run lint`, `npm test -- --run` all pass.
- Manual smoke (deferred to user, recommended): on `/lists`, edit a list name (renameMut) — the card's "Updated Xm ago" should flip to "just now" immediately, not after the round-trip. Same on the navbar list-heading rename. On `/lists/:id`, edit notes — return to `/lists` and the card should show the fresh timestamp.

**Acceptance criteria:** three apply functions each gain one line; no other shape change. Build/lint/tests stay green.

**Suggested commit:** `fix(lists): bump updated_at in optimistic apply so card grid shows fresh timestamps immediately (M-2)`

---

## Commit 2 — M-3: force-close `ListSelector` on `isMobile` flip

**Origin:** `REVIEW-quality.md` M-3 (Medium). Audit framing partially stale — see verification table above.

**Why:**

The desktop popover and the mobile drawer are mutually exclusive in the current code (lines 87 and 119 both gate on `isMobile` / `!isMobile`). They cannot both render simultaneously, contradicting the audit's "opens both" framing. **However**, the underlying UX concern is real: when `isMobile` flips while `open` is true, the surface that was open unmounts and the *other* surface mounts in its place, with the same `open` state. The user didn't ask for the new surface; it just appears on the next render after the breakpoint flip.

The fix is to force-close on flip. The user can re-open via the chevron after the device class settles, but the surface won't auto-jump from drawer to popover (or vice versa) without an explicit user action.

**Files:**

- Modify: `src/layout/ListSelector.tsx` — add a `useLayoutEffect` keyed on `isMobile` that calls `onOpenChange(false)` when `isMobile` transitions, skipping the mount-time run.

**What to do:**

Add the following inside the `ListSelector` component, after the existing `usePortalPopover` call and before the position `useEffect`:

```ts
// When the device class flips while the selector is open, force-close.
// Without this, the desktop popover and Vaul drawer don't cross-fade —
// they swap surfaces against the same `open` state, so the user sees
// the OTHER surface appear without an explicit action. (The audit
// originally framed this as "opens both" which was inaccurate; the
// surfaces are mutually exclusive at lines 87 / 119. The fix is a UX
// polish, not a correctness bug.)
//
// useLayoutEffect (not useEffect) so the close lands BEFORE paint:
// otherwise React commits the swapped-surface render with `open: true`
// (and, in the drawer→desktop direction, stale `pos` from the last
// desktop opening), the user briefly sees the wrong surface, and only
// then does the close fire. With useLayoutEffect the close-induced
// re-render commits before the browser paints, so the swap is invisible.
//
// Implementation: track previous isMobile in a ref; close on transition.
// Mount-time run is skipped because prev === current on first call.
// We don't depend on `open` to avoid re-firing when the user toggles
// the selector for unrelated reasons.
const prevIsMobile = useRef(isMobile)
useLayoutEffect(() => {
  if (prevIsMobile.current === isMobile) return
  prevIsMobile.current = isMobile
  onOpenChange(false)
}, [isMobile, onOpenChange])
```

Update the React import at the top to include `useLayoutEffect`:

```ts
import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
```

(`useRef` and `useEffect` are already imported; just add `useLayoutEffect`.)

**Why the ref pattern (not a `firstRender` flag):**

- `useIsMobile` is backed by `useSyncExternalStore(matchMedia)`, returning the correct boolean synchronously on mount. So `prev === current` on first call is reliable.
- Comparing `prevIsMobile.current === isMobile` lets the effect re-run safely when `onOpenChange` changes identity (which happens on parent re-renders) without spuriously force-closing — `prev` still equals `isMobile`, the body returns early.
- A `useRef(true)` "skip first render" flag would force-close on the *second* call regardless of whether `isMobile` actually changed, which fires the close on every parent re-render that produces a fresh `onOpenChange` ref.

**Why `useLayoutEffect` and not an `effectiveOpen` render-time guard:**

- `effectiveOpen = open && prevIsMobile.current === isMobile` works in theory but requires reading and updating a ref during render, which fights React's render-purity model and risks tearing under concurrent rendering.
- `useLayoutEffect` runs synchronously after DOM mutations but before browser paint. The close-induced re-render commits in the same paint frame as the device-class flip, so the user never sees the swapped surface render. This matches what the audit's "force-close on flip" intended.
- This codebase is a Vite SPA — no SSR — so the SSR caveat for `useLayoutEffect` (the warning about it running on the server) doesn't apply.

**Verification:**

- `npm run build` — `tsc -b` confirms the ref typing.
- `npm run lint` — `react-hooks/exhaustive-deps` is satisfied (`onOpenChange` in deps).
- `npm test -- --run` — passes (no new tests in this phase).
- Manual smoke (deferred, recommended): open `/lists/:id` with the navbar list-switcher visible. Open the popover at `≥md`. Resize browser below `md` — popover unmounts (existing behavior) AND the drawer should NOT auto-mount; selector should be closed. Same in reverse: open the drawer at `<md` (mobile or rotated tablet), resize past `md` — drawer unmounts, popover should NOT auto-mount.

**Acceptance criteria:** ListSelector adds one effect (~6 lines plus comment). No render-output change for users who don't cross the breakpoint mid-interaction.

**Suggested commit:** `fix(list-selector): force-close on device-class flip to prevent surface auto-swap (M-3)`

---

## Commit 3 — M-7: `RootRedirect` sort → reduce

**Origin:** `REVIEW-quality.md` M-7 (Medium).

**Why:**

`src/layout/RootRedirect.tsx:48` finds the most-recent list via `[...lists].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]`. That allocates a copy of `lists`, sorts it (O(N log N)), and discards N-1 entries. A single-pass `.reduce` does the same job in O(N) with no copy.

Practically the perf savings are theoretical — this code path runs only on the cold path (when localStorage has no `last-list-id`), which is roughly first-login or post-cache-clear. For typical N=5-20 lists, the wall-clock difference is microseconds. **This is a code-clarity fix, not a perf fix.** Worth doing because the `[...arr].sort(...)[0]` idiom signals "pick max" but reads as "sort everything" — `reduce` makes the intent explicit.

**Files:**

- Modify: `src/layout/RootRedirect.tsx:45-50`.

**What to do:**

```ts
// Before:
// fetchLists orders by sort_order then name; resort here by updated_at
// descending so the most-recently-touched list wins. localeCompare on
// the ISO-8601 timestamps is lexicographic-equivalent to chronological.
const [mostRecent] = [...lists].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
if (!mostRecent) return <Navigate to="/lists" replace />
return <Navigate to={`/lists/${mostRecent.id}`} replace />

// After:
// fetchLists orders by sort_order then name; pick the most-recently-
// touched list by max-by-updated_at. localeCompare on the ISO-8601
// timestamps is lexicographic-equivalent to chronological.
const mostRecent = lists.reduce<List | null>(
  (best, l) => (best === null || l.updated_at.localeCompare(best.updated_at) > 0 ? l : best),
  null,
)
if (!mostRecent) return <Navigate to="/lists" replace />
return <Navigate to={`/lists/${mostRecent.id}`} replace />
```

The `List | null` accumulator type matches the existing signature where `mostRecent` could be undefined when `lists` is empty (now `null` instead of `undefined`, but the truthy-check `if (!mostRecent)` handles both identically).

The import for `List` is already present at the top of the file (`import { ... } from '../lib/queries'`). Wait — actually let me re-check; the file imports `fetchLists` from queries but probably not the `List` type. Need to add:

```ts
import type { List } from '../lib/types'
```

at the top of `RootRedirect.tsx` if not already present. Check during execution and add if missing.

**Why this is safe:**

- Same input → same output. The `reduce` finds the max-by-`updated_at` exactly as the sort+take-first did.
- Empty `lists`: `reduce` returns the initial `null` accumulator, the existing `if (!mostRecent)` branch fires identical fallback.
- Single-element `lists`: `reduce` returns that element. Sort+take-first did too.
- Tie on `updated_at`: localeCompare returns 0, the `> 0` predicate is false, so the *earlier* element wins (matches the sort's stable-sort behavior with ascending comparator semantics — actually the sort comparator returns positive for `a > b`, putting larger first, then takes index 0. The reduce keeps the first-encountered element on tie. Different but indistinguishable in practice — ISO-8601 timestamps with millisecond precision rarely tie).

**Verification:**

- `npm run build`, `npm run lint`, `npm test -- --run` all pass.
- Manual smoke (low-value — cold path only): clear localStorage `last-list-id` (DevTools → Application → Local Storage), refresh `/`. Should redirect to the most-recently-edited list.

**Acceptance criteria:** RootRedirect's most-recent picker is one-pass reduce. Behavior on cold path is identical for non-empty / single / multi / empty lists.

**Suggested commit:** `refactor(root-redirect): use reduce for max-by-updated_at instead of sort+take (M-7)`

---

## Commit 4 — Phase 14 summary in `REVIEW-FIX.md`

**Origin:** workflow housekeeping.

**Files:**

- Modify: `.planning/REVIEW-FIX.md` — append `# grampacker — Phase 14 fix summary (2026-05-06)`.

**What to do:**

Use the standard structure (Shipped / Audit closures / Verification results / Blockers / Next phase). Hashes filled in after C1–C3 land. Notable items to capture:

- **M-2:** three sites, one line each. Surface limited to lists card grid display window between optimistic apply and server settle.
- **M-3:** audit framing was partially stale — "opens both" was inaccurate (surfaces are mutually exclusive at lines 87/119). Recommendation preserved as UX polish: force-close on device-class flip prevents the open surface from auto-swapping to the other device class without user action. Document this in the summary so future readers don't think the audit was wrong about the bug — it was wrong about the *symptom*, right about the *fix*.
- **M-7:** code-clarity refactor, not a perf fix (cold-path-only; microseconds at N=20).

**Suggested commit:** `docs(review-fix): append Phase 14 summary`

---

## Audit ledger (mark each as it lands)

- **Commit 1 — `<hash>`** — M-2. Three apply sites in optimistic mutations bump `updated_at` so the lists card grid display reflects the fresh edit immediately, not after the server round-trip. Surfaces fixed: ListDetailPage notesMut, ListsPage renameMut, NavBar renameMut.
- **Commit 2 — `<hash>`** — M-3. ListSelector adds a force-close `useLayoutEffect` on `isMobile` flip via the prevIsMobile-ref pattern. `useLayoutEffect` (not `useEffect`) so the close lands before paint — otherwise React would commit the swapped-surface render with stale `pos` and the user would briefly see the wrong device-class surface before the close fired. Audit's "opens both" framing was inaccurate (surfaces mutually exclusive at lines 87/119); fix preserves spirit as UX polish.
- **Commit 3 — `<hash>`** — M-7. RootRedirect's most-recent picker uses `.reduce` instead of `[...].sort()[0]`. Code-clarity win; cold-path-only so perf delta is theoretical.
- **Commit 4 — `<hash>`** — Phase 14 summary appended to REVIEW-FIX.md.

## Decisions and explicitly-deferred items

- **No new tests in Phase 14.** All three fixes touch render paths or mutation/cache fan-out that's hard to unit-test without jsdom + `@testing-library`. The T-cluster phase will add the tooling install, then we can backfill tests for these surfaces. Documented as a known gap in this phase, not a blocker.
- **M-3 audit framing called out explicitly.** The audit's "opens both" claim is inaccurate against current code. The summary will note this so future readers don't audit-trail back to a non-bug. The fix still ships because the UX polish is real.
- **M-7 framing as code-clarity, not perf.** The cold-path-only execution makes the perf savings theoretical. Documented as such so the commit message and summary don't overclaim.
- **`updated_at` bump is `new Date().toISOString()` per call, not a hoisted `now`.** Mutation-time, not render-time — we want the timestamp captured at mutate-click, not at the most recent render of the page that owns the mutation.
- **Other M-cluster items deferred to Phase 15.** M-1 (mutation observability), M-5 (FileReader error/abort), M-8 (gearById Map), M-10 (consumable-vs-worn precedence assert) — defensive half. Different risk profile (adds guards/observability rather than fixing UX bugs); separate phase.
- **M-4, M-6, M-9, M-11 not in scope here.** M-4 (`crypto.randomUUID` polyfill) is dev-only convenience; M-6 (`Modal` backdrop simplify) and M-9 (`sharedGroupProps` recompute) are minor; M-11 (parseDnDId comment) is a doc-only fix and likely already addressed by Phase 11/12. Triage these in Phase 15 prep — most are likely audit-stale or N-tier.
- **Bundle target:** ≈ ±0.05 KB gzip after all three commits. The reduce form (M-7) is shorter than spread+sort; M-2 adds ~30 chars total; M-3 adds ~120 chars. Net likely flat or slightly negative.
