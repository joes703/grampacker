# grampacker — Phase 9 fixes (2026-05-05)

**Source:** `REVIEW-quality.md` — DRY / clarity / bounds cluster.
**Scope:** four code-quality refactors. Three preserve behavior exactly (W-1 popover scaffolding extraction, W-4 session-helper extraction, W-7 namespace rename); one (W-13) is a small behavior fix — over-cap CSV cost values now import as capped instead of aborting the bulk insert. Five commits (one per refactor + docs).
**Why this is one phase:** all four are mechanical, low-risk, no DB or wire-protocol changes, no migration. Each one closes a `REVIEW-quality.md` finding that's been deferred since the original review. Bundled because individually they're too small to be their own phase, and together they form a coherent "code-shape cleanup" pass.

> **Note on file paths:** all paths are repo-relative.
> **Phase 8 baseline:** main bundle = **187.24 KB gzip**. Bundle delta expected: small drop (~0.5–1.5 KB) — extracting duplicated kebab/popover scaffolding eliminates ~120 lines of repeated state + portal boilerplate.
> **Risk profile:** low. Three pure refactors with mechanical-equivalence preservation; one small behavior fix (W-13) with a regression test. Verified by build + lint + tests + manual smoke at each affected site.

---

## How to execute this file

Five commits. Order isn't strict (no commit depends on another), but suggested order below puts the highest-impact extraction first (W-1) and groups behaviorally-related changes (W-4 user resolution + W-7 namespace fix) together at the end.

For each commit:
1. Make the change.
2. Run `npm run build` — pass.
3. Run `npm run lint` — pass.
4. Run `npm test --run` — 31/31 pass (no test changes in this phase).
5. Manual smoke per the commit's verification section.

---

## Commit 1 — W-1: extract `useAnchoredMenu` for kebab/popover scaffolding

**Origin:** `REVIEW-quality.md` W-1 (Warning).

**Why:**

`usePortalPopover` already centralizes the dismiss listeners (mousedown / scroll / resize / escape — see `src/lib/use-portal-popover.ts`). What it does NOT centralize is the *positioning + portal + state* scaffolding around it. Each kebab independently owns:

```ts
const [menuPos, setMenuPos] = useState<{ top: number; ... } | null>(null)
const triggerRef = useRef<HTMLButtonElement>(null)
const menuRef = useRef<HTMLDivElement>(null)
usePortalPopover({ open: menuPos !== null, onClose: () => setMenuPos(null), triggerRef, menuRef })

function openMenu() {
  if (!triggerRef.current) return
  const rect = triggerRef.current.getBoundingClientRect()
  setMenuPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - MENU_WIDTH) })
}
```

…repeated across (widths verified against current source — REVIEW-quality.md's claimed widths were stale):

- `src/lists/ItemRow.tsx:479-501` (right-flush, **w-48 / 192px**)
- `src/gear/GearItemRow.tsx:169-191` (right-flush, **w-48 / 192px**)
- `src/lists/ListsPage.tsx:550-577` (right-flush, **w-44 / 176px**)
- `src/layout/HamburgerMenu.tsx:18-37` (right-anchored, **uses `right` not `left`**, **w-48 / 192px**)

The first three are mechanically identical (just different menu width). HamburgerMenu uses a `right` anchor instead of `left`, so the helper needs to support both flavors.

**Out of scope (existing popovers NOT being migrated in this commit):** `src/lists/PrivacyButton.tsx`, `src/layout/ListActionsKebab.tsx`, `src/layout/ListSelector.tsx` also follow the inline `useState<{top:…}>` shape but each has bespoke positioning logic (PrivacyButton uses `right`-anchored against a header pill; ListSelector renders a search-filtered list-picker, not a kebab menu; ListActionsKebab has its own context-specific items). Migrating them is a separate cleanup — defer rather than risk regressing their per-site quirks. The acceptance grep below scopes only to the four targeted sites.

**Fix:** add `src/lib/use-anchored-menu.ts` exposing:

```ts
export type MenuPos =
  | { top: number; left: number }
  | { top: number; right: number }

export type AnchorVariant =
  | { variant: 'right-flush'; menuWidth: number }   // top:rect.bottom+4, left:max(8, rect.right - menuWidth)
  | { variant: 'right-anchored' }                   // top:rect.bottom+4, right:max(8, window.innerWidth - rect.right)

export function useAnchoredMenu(anchor: AnchorVariant): {
  open: boolean
  openMenu: () => void
  close: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
  menuRef: RefObject<HTMLDivElement | null>
  menuPos: MenuPos | null
}
```

Internally calls `usePortalPopover` so dismiss behavior is unchanged. Each site collapses from ~22 lines to ~5.

**Files:**

- Create: `src/lib/use-anchored-menu.ts`
- Modify: `src/lists/ItemRow.tsx`, `src/gear/GearItemRow.tsx`, `src/lists/ListsPage.tsx`, `src/layout/HamburgerMenu.tsx`

**What to do:**

### Step 1 — write the hook

```ts
// src/lib/use-anchored-menu.ts
import { useRef, useState } from 'react'
import { usePortalPopover } from './use-portal-popover'
import type { RefObject } from 'react'

type RightFlush = { variant: 'right-flush'; menuWidth: number }
type RightAnchored = { variant: 'right-anchored' }
type AnchorVariant = RightFlush | RightAnchored

type MenuPos =
  | { top: number; left: number }
  | { top: number; right: number }

// Shared kebab/popover scaffolding. Combines:
//   - menuPos state (null = closed)
//   - triggerRef + menuRef (consumed by usePortalPopover for dismiss
//     behavior — mousedown outside, scroll, resize, escape)
//   - openMenu() that reads triggerRef.current.getBoundingClientRect()
//     and computes top/left or top/right per the anchor variant
//
// Anchor variants:
//   - right-flush: menu's right edge aligns with the trigger's right edge.
//     Min 8px from viewport left to avoid clipping. Used by row kebabs.
//   - right-anchored: menu's right edge is `viewport.innerWidth -
//     trigger.right` from the right side. Used by HamburgerMenu and
//     similar fixed-position headers.
export function useAnchoredMenu(anchor: AnchorVariant): {
  open: boolean
  openMenu: () => void
  close: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
  menuRef: RefObject<HTMLDivElement | null>
  menuPos: MenuPos | null
} {
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const open = menuPos !== null
  const close = () => setMenuPos(null)
  // usePortalPopover's API: isOpen + contentRef (NOT open + menuRef).
  // See src/lib/use-portal-popover.ts:27.
  usePortalPopover({ isOpen: open, onClose: close, triggerRef, contentRef: menuRef })

  function openMenu() {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    if (anchor.variant === 'right-flush') {
      setMenuPos({
        top: rect.bottom + 4,
        left: Math.max(8, rect.right - anchor.menuWidth),
      })
    } else {
      setMenuPos({
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      })
    }
  }

  return { open, openMenu, close, triggerRef, menuRef, menuPos }
}
```

### Step 2 — convert `ItemRow.tsx` (w-48 → 192px)

Replace:

```ts
const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
const triggerRef = useRef<HTMLButtonElement>(null)
const menuRef = useRef<HTMLDivElement>(null)
const menuOpen = menuPos !== null
usePortalPopover({ open: menuOpen, onClose: () => setMenuPos(null), triggerRef, menuRef })
function openMenu() { ... }
```

With:

```ts
const { open: menuOpen, openMenu, close, triggerRef, menuRef, menuPos } =
  useAnchoredMenu({ variant: 'right-flush', menuWidth: 192 })
```

`setMenuPos(null)` → `close()` at the JSX click handler (`if (menuOpen) close(); else openMenu()`).
The portal-rendered `<div style={menuPos ?? undefined}>` keeps working — `menuPos` is `{top, left} | null` for right-flush.

### Step 3 — convert `GearItemRow.tsx` (w-48 → 192px)

Same as ItemRow with `menuWidth: 192`. The Tailwind class on the portal `<div>` stays `w-48`.

### Step 4 — convert `ListsPage.tsx`'s per-card `RowKebab` (w-44 → 176px)

Same as ItemRow but `menuWidth: 176`. The Tailwind class on the portal `<div>` stays `w-44` — this is the only one of the three right-flush sites that uses w-44 instead of w-48.

### Step 5 — convert `HamburgerMenu.tsx` (right-anchored, w-48 / 192px — but `menuWidth` is unused for this variant since right-anchoring measures from `window.innerWidth - rect.right`, not from the menu's own width)

```ts
const { open, openMenu, close, triggerRef, menuRef, menuPos } =
  useAnchoredMenu({ variant: 'right-anchored' })
```

The portal `style` consumes `menuPos` which is `{top, right} | null`. `setMenuPos(null)` calls become `close()`.

### Step 6 — verify the four targeted sites have been migrated

```sh
grep -n "useState<{ top:" src/lists/ItemRow.tsx src/gear/GearItemRow.tsx src/lists/ListsPage.tsx src/layout/HamburgerMenu.tsx
```

Should return zero hits after conversion. Other sites (`PrivacyButton.tsx`, `ListActionsKebab.tsx`, `ListSelector.tsx`) are intentionally left alone for this phase — they have bespoke positioning logic and are documented as out-of-scope above.

```sh
# Sanity: confirm out-of-scope sites still match their original pattern
grep -n "useState<{ top:" src/lists/PrivacyButton.tsx src/layout/ListActionsKebab.tsx src/layout/ListSelector.tsx
```

Should still return three hits (one per file) — proves we didn't accidentally migrate them.

**Verification:**

- Build + lint + tests pass.
- Manual smoke (REQUIRED — popover positioning regression risk):
  1. `/lists/<id>` — open the kebab on a list item near the right edge of the viewport AND near the left edge. Confirm dismissal on outside-click, scroll, escape.
  2. `/gear` — same, on a gear-item kebab.
  3. `/lists` — same, on a list card's kebab.
  4. NavBar hamburger menu — open, confirm anchored to right of viewport (not flush against trigger). Resize the window narrow and wide; menu stays anchored to its trigger.
  5. Confirm menu widths visually match pre-refactor: w-48 for ItemRow / GearItemRow / HamburgerMenu, w-44 for ListsPage card kebab.

**Acceptance criteria:** all four targeted kebabs/popovers behave identically to before, ~120 fewer lines of repeated scaffolding, the four targeted sites no longer use the inline `useState<{ top:` pattern. Out-of-scope sites (PrivacyButton, ListActionsKebab, ListSelector) intentionally still match the inline pattern — they're a separate cleanup.

**Suggested commit:** `refactor(ui): extract useAnchoredMenu for kebab/popover scaffolding (W-1)`

---

## Commit 2 — W-4: introduce `useRequireSession` helper

**Origin:** `REVIEW-quality.md` W-4 (Warning).

**Why:**

Session resolution is half-and-half across the app. Some sites:

```ts
const userId = session?.user.id ?? ''
// ... hooks that conditionally use userId ...
if (!session) return null
```

Others:

```ts
const userId = session!.user.id   // bang-asserted, relies on caller wrapping in <RequireSession>
```

Two checks for the same condition (`?? ''` plus later `if (!session) return null`), or a bare `!` that breaks if a caller forgets to wrap in `<RequireSession>`. Both are correct today; both are fragile in a future refactor.

Sites:

- `src/layout/NavBar.tsx:153, 307` — `?? ''` pattern
- `src/lists/ListDetailPage.tsx:102, 110` — `?? ''` pattern
- `src/lists/ListsPage.tsx:85, 242` — `?? ''` pattern
- `src/layout/RootRedirect.tsx:31` — `?? ''` pattern (no early return — uses cached id branch)
- `src/gear/GearLibraryPage.tsx:84` — `!` pattern
- `src/lists/ListsEmptyState.tsx:26` — `!` pattern

**Fix:** add a hook that returns the session (or `null` to signal "render nothing yet"). The hook DOESN'T early-return for the caller — it just centralizes the resolution and the type narrowing. Call sites still own the `if (!auth) return null` branch (necessary for hooks-order stability when other hooks come after).

```ts
// src/auth/use-require-session.ts
import { useAuth } from './AuthProvider'

// Helper for pages that require an authenticated session. Returns
// { session, userId } when authenticated, or null when not.
//
// Single calling convention (every site uses this shape, no
// exceptions — protects hooks-order safety):
//
//   const auth = useRequireSession()
//   const userId = auth?.userId ?? ''
//   // ...all useQuery / useMutation / useMemo / useEffect / useState
//   //    hooks here, in the same order as before...
//   if (!auth) return null
//   // ...rest of render, including auth.session.* if needed...
//
// Collapses the duplicated `userId = session?.user.id ?? ''` /
// `if (!session) return null` pair into one helper, and removes
// `session!.user.id` bangs that relied on a caller wrapping in
// <RequireSession>. The empty-string `userId` fallback keeps queries
// runnable in the brief unauth render before the early-return fires.
export function useRequireSession(): { session: NonNullable<ReturnType<typeof useAuth>['session']>; userId: string } | null {
  const { session } = useAuth()
  if (!session) return null
  return { session, userId: session.user.id }
}
```

**KNOWN RISK — hooks-order safety (single migration shape for ALL sites):**

The `?? ''` pattern was load-bearing in some sites (notably `ListDetailPage.tsx`) because `useQuery({ queryFn: () => fetchListItems(userId) })` runs unconditionally and disabling it via early-return would change hook count between renders. The new helper preserves this — and to avoid accidentally re-introducing a hooks-order violation in the bang-pattern sites, **every site uses the same shape, no exceptions:**

```ts
const auth = useRequireSession()
const userId = auth?.userId ?? ''
// ... ALL other hooks (useQuery, useMutation, useMemo, useEffect, useState, etc.) ...
if (!auth) return null
// ... rest of render, including any access to auth.session if needed ...
```

The bang-pattern sites (`GearLibraryPage`, `ListsEmptyState`) currently look like `const userId = session!.user.id` and rely on a parent `<RequireSession>` wrapper. They migrate to the same shape above — the `?? ''` fallback is harmless when the parent wrapper is in place (the early-return then becomes unreachable, but it's cheap insurance against a future caller forgetting the wrapper).

**Why one shape, not two:**

Codex flagged that the previous draft gave contradictory guidance: a "safe" shape for `?? ''` sites and an "early-return before hooks" shape for bang sites. The latter is a hooks-order trap waiting to happen — the moment someone adds a `useMutation` after the `if (!auth) return null` line, hook count flips between auth and unauth renders. Locking everyone to the safe shape eliminates the foot-gun.

**Files:**

- Create: `src/auth/use-require-session.ts`
- Modify: `src/layout/NavBar.tsx`, `src/lists/ListDetailPage.tsx`, `src/lists/ListsPage.tsx`, `src/layout/RootRedirect.tsx`, `src/gear/GearLibraryPage.tsx`, `src/lists/ListsEmptyState.tsx`

**What to do:**

### Step 1 — write the hook (above)

### Step 2 — convert each site to the single safe shape

For every site (both `?? ''` and bang flavors):

1. `const { session } = useAuth()` → `const auth = useRequireSession()`.
2. `const userId = session?.user.id ?? ''` (or `session!.user.id`) → `const userId = auth?.userId ?? ''`.
3. Keep all other hooks (`useQuery`, `useMutation`, `useMemo`, `useEffect`, `useState`) where they were.
4. After all hooks, `if (!session) return null` (or implicit assumption from a parent `<RequireSession>`) → `if (!auth) return null`.
5. Any post-guard access to the session object: `auth.session.user.id`, `auth.session.user.email`, etc.

**Verify each site's hook count is unchanged** before committing — diff the file pre/post and confirm the ordering of `use*()` calls is identical.

### Step 3 — grep for residual `session?.user.id ?? ''` and `session!.user.id`

```sh
grep -rn "session?\.user\.id ?? ''" src/
grep -rn "session!\.user\.id" src/
```

Both should return zero hits (or only the new helper's internals).

**Verification:**

- Build + lint + tests pass. Note: lint for `react-hooks/rules-of-hooks` will catch any conditional-hook regressions.
- Manual smoke:
  1. Sign out, hard-refresh `/lists`, `/gear`, `/`, `/lists/<id>`. Each should redirect to `/sign-in` cleanly (no flash of empty content, no "userId is undefined" error).
  2. Sign in. Each page renders normally.
  3. Mid-session sign out (use the hamburger menu). Pages currently mounted should unmount without console errors.

**Acceptance criteria:** all six sites use `useRequireSession`, no behavior change, no `session!.user.id` or `session?.user.id ?? ''` outside the helper.

**Suggested commit:** `refactor(auth): centralize session resolution in useRequireSession (W-4)`

---

## Commit 3 — W-7: rename inline `CategoryGroup` in `LibraryPanel`

**Origin:** `REVIEW-quality.md` W-7 (Warning).

**Why:**

`src/lists/LibraryPanel.tsx:121` declares a local component named `CategoryGroup` that shadows the public `lists/CategoryGroup` (the one used on the list-detail page). Two unrelated components, same name, different files. A cold reader sees `CategoryGroup` referenced inside LibraryPanel and can't tell which is meant without checking imports.

**Fix:** rename the local one to `LibraryCategoryGroup` (matches the file's `LibraryPanel` prefix and the `LibraryItemRow` sibling). One file change.

**Files:**

- Modify: `src/lists/LibraryPanel.tsx`

**What to do:**

```sh
grep -n "CategoryGroup" /Users/joe/code/grampacker/src/lists/LibraryPanel.tsx
```

Confirm it's only the local declaration + usage (no import of the public `CategoryGroup`). Rename:

- The `function CategoryGroup(...)` declaration → `function LibraryCategoryGroup(...)`.
- Each `<CategoryGroup ...>` JSX usage inside this file → `<LibraryCategoryGroup ...>`.

If the local component is exported (it shouldn't be), update any external callers — but inline components in a panel file are typically un-exported.

**Verification:**

- Build + lint + tests pass.
- Manual smoke:
  1. Open `/lists/<id>`. Click "Add from library" (or whatever surfaces the panel). Library renders with category groupings exactly as before.

**Acceptance criteria:** no name shadow, library panel behavior unchanged.

**Suggested commit:** `refactor(lists): rename LibraryPanel's inline CategoryGroup to avoid shadow (W-7)`

---

## Commit 4 — W-13: bound CSV `cost` upper end at 99,999,999.99

**Origin:** `REVIEW-quality.md` W-13 (Warning, real bug).

**Behavior change (intentional fix, not a pure refactor):** rows with `cost > 99,999,999.99` previously aborted the entire bulk INSERT with a Postgres `22003 numeric_value_out_of_range`. After this commit they import successfully with `cost` capped at the column max. This is the only commit in Phase 9 with a visible behavior change — the other three (W-1, W-4, W-7) preserve behavior exactly.

**Why:**

`src/lib/csv.ts` `parseCost` accepts any non-negative number. The DB column is `numeric(10,2)` — max value `99,999,999.99`. A CSV row with `cost,99999999999.99` (eleven digits) parses successfully on the client, then fails at INSERT with Postgres `22003 numeric_value_out_of_range`. The bulk insert is one transaction, so a single bad row aborts the entire CSV import — silent data loss from the user's perspective unless they happen to read the toast carefully.

**Fix:** cap parsed cost at the column's maximum.

**Files:**

- Modify: `src/lib/csv.ts` — `parseCost` (around line 247-254 per REVIEW-quality.md; verify exact location at execution time).

**What to do:**

### Step 1 — locate parseCost

```sh
grep -n "function parseCost\|parseCost =" /Users/joe/code/grampacker/src/lib/csv.ts
```

### Step 2 — apply the cap (preserve existing parsing style)

**Read the current `parseCost` first** and modify in-place. Do NOT replace the whole function with the snippet below — the snippet shows the *added cap*, not a rewrite. The goal is one minimal change: wrap the existing successful return in `Math.min(..., 99_999_999.99)`.

The existing `parseCost` may handle null/empty/negative/non-finite differently than the sketch below; preserve those branches. The only new line is the cap. Pseudo-diff:

```diff
   const n = /* existing parse logic — leave unchanged */
   if (/* existing reject conditions — leave unchanged */) return null
-  return Math.round(n * 100) / 100
+  // numeric(10,2) caps at 99,999,999.99 — cap on the client so an
+  // overflow in one row doesn't abort the whole bulk INSERT with a
+  // 22003 numeric_value_out_of_range that takes the entire batch
+  // with it.
+  return Math.min(Math.round(n * 100) / 100, 99_999_999.99)
```

If the existing return is structured differently (e.g. early-returns the rounded number, then has more logic below), apply the `Math.min(..., 99_999_999.99)` to whichever branch produces the final number. The behavioral contract is "no return value greater than 99,999,999.99". Verify by reading `csv.ts` before editing.

### Step 3 — add a test

`src/lib/csv.test.ts` (file exists per the test suite — 31/4 tests). Add:

```ts
import { describe, expect, it } from 'vitest'
import { parseGearCsv } from './csv'   // adjust if parseCost isn't exported — test through the parser

describe('parseGearCsv cost handling', () => {
  it('caps cost at 99,999,999.99 to avoid 22003 on bulk insert', () => {
    const csv = 'name,weight_grams,cost\nWidget,100,99999999999.99\n'
    const result = parseGearCsv(csv)
    // Either expose parseCost or assert via the parsed row's cost field.
    expect(result.rows[0]?.cost).toBe(99_999_999.99)
  })
})
```

If `parseGearCsv` returns a different shape (e.g. `{ rows, errors }`), adapt accordingly. The point is to lock in the cap so a future "let me normalize cost differently" refactor doesn't regress it.

**KNOWN RISK:** if `parseCost` is not exported and the tests have to go through `parseGearCsv`, verify the column header is `cost` (lowercased) and the row shape matches. Read `csv.ts` first to confirm.

**Verification:**

- Build + lint + tests pass (32/31 → 32 pass after adding the new test).
- Manual smoke:
  1. Construct a CSV with `cost,99999999999.99` in one row, normal values in others.
  2. Import via `/gear` CSV upload.
  3. Confirm import succeeds; the over-cap row's `cost` reads as 99,999,999.99 (not null, not rejected).

**Acceptance criteria:** cost caps at the column max client-side, regression test in place, real CSV with an overflow value imports cleanly.

**Suggested commit:** `fix(csv): cap parsed cost at numeric(10,2) max to avoid bulk-insert overflow (W-13)`

---

## Commit 5 — Append Phase 9 summary to REVIEW-FIX.md

**File:** `.planning/REVIEW-FIX.md`

```markdown
# grampacker — Phase 9 fix summary (2026-05-05)

## Shipped

- **Commit 1 (W-1) — `<hash>`** — `useAnchoredMenu` extracted in `src/lib/use-anchored-menu.ts`. Four sites converted (`ItemRow`, `GearItemRow`, `ListsPage` per-card kebab, `HamburgerMenu`). Two anchor variants supported: `right-flush` (row kebabs) and `right-anchored` (NavBar hamburger). ~120 lines of duplicated scaffolding eliminated. `usePortalPopover` is still the dismiss-listener layer underneath.
- **Commit 2 (W-4) — `<hash>`** — `useRequireSession` added in `src/auth/use-require-session.ts`. Six sites converted from the half-and-half `?? ''` / `!` patterns. Hooks-order safety preserved: helper always runs (one hook), early-return is still the caller's responsibility. No behavior change.
- **Commit 3 (W-7) — `<hash>`** — `LibraryPanel`'s inline `CategoryGroup` renamed to `LibraryCategoryGroup` to remove the shadow against `lists/CategoryGroup`.
- **Commit 4 (W-13) — `<hash>`** — `parseCost` in `src/lib/csv.ts` now caps at 99,999,999.99 to match the `numeric(10,2)` column max. Prevents a CSV row with a too-large cost from aborting the entire bulk import with `22003`.

## Verification results

- `npm run build`: pass; bundle gzip <before> → <after>.
- `npm run lint`: pass.
- `npm test --run`: 32/31 pass (one new csv-cost-cap regression test in W-13).
- Manual smoke: <pending or notes>.

## Blockers / surprises

- (fill in or "none")

## Next phase

Phase 10 candidates (no clear winner — user picks):
- **More quality refactors** — W-2 (`assignSortOrderSlots` redundant slice), W-3 (`withSlugRetry` typeguard + unused counter), W-5 (sort_order out of patch types), W-6 (groupByCategory consolidation — careful, touches Phase 5 stability layer), W-8 (`category!` non-null assertions), W-9 (docstring hoist), W-10 (placeholder slug helper), W-11 (sorted cache key), W-12 (parseDnDId tighten). Many small commits; no perf or correctness payoff individually.
- **Medium quality** — M-1 (production observability for failed mutations), M-2 (optimistic `updated_at` bump for fresh "Updated Xm ago"), M-3 (ListSelector mid-flip), M-5 (CSV reader error/abort handling), M-7 (RootRedirect re-sort → reduce), M-8 (gearById Map), M-10 (consumable-vs-worn precedence assert).
- **Security hardening** — F4 (anon enumeration of shared slugs), F5 (`react/jsx-no-target-blank` ESLint rule), F8 (SW cache auth-keying decision).
- **Test-coverage cluster** — T-3…T-9; needs jsdom + `@testing-library` install.

After Phase 9, `REVIEW-quality.md` is partially closed: W-1 (the biggest extraction win), W-4 (auth boilerplate), W-7 (namespace fix), W-13 (real bug). Remaining W- items are mostly micro-cleanups; M- items have observable behavior changes that warrant a separate review pass.
```

**Suggested commit:** `docs(review-fix): append Phase 9 summary`

---

## Out of scope for Phase 9

Explicitly NOT in this phase:

- **W-6 (groupByCategory consolidation).** Three implementations exist (`grouping.ts`, `SharePage.tsx`, `LibraryPanel.tsx`), but the canonical one in `grouping.ts` carries the Phase 5 structural-stability layer (per-group identity invariant, top-level identity invariant, per-call comparator). Folding the two simpler call sites into the same machinery requires careful audit to confirm SharePage and LibraryPanel don't depend on the simpler shape, and would risk regressing the render-perf wins from Phase 5. Worth a separate phase with explicit per-site behavior verification.
- **All M- items.** Each has observable behavior changes (M-1 production logging, M-2 stale `updated_at`, M-3 mid-flip drawer, M-5 CSV abort, M-7 sort algorithm, M-8 lookup map, etc.) that warrant individual review. Bundling them into a "DRY pass" muddles risk profiles.
- **N- items.** Pure stylistic nits (`mutationFn: deleteList` over `(x) => deleteList(x)`, `WeightTable.tsx` early return reorder, `ACTIVE_CLASSES[variant]!` → `??`, etc.). Bundle in a future Phase 11+ as `chore(refactor)` cleanup if desired; no urgency.
- **B- items.** B-1 through B-4 are real bugs. B-1 (orphan-category WeightTable drop) and B-2 (stale embedded category_id) need their own phase with regression tests. B-3 was closed by Phase 4's optimistic-helper fan-out. B-4 (bulk action error toasts) needs UX consideration. None are mechanical "DRY pass" material.
- **Generated-types regen.** Phase 8's RPCs may have introduced a `database.types.ts` drift if the project uses generated types. This would be a one-line `supabase gen types typescript` step, separate from the refactor scope here.

If a commit reveals scope expansion (e.g. W-1's extraction breaks an unexpected popover usage), **stop and surface as a blocker** rather than rewriting the spec inline.
