# grampacker — Phase 4 fixes (2026-05-04)

**Source:** synthesized from `REVIEW-quality.md`, `REVIEW-performance.md`, plus the Phase 3 H5 carry-over.
**Scope:** the render-perf cluster — five audit findings (M11, H5 retry, M8, M7, M12) consolidated into one phase, shipped as **five atomic commits**.
**Why this is one phase:** M11's `useIsMobile()` JS gate is the prerequisite for H5 to actually move vaul out of the main bundle. M8 + M7 + M12 are LibraryPanel / CategoryGroup re-render fixes that share the same mental model. Bundling them lets each commit land with the prior one's invariants in place.

> **Note on file paths:** all paths are repo-relative.
> **Phase 3 baseline:** main bundle = **204.91 KB gzip**. H5 retry should produce a measurable delta from this number.

---

## How to execute this file

Five commits, **strict ordering for the first two** — Commit 1 (M11) MUST land before Commit 2 (H5 retry); without M11's JS render gate, H5 reproduces the Phase 3 regression. Commits 3, 4, 5 are independent and can land in any order, but the recommended order below puts the highest-leverage / lowest-risk first.

For each commit:
1. Make the change exactly as specified.
2. Run `npm run build` and confirm typecheck passes; for H5 (Commit 2) capture the bundle-size delta in the message.
3. Run existing tests (`npm test --run`); all 23 must stay green.
4. Commit with the suggested message.

After all five: append to `REVIEW-FIX.md` with one row per commit and a phase summary.

---

## Commit 1 — Hoist breakpoint hooks and JS-gate the three `<lg` branches (M11)

**Origin:** REVIEW-performance.md M11 (Medium); plus the prerequisite for H5 retry (Phase 3 carry-over).

**Why:**

Three branches in the codebase are currently rendered unconditionally and merely hidden via Tailwind's `lg:hidden` utility (which switches at **1024 px**, not 768 px):

1. `ItemRow.tsx:204` — `<div className="hidden lg:contents">` (desktop body) AND `ItemRow.tsx:343` — `<div className="lg:hidden">` (mobile body) both mount on every render. With ~300 list items, that's 600 branch instances on mobile / desktop, half of which are invisible.
2. `GearItemRow.tsx:66` (`hidden lg:contents`) and `:104` (`lg:hidden`) — same shape.
3. `ListDetailPage.tsx:771-815` — the sidebar `<Drawer.Root direction="left">` renders on every list page even on desktop, hidden via `lg:hidden` on its overlay/content. The hamburger trigger that opens it (`NavBar.tsx:68`) is also `lg:hidden` — meaning at <1024 px it's visible. This is the structural blocker on H5.

**Critical breakpoint distinction:** the existing `useIsMobile()` private to `ListSelector.tsx` matches `(max-width: 767px)` — that's correct for the **bottom-sheet selector** (a small-viewport-only UI). It is WRONG for the three sites above, which are `<lg` (i.e. `<1024px`). Using the 767px hook for ItemRow / GearItemRow / ListDetailPage's drawer would render desktop bodies on tablets (768–1023 px) while CSS layout still expects mobile bodies, AND would let the hamburger be visible without a drawer to mount.

**Fix shape:** introduce a SECOND, separate hook `useIsBelowLg()` for the three new sites. Leave `useIsMobile()` as-is for `ListSelector` (its bottom sheet is genuinely <md). Both hooks live in one new file (`src/lib/use-breakpoint.ts`) and use a SHARED external matchMedia subscription so a list with 300 rows doesn't register 300 listeners (Codex finding 3).

**Files:**
- Create: `src/lib/use-breakpoint.ts` (exports both hooks + the shared subscription)
- Modify: `src/layout/ListSelector.tsx` (replace inline `useIsMobile` with the imported one)
- Modify: `src/lists/ItemRow.tsx`
- Modify: `src/gear/GearItemRow.tsx`
- Modify: `src/lists/ListDetailPage.tsx`

**What to do:**

### Step 1 — Extract both hooks with a shared subscription

Create `src/lib/use-breakpoint.ts`:

```ts
import { useSyncExternalStore } from 'react'

// Two breakpoints used by the app. Keep the strings here as the single
// source of truth — Tailwind's `lg:` is 1024px and Tailwind's `md:` is
// 768px, so `useIsBelowLg()` matches the negation of `lg:` and
// `useIsMobile()` matches the negation of `md:`.
const QUERIES = {
  belowLg: '(max-width: 1023px)',
  mobile: '(max-width: 767px)',
} as const

// useSyncExternalStore lets every consumer of the same query share one
// matchMedia listener. Without this, a list with 300 rows would register
// 300 separate listeners that all fire on every breakpoint cross.
function subscribe(query: string) {
  return (onChange: () => void) => {
    if (typeof window === 'undefined') return () => {}
    const mq = window.matchMedia(query)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }
}
function getSnapshot(query: string) {
  return () =>
    typeof window !== 'undefined' && window.matchMedia(query).matches
}
function getServerSnapshot() {
  return false
}

// Pre-bind subscribe / getSnapshot per query so identity is stable across
// renders and useSyncExternalStore can dedupe correctly.
const belowLgSubscribe = subscribe(QUERIES.belowLg)
const belowLgGetSnapshot = getSnapshot(QUERIES.belowLg)
const mobileSubscribe = subscribe(QUERIES.mobile)
const mobileGetSnapshot = getSnapshot(QUERIES.mobile)

// True at <1024px. Use for sites that swap behavior at Tailwind's `lg:`
// boundary (rows with desktop+mobile bodies, the sidebar drawer, etc.).
export function useIsBelowLg(): boolean {
  return useSyncExternalStore(belowLgSubscribe, belowLgGetSnapshot, getServerSnapshot)
}

// True at <768px. Use for sites that swap behavior at Tailwind's `md:`
// boundary (the bottom-sheet list selector).
export function useIsMobile(): boolean {
  return useSyncExternalStore(mobileSubscribe, mobileGetSnapshot, getServerSnapshot)
}
```

The shared-subscription shape lets every caller of `useIsBelowLg()` share one underlying `matchMedia('(max-width: 1023px)')` listener — even with hundreds of row instances, only one DOM listener is registered (matchMedia listeners are deduped by query string), and React's `useSyncExternalStore` batches the notifications.

### Step 2 — Replace the inline hook in ListSelector

In `src/layout/ListSelector.tsx`, delete the local `useIsMobile` function (lines 29-40) and import: `import { useIsMobile } from '../lib/use-breakpoint'`. No behavior change.

### Step 3 — JS-gate `ItemRow.tsx`

Read `src/lists/ItemRow.tsx` end-to-end first. Identify the desktop branch at line 204 (`<div className="hidden lg:contents">`) and the mobile branch at line 343 (`<div className="lg:hidden">`).

**Important — call site, not inside the row:** to avoid 300 instances of the hook on a long list (Codex finding 3), do NOT call `useIsBelowLg()` inside `ItemRow`. Instead:
- Compute `isBelowLg` once in the parent that maps over rows. The parents that render `ItemRow` are inside `CategoryGroup` / `LibraryPanel` rows — go up one more level to whatever component first owns the list-level loop (typically the page component).
- Pass `isBelowLg` down as a prop to `ItemRow` and `GearItemRow`. Add it to `sharedGroupProps` (the existing prop bag in `ListDetailPage.tsx`) — that bag is already memoized; add `isBelowLg` to its memo deps.

The Codex finding's alternative — implementing the hook with a shared external subscription via `useSyncExternalStore` (Step 1 above) — also addresses this concern. With `useSyncExternalStore`, calling the hook in 300 rows is functionally equivalent to one call (one DOM listener, batched updates). BOTH defenses are in: shared subscription via `useSyncExternalStore`, AND prop drilling from page-level so individual rows don't subscribe at all. Belt-and-braces; the prop drill is the cheaper one and matches how the row-level data flow already works.

Replace the two `<div>` branches with a JS conditional that consumes `isBelowLg` via prop:

```tsx
{isBelowLg ? (
  <div className="flex flex-1 items-center gap-1">
    {/* mobile body — content from the existing lg:hidden div */}
  </div>
) : (
  <>
    {/* desktop body — content from the existing hidden lg:contents div */}
  </>
)}
```

Drop the `hidden lg:contents` / `lg:hidden` Tailwind classes. Preserve every event handler, ref binding, and ARIA attribute.

### Step 4 — JS-gate `GearItemRow.tsx`

Same pattern as ItemRow:
- Receive `isBelowLg` as a prop from the page-level component (`GearLibraryPage`).
- Replace the two branches at lines 66 and 104 with a JS conditional consuming the prop.
- Drop the `hidden lg:contents` / `lg:hidden` classes.

### Step 5 — JS-gate `ListDetailPage.tsx` sidebar drawer

In `src/lists/ListDetailPage.tsx`, call `useIsBelowLg()` ONCE at the page level (not inside any row), and use it to:

1. Wrap the sidebar `<Drawer.Root direction="left">...</Drawer.Root>` block (lines 771-815) with `{isBelowLg && (...)}`. Desktop genuinely doesn't mount it.
2. Pass `isBelowLg` into `sharedGroupProps` so `ItemRow` instances get it without subscribing themselves.

The `lg:hidden` Tailwind classes inside the drawer block can stay or be removed — they're no-ops once the JS gate is in place. Prefer removal for clarity but don't gold-plate.

**Important:**
- ListDetailPage's `useRegisterSidebarDrawer()` registration and `drawerOpen` state stay OUTSIDE the gate — `NavBar`'s hamburger writes to them via context.
- The hamburger button itself (`NavBar.tsx:68`) is `lg:hidden`. Leave it — keeping the JS gate to the drawer mount is sufficient; the hamburger button is a single instance, no perf concern.
- A viewport resize crossing the 1024 px breakpoint will toggle the drawer mount. Expected behavior.

**Verification:**

- Typecheck passes.
- Build passes. **DO NOT expect a bundle-size drop in this commit** (Codex finding 2). vaul is still statically imported by `ListDetailPage.tsx` and `ListSelector.tsx`, so the chunk doesn't move yet. The bundle-size win lives in Commit 2.
- What to verify INSTEAD:
  - `npm run build` succeeds.
  - At runtime on a desktop viewport (DevTools), the sidebar `Drawer.Root` is absent from the React component tree on `/lists/:id`. (Use React DevTools Components panel: search for `Drawer` — it should not appear except on the `<lg` viewport.)
  - At a tablet viewport (e.g. 900 px wide), mobile body branches DO render and the sidebar drawer DOES mount. Pre-fix this site would render desktop bodies at 900 px because the audit-1 estimate was wrong.
- Manual smoke (REQUIRED before considering this commit done):
  1. Mobile viewport (≤767 px): list view renders, gear view renders, hamburger drawer opens — all behavior preserved.
  2. Tablet viewport (768–1023 px): mobile bodies render, hamburger drawer opens. (Pre-fix the rows showed desktop layout here, hidden by CSS — the new gate is correct, but the body for tablets is the same as for mobile because the CSS hide-rule was `lg:`.)
  3. Desktop viewport (≥1024 px): list view renders without `Drawer` in the tree. Resize across 1024 px breakpoint: no flash, no error.

**Acceptance criteria:** two breakpoint hooks live in `src/lib/use-breakpoint.ts` with a shared external subscription, three sites JS-gated via `useIsBelowLg()` with the gate computed at page-level and prop-drilled to rows, no Tailwind `lg:hidden` survives at any of the three sites, build passes, runtime DOM verification clean.

**Suggested commit:** `perf(render): JS-gate <lg branches via shared useIsBelowLg hook (M11)`

---

## Commit 2 — H5 retry: lazy-load both vaul drawers (H5)

**Origin:** Phase 3 H5 carry-over, now unblocked by Commit 1.

**Why:**

With Commit 1's JS gate in place, the lazy-loaded drawer wrappers no longer mount on desktop, so the chunk fetch genuinely defers. This was the missing piece in Phase 3 — recreating the `ListSelectorDrawer` extraction PLUS doing the same for ListDetailPage's sidebar drawer should move vaul into an async chunk and produce a real ~10–18 KB gzip win.

**Files:**
- Create: `src/layout/ListSelectorDrawer.tsx` (re-create — was reverted in Phase 3)
- Create: `src/lists/ListSidebarDrawer.tsx`
- Modify: `src/layout/ListSelector.tsx`
- Modify: `src/lists/ListDetailPage.tsx`

**What to do:**

### Step 1 — Re-create `ListSelectorDrawer.tsx`

Same extraction as the reverted Phase 3 attempt. The file owns the `<Drawer.Root direction="bottom">...</Drawer.Root>` block from `ListSelector.tsx`, takes `{open, onOpenChange, children}` as props, and `children` is rendered inside `Drawer.Title`'s sibling slot — `SelectorBody` stays in `ListSelector.tsx` (it's used by the desktop popover too and doesn't depend on vaul).

### Step 2 — Wire `ListSelector.tsx` to `React.lazy` it

Inside the `{isMobile && (...)}` gate (which Commit 1 didn't touch — `ListSelector` was already JS-gated in Phase 3 baseline), replace the inline `<Drawer.Root>...</Drawer.Root>` with:

```tsx
{isMobile && (
  <Suspense fallback={null}>
    <ListSelectorDrawer open={open} onOpenChange={onOpenChange}>
      <SelectorBody
        lists={lists}
        currentListId={currentListId}
        userId={userId}
        onClose={() => onOpenChange(false)}
      />
    </ListSelectorDrawer>
  </Suspense>
)}
```

Remove the now-unused `import { Drawer } from 'vaul'`. Add `import { Suspense, lazy } from 'react'` and `const ListSelectorDrawer = lazy(() => import('./ListSelectorDrawer'))`.

### Step 3 — Create `ListSidebarDrawer.tsx`

Extract the sidebar drawer block (`<Drawer.Root direction="left">...</Drawer.Root>`) from `ListDetailPage.tsx`. The file takes the props the drawer references (props for `drawerOpen`, `setDrawerOpen`, the rendered sidebar content). Pattern identical to `ListSelectorDrawer.tsx`: vaul-importing wrapper + children.

The interior of the drawer is substantial (sidebar header + the ListSelector + child component links). Keep the extraction shape simple: `{ open, onOpenChange, children }` is enough — the parent passes the entire sidebar content as children, and `ListSidebarDrawer` only owns the `<Drawer.Root direction="left">` / `<Drawer.Portal>` / `<Drawer.Overlay>` / `<Drawer.Content>` / `<Drawer.Title>` structural shell.

If the existing drawer block has a custom `Drawer.Title` row with close buttons etc., keep that in the wrapper — it's drawer chrome, not sidebar content.

### Step 4 — Wire `ListDetailPage.tsx` to `React.lazy` it

Inside the `{isMobile && (...)}` gate that Commit 1 added, replace the inline drawer block with:

```tsx
{isMobile && (
  <Suspense fallback={null}>
    <ListSidebarDrawer open={drawerOpen} onOpenChange={setDrawerOpen}>
      {/* the sidebar content that was inside Drawer.Content */}
    </ListSidebarDrawer>
  </Suspense>
)}
```

Remove the now-unused `import { Drawer } from 'vaul'`. Add the lazy import.

**Verification:**

This commit is where the actual bundle delta lands (Commit 1 was structural prep — no bundle move expected from JS-gating alone since vaul was still statically imported).

- `npm run build` — confirm:
  - Build succeeds.
  - A new chunk appears containing `vaul`.
  - Main `index-*.js` gzip drops by ~10–18 KB.
  - Capture the post-Commit-1 size as the BEFORE number, and the post-Commit-2 size as AFTER, in the commit message.
- `npm test --run` — 23/23 still pass.
- Manual smoke:
  - Mobile: ListSelector dropdown opens as bottom sheet, sidebar drawer opens via hamburger, both close, both render content correctly.
  - Desktop: open DevTools Network, navigate to `/lists/:id` — no `vaul` chunk should be fetched (or, if it's prefetched by Vite's `modulepreload`, that's acceptable; the goal is no synchronous load on the critical path).

**Acceptance criteria:** vaul is in an async chunk, main bundle measurably smaller, both drawers work on mobile, no chunk fetched on desktop.

**Suggested commit:** `perf(bundle): lazy-load both vaul drawers behind isMobile gate (H5 retry)`

---

## Commit 3 — Stabilize `sharedGroupProps` deps via refs (M8)

**Origin:** REVIEW-performance.md M8 (Medium).

**Why:**

`src/lists/ListDetailPage.tsx:471-498` builds `sharedGroupProps` via `useMemo`, but the deps include `gearItems` and `listItems` because the closures inside call `.find` against them. Every list-items mutation invalidates `gearItems` or `listItems` (or both via the Phase 2 fan-out), which busts the memo, mints fresh prop references, and re-renders every `CategoryGroup` — and dnd-kit's `useSortable` per row inside each group. During pack-mode (rapid checkbox toggles), this is the dominant render cost.

The fix: store the latest arrays in refs (`useRef`), keep the closures reading `.current` so they always see the latest data, and DROP the arrays from the memo deps. The closures still get the freshest values; the memo no longer churns on every list-items mutation.

**File:** `src/lists/ListDetailPage.tsx` (the `sharedGroupProps` memo block, around line 471)

**What to do:**

### Step 1 — Read the current memo

Read the existing `sharedGroupProps` memo. List every closure inside that references `gearItems` or `listItems`. Confirm those arrays are read inside event handlers, not directly in the memo body.

If any closure reads `gearItems[i]` directly in the memo body (not in a handler), STOP and surface as a blocker — that closure can't be safely converted to a ref read because the value would be a stale snapshot. Refs are appropriate ONLY when the closure runs in response to a user gesture (handler), not synchronously during memo computation.

### Step 2 — Add refs

Above the memo, add:

```tsx
const gearItemsRef = useRef(gearItems)
gearItemsRef.current = gearItems
const listItemsRef = useRef(listItems)
listItemsRef.current = listItems
```

The unconditional assignment (`.current = ...` on every render) is the canonical pattern — refs aren't reactive, so the assignment runs synchronously to keep the ref fresh without triggering a re-render.

### Step 3 — Convert closures to read `.current`

Inside the memo body, every `.find` / `.some` / `.map` against `gearItems` becomes `gearItemsRef.current.find(...)`, etc. Same for `listItems` → `listItemsRef.current`.

### Step 4 — Drop arrays from deps WITHOUT regressing the existing mutation-ref strategy

Remove `gearItems` and `listItems` from the `useMemo` dependency array.

**Critical context** (Codex finding 4): the existing memo at `ListDetailPage.tsx:497-508` deliberately EXCLUDES the full `useMutation` result objects from deps because TanStack Query rebuilds the wrapper object on every render even when the underlying `.mutate` callback is stable. The existing comment block at lines 500-507 documents this and explains why no eslint-disable is present (the closure reads `.mutate` through the live binding at call time, which is always the current stable ref). DO NOT add `updateMut`, `removeMut`, etc. to the deps.

The same shape applies to the new ref reads: `gearItemsRef.current` and `listItemsRef.current` are read inside closures, so the refs themselves don't go in deps either (refs are stable by definition).

After the change, the memo deps should look essentially identical to today's deps — minus `gearItems` and `listItems`. If the linter complains, **first** check whether the missing dep is read OUTSIDE a closure (synchronous in the memo body) — if so, add it back to the deps and reconsider whether the ref pattern applies. If the missing dep is only read INSIDE closures, the existing pattern (don't add, don't disable) is correct; the linter rule is misfiring on the same shape it misfires on for `updateMut.mutate`.

**Acceptance criteria for the deps:**
- No `gearItems`, `listItems`, `gearItemsRef`, or `listItemsRef` in the deps.
- No new `// eslint-disable-next-line` directives.
- No `useMutation` result objects added to deps.
- Build passes (which includes the eslint check via `tsc -b`).

**Important:**
- This is a behavior-preserving refactor. No new tests required, but the Phase 1 WeightTable test continues to be a sanity check.

**Verification:**

- `npm run build` — build passes.
- `npm test --run` — 23/23 still pass.
- Manual smoke (REQUIRED): on a list with multiple categories, toggle the packed checkbox on a single item rapidly. With React DevTools profiler, confirm only the affected `ItemRow` re-renders — not every `CategoryGroup`. (Pre-fix, every group re-renders on every checkbox tick.)

**Acceptance criteria:** `sharedGroupProps` deps no longer include `gearItems` or `listItems`, closures read via `.current`, build passes, render-profile shows scoped re-render.

**Suggested commit:** `perf(render): stabilize sharedGroupProps via refs to prevent CategoryGroup churn (M8)`

---

## Commit 4 — Memoize LibraryPanel derivations + React.memo CategoryGroup (M7, M12)

**Origin:** REVIEW-performance.md M7 + M12 (Medium).

**Why:**

`LibraryPanel.tsx:45-60` recomputes `filtered`, `sortedCats`, `groups`, and `uncategorized` on every render. The parent (`ListDetailInner`) re-renders on every drag tick, dialog change, and `NotesEditor` keystroke, so these derivations run far more often than they need to. Wrapping each in `useMemo` with the right deps fixes M7.

`LibraryPanel.tsx:121-209` defines an inner `CategoryGroup` component that isn't memoized. Even after Commit 3 stabilizes `sharedGroupProps`, the inner CategoryGroup still re-renders if its parent re-renders (no memo barrier). `React.memo(CategoryGroup)` is the standard barrier; the parent already memoizes `listItemGearIds` (a `Set`) so reference is stable.

These two fixes pair naturally — M7 reduces wasted derivation, M12 stops the propagation of unchanged props through the inner component.

**File:** `src/lists/LibraryPanel.tsx`

**What to do:**

### Step 1 — Memoize derivations

Wrap `filtered`, `sortedCats`, `groups`, `uncategorized` in `useMemo` with deps that are the actual inputs (e.g. `[items, query]` for filtered, `[categories]` for sortedCats, `[filtered, sortedCats]` for groups, etc.). Match exactly what each computation reads; don't be defensive.

### Step 2 — Memoize the inner CategoryGroup AND fix the per-render onToggle closures

Find the inner `CategoryGroup` definition (around line 121).

**Critical** (Codex finding 5): `LibraryPanel.tsx:93` and `:106` currently pass `onToggle={() => toggleCollapse(category.id)}` and `onToggle={() => toggleCollapse('__uncategorized__')}` — fresh inline arrow closures on every parent render. Wrapping CategoryGroup in `React.memo` alone is NOT sufficient: the memo's shallow compare sees a new `onToggle` prop reference every render and re-runs the body anyway. The component API has to change so the toggle key flows in via a stable identity.

**Two-part change:**

**Part A — change CategoryGroup's API to accept a key + a stable toggle function:**

```tsx
type CategoryGroupProps = {
  // …existing props
  toggleKey: string                          // category.id, or '__uncategorized__'
  onToggle: (key: string) => void            // stable — wrapped in useCallback in parent
}
```

Inside the component body, change the existing `onToggle()` call (likely on the section header click) to `onToggle(toggleKey)`.

**Part B — make the toggle callback stable in the parent:**

In `LibraryPanel`:

```tsx
const onToggle = useCallback((key: string) => toggleCollapse(key), [toggleCollapse])
```

If `toggleCollapse` itself is reference-stable (e.g. it comes from `useToggleSet`'s returned object — verify by reading the source), `useCallback` is unnecessary and you can pass `toggleCollapse` directly to `onToggle`. If it's NOT stable, the `useCallback` wraps it.

Then both call sites become:

```tsx
<CategoryGroup
  toggleKey={category.id}
  onToggle={onToggle}
  // …other props
/>

<CategoryGroup
  toggleKey="__uncategorized__"
  onToggle={onToggle}
  // …other props
/>
```

No more inline arrows. `onToggle` reference is stable across renders, `toggleKey` is a string equality so shallow compare works.

**Part C — wrap with React.memo:**

```tsx
const CategoryGroup = React.memo(function CategoryGroup({
  toggleKey,
  onToggle,
  // …
}: CategoryGroupProps) {
  // …existing body, calling onToggle(toggleKey) where it used to call onToggle()
})
```

**Audit other props** for reference stability: `onAdd`, `onRemove`, `listItemGearIds`, `weightUnit`. If any is fresh-on-every-render (look for inline arrows, fresh array/object literals, etc.), wrap with `useCallback` / `useMemo` at the parent. If they're already stable (from another memo, or a string/number primitive), no change. Don't wrap defensively — only what actually churns.

**Important:**
- Don't rename the inner `CategoryGroup` to avoid the existing name shadow with `src/lists/CategoryGroup.tsx`. That's W-7's job (separate phase).
- React.memo's default shallow comparison is correct here. Don't pass a custom `arePropsEqual` unless profiling proves it's needed.

**Verification:**

- `npm run build` — build passes.
- `npm test --run` — 23/23 still pass.
- Manual smoke: open a list with the gear picker visible, toggle pack-mode checkboxes rapidly, confirm the gear-picker categories don't re-render on every list-items mutation. (React DevTools profiler should show LibraryPanel as a leaf in the render tree on those updates.)

**Acceptance criteria:** four memos in LibraryPanel, `React.memo` around the inner CategoryGroup, build passes, profile-confirmed scoped re-renders.

**Suggested commit:** `perf(render): memoize LibraryPanel derivations and CategoryGroup (M7, M12)`

---

## Commit 5 — Append Phase 4 summary to REVIEW-FIX.md

**File:** `.planning/REVIEW-FIX.md`

Append below the existing Phase 3 section. Structure:

```markdown
## Phase 4 — render-perf cluster + H5 retry (DATE)

### Shipped
- Commit 1 (M11) — `<hash>` — useIsMobile() hoisted to src/lib/, three mobile-only branches JS-gated. Halves component instance count on mobile for ItemRow / GearItemRow; ListDetailPage's sidebar drawer no longer mounts on desktop.
- Commit 2 (H5 retry) — `<hash>` — both vaul drawers React.lazy-loaded behind the isMobile gate. Main bundle gzip: <before> → <after> (-N KB). Vaul moved to async chunk. Phase 3's H5 carry-over closed.
- Commit 3 (M8) — `<hash>` — sharedGroupProps deps stabilized via refs. CategoryGroup no longer re-renders on every list-items mutation; pack-mode checkbox tick now scoped to the affected ItemRow.
- Commit 4 (M7, M12) — `<hash>` — LibraryPanel derivations memoized + React.memo around the inner CategoryGroup. Gear picker no longer re-renders on parent state churn.

### Verification results
- npm run build: pass after each commit, with the H5 chunk visible.
- npm test --run: 23/23 pass.
- Manual smoke: mobile drawers (selector + sidebar), desktop no-vaul-load, pack-mode scoped re-render: pending user verification.

### Blockers / surprises
- (fill in or "none")

### Next phase
Phase 5: lower-leverage perf cleanups (M6 single-pass bucket map, L1 WeightTable memo, L2 SharePage categoryIds memo, L9 hoisted Intl formatter) plus the W-1 useAnchoredMenu refactor. Or move to DB indexes (H1, M1) for backend perf.
```

**Suggested commit:** `docs(review-fix): append Phase 4 summary`

---

## Out of scope for Phase 4

Explicitly NOT in this phase:

- **W-1 (`useAnchoredMenu` refactor)** — separate Phase 5 cleanup. Mechanically distinct from render perf.
- **W-7 (rename inner `CategoryGroup` to break the shadow with `src/lists/CategoryGroup.tsx`)** — separate from M12. M12 just adds the memo wrapper; the rename is a bigger code-clarity refactor.
- **M6 (single-pass bucket map in grouping helpers)** — defer; lower-leverage at current row counts.
- **L1, L2, L9** — small wins, defer to Phase 5.
- **DB indexes (H1, M1)** — separate phase, requires migration.
- **All test gaps T-2 through T-9** — Phase 7 territory.

If something looks like it requires expanding scope mid-commit, **stop and surface it** as a blocker.
