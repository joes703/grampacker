# grampacker — Phase 7 fixes (2026-05-05)

**Source:** `REVIEW-performance.md` — the small-perf-nits cluster.
**Scope:** three small perf fixes (L9, M9, M4) + two audit verifications (L3-L4, M13).
**Why this is one phase:** all three code fixes are independent, low-risk, render-or-cold-path-only changes that ride together. M13 and L3-L4 are explicit no-ops with rationale recorded — closing them keeps the audit ledger from accumulating "still open?" stragglers.

> **Note on file paths:** all paths are repo-relative.
> **Phase 6 baseline:** main bundle = **187.02 KB gzip**.
> **Bundle expectation for Phase 7:** essentially flat. None of these change what code ships.
> **Risk profile:** low. Each commit touches one file (or one file + a tiny new helper), behavior changes are scoped, and the existing test suite still applies.

---

## How to execute this file

Three active commits + one no-op-audit slot + one docs summary. Each commit is independent.

For each:
1. Make the change exactly as specified.
2. `npm run build` — pass; bundle gzip stays within ±0.2 KB of 187.02.
3. `npm run lint` — pass.
4. `npm test --run` — 31/31 pass.
5. Manual smoke per the commit's verification section.
6. Commit with the suggested message.

---

## Commit 1 — L9: hoist `Intl` date formatter in `formatPurchaseDate`

**Origin:** REVIEW-performance.md L9 (Low) — the actual L9, finally addressed (Phase 5 confused this with `formatItemWeight`).

**Why:**

`src/gear/GearItemRow.tsx:144-149` defines:

```ts
function formatPurchaseDate(date: string | null): string {
  if (date === null) return '—'
  const d = new Date(`${date}T00:00:00`)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
```

`d.toLocaleDateString(...)` constructs an internal `Intl.DateTimeFormat` on every call. With ~300 gear rows on a long inventory page, that's 300 formatter constructions per render. The same file already has a hoisted `COST_FORMATTER` (line 131-134) — extending the pattern to dates is the obvious template.

`undefined` for the locale argument intentionally honors the user's browser locale, so the hoisted formatter must too (and it does — `Intl.DateTimeFormat(undefined, ...)` is the same call without the wrapping `Date.prototype.toLocaleDateString` indirection).

**File:** `src/gear/GearItemRow.tsx`

**What to do:**

Hoist a `DATE_FORMATTER` constant alongside the existing `COST_FORMATTER`:

```ts
// purchase_date arrives as ISO YYYY-MM-DD. Parsing as 'YYYY-MM-DDT00:00:00'
// keeps it in local-time so a 2024-04-15 entry doesn't render as Apr 14
// for users west of UTC. Output uses the user's locale via undefined-locale
// for readability ("Apr 15, 2024" in en-US).
//
// Hoisted because GearLibraryPage renders one cell per gear row; constructing
// a fresh formatter per row was the audit-caught L9 cost.
const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

function formatPurchaseDate(date: string | null): string {
  if (date === null) return '—'
  const d = new Date(`${date}T00:00:00`)
  if (isNaN(d.getTime())) return '—'
  return DATE_FORMATTER.format(d)
}
```

**KNOWN RISK:** the previous `Date.prototype.toLocaleDateString(undefined, opts)` is implemented in V8 by calling `Intl.DateTimeFormat(undefined, opts).format(this)` — the output is identical. If a Node version somewhere in the toolchain has a different `toLocaleDateString` polyfill, output could drift. The build runs in modern V8 (Vite + Cloudflare Pages), so this is theoretical. Spot-check post-fix that an actual purchase_date renders the same string as before (e.g. `Apr 15, 2024`).

**Locale-change caveat:** the formatter is constructed at module load. If the user changes their browser locale mid-session, the formatter doesn't pick up the change until full reload. The previous shape had the same property in practice — `toLocaleDateString` reads the locale at call time but virtually no SPA respects mid-session locale changes anyway, and we're not localizing anything else. Acceptable.

**Verification:**
- `npm run build` — pass; bundle flat.
- `npm run lint` — pass.
- `npm test --run` — pass.
- Manual smoke: load `/gear` with at least one item that has a purchase_date set; verify the date renders unchanged. Open DevTools, check the rendered text against a screenshot of the pre-fix state if possible.

**Acceptance criteria:** `DATE_FORMATTER` constant in module scope, `formatPurchaseDate` calls `.format()` on it, output identical character-for-character.

**Suggested commit:** `perf(gear): hoist Intl.DateTimeFormat in formatPurchaseDate (L9)`

---

## Commit 2 — M9: tick `formatRelativeDate` so "1 min ago" updates

**Origin:** REVIEW-performance.md M9 (Medium-Low).

**Why:**

`src/lists/ListsPage.tsx:692-713` renders relative dates ("just now", "5 mins ago", "2 hours ago", "3 days ago") on each list card. The function reads `Date.now()` at render time only — so once a card mounts saying "1 min ago", that text stays exactly "1 min ago" forever, even after the user has been on the page for an hour. The audit calls this out as a UX bug masquerading as a perf finding.

The audit suggests two options: (a) drop relative for absolute, or (b) tick on an interval. Going with (b) — the relative-vs-absolute display choice is a separate UX decision and the relative form is more glanceable.

**Fix shape:** introduce a `useNow(intervalMs)` hook that returns `Date.now()` and re-renders the consumer on a fixed interval. ListsPage calls `useNow(60_000)` once at the top, threads it into `formatRelativeDate(iso, now)`, and the cards re-tick once a minute. One interval per page (not per card), one re-render per tick, no per-card subscription cost.

**Files:**
- Create: `src/lib/use-now.ts`
- Modify: `src/lists/ListsPage.tsx`

**What to do:**

### Step 1 — Add the hook

```ts
// src/lib/use-now.ts

import { useEffect, useState } from 'react'

/**
 * Returns the current `Date.now()` and re-renders the consumer at the
 * given interval. Use for relative-time displays ("5 mins ago") that
 * need to retick while the user keeps the page open.
 *
 * One interval per consumer; multiple consumers don't share a clock.
 * That's intentional — different parts of the UI may want different
 * granularities (a 1s clock for a stopwatch, a 60s clock for relative
 * dates), and at our app's scale the cost of two intervals is nothing.
 *
 * The hook is page-visibility-aware via setInterval semantics: most
 * browsers throttle setInterval in background tabs, so the clock ticks
 * less often when the user isn't looking. A foreground tab stays in
 * sync within `intervalMs` of real time.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
```

### Step 2 — Plumb `now` through `formatRelativeDate`

Change the function signature from `(iso: string)` to `(iso: string, now: number)`. The body uses the passed `now` instead of calling `Date.now()` inline:

```ts
function formatRelativeDate(iso: string, now: number): string {
  const then = new Date(iso).getTime()
  const diffMs = now - then
  // ...rest unchanged...
}
```

### Step 3 — Call site

In ListsPage, near the top of the component:

```tsx
const now = useNow(60_000)
```

Then change the existing `formatRelativeDate(list.updated_at)` call to `formatRelativeDate(list.updated_at, now)`.

**KNOWN RISK:** the page re-renders every minute. ListsPage already memoizes its expensive subtrees (or doesn't have any — verify before declaring this commit done). If a memoized child accepts `now` as a prop, it'll re-render every tick — but only the cards that display relative dates need it, and they're cheap to re-render. If profiling shows a problem, narrow the `now` prop drilling. For Phase 7 the simple shape is correct.

**KNOWN RISK 2:** the `useNow(60_000)` interval starts at component mount. Cards that mounted 59 seconds before a user navigates away and back will tick almost immediately. That's fine — minor visual flicker on the relative text, no functional issue.

**Cards beyond 7 days old** still fall through to the absolute date branch; for those, the tick is wasted work but cheap (one `formatRelativeDate` call per card per minute is microseconds).

**Verification:**
- `npm run build` — pass; bundle flat.
- `npm run lint` — pass.
- `npm test --run` — pass.
- Manual smoke (REQUIRED): open `/lists` with at least one card showing "X mins ago". Wait 60+ seconds. Confirm the text increments. (No need to wait an hour — the minute-tick is the load-bearing case.)

**Acceptance criteria:** `useNow` hook exists, ListsPage consumes it once, `formatRelativeDate` accepts `now`, the relative text updates within 60s on a foreground tab.

**Suggested commit:** `fix(lists): retick relative dates so "X min ago" stays accurate (M9)`

---

## Commit 3 — M4: optimistic root redirect via cached last-list-id

**Origin:** REVIEW-performance.md M4 (Medium).

**Why:**

`src/layout/RootRedirect.tsx:18-23` waits for `fetchLists` to complete before redirecting from `/`. On cold first-paint that's a serial chain: session resolve → fetchLists round-trip → redirect → destination page mounts and starts ITS queries. The destination page (typically `/lists/<some-id>`) then has to fetch list_items, gear_items, categories — work that could have started in parallel with the redirect.

**Fix shape:** stash the last-visited list_id in `localStorage` whenever `/lists/:id` mounts. On `/`, read localStorage first; if a cached id is present, redirect optimistically without waiting for fetchLists. The destination's queries start immediately. If the cached id doesn't exist on the server (deleted, signed in as different user, etc.), the destination page's existing `if (!list)` branch handles the miss — `fetchListItems` returns empty, the page renders "List not found", user navigates away. That fallback already exists; the optimistic redirect just defers fetchLists's gating role to the destination page.

For users with NO cached id (first login, cleared storage), the existing fetchLists-wait path is preserved as the fallback.

**Files:**
- Create: `src/lib/last-list-id.ts` (small helper module — read, write, clear, validation)
- Modify: `src/layout/RootRedirect.tsx`
- Modify: `src/lists/ListDetailPage.tsx` (write the cache after the list resolves truthy; clear it on not-found when the cached id matches the failing route)

**What to do:**

### Step 1 — Helper module

```ts
// src/lib/last-list-id.ts

const KEY = 'lastListId'

/**
 * Read the last-visited list_id from localStorage. Returns null on first
 * visit, after a clear, or if the stored value isn't a plausible UUID.
 *
 * Validation is intentionally loose — any 36-char string of hex+dashes
 * passes. The destination page's existing not-found branch handles
 * server-side misses (deleted list, different user). We don't try to
 * verify the id belongs to the current user here — that's the server's
 * job via RLS.
 */
export function readLastListId(): string | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    // Plausible UUID v4: 8-4-4-4-12 hex chars with dashes. Anything else
    // is corrupt or a different format — treat as miss.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
      return null
    }
    return raw
  } catch {
    // localStorage can throw in private mode or on quota errors. Treat as miss.
    return null
  }
}

export function writeLastListId(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // Best-effort write; ignore quota/private-mode failures. The next
    // visit just falls through to the fetchLists path.
  }
}

export function clearLastListId(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
```

### Step 2 — Write on `/lists/:id` mount, but only AFTER the list resolves truthy

Naive write-on-mount is wrong: it makes a stale cache sticky. Suppose user B's session has a stale `lastListId` pointing at user A's list. Root redirects user B to that id, ListDetailPage mounts for that route, and a write-on-mount handler dumps the same bad id back into localStorage. RLS denies the read, the not-found branch renders, but `/` keeps redirecting to the bad id forever.

The cache write must be gated on the list query actually resolving truthy. In `ListDetailPage.tsx`, near the existing `useEffect` calls (and after the existing `useQuery` for the list), add:

```tsx
useEffect(() => {
  if (list?.id) writeLastListId(list.id)
}, [list?.id])
```

This fires only when `list` resolves to a real, RLS-permitted row. The reactive dep `list?.id` is `undefined` while the query is in-flight or rejected, so no write happens on those paths.

**Also clear the cache when the list-not-found branch is reached.** This handles the case where the cache was already poisoned (e.g. by a pre-fix version of the code, or by a list deleted server-side after caching). Without this, root → not-found → root → not-found → ... cycles forever from the user's perspective until they manually navigate away.

Find the existing not-found branch around `src/lists/ListDetailPage.tsx:651`:

```tsx
if (!list) {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-gray-400">
      List not found.
    </div>
  )
}
```

Add a guarded effect just before it (NOT inside it — render-phase side effects are forbidden):

```tsx
// Clear the cached last-list-id if this route is the cached one and the
// list isn't resolvable. Without this, RootRedirect keeps sending the
// user back here in a loop. Gated on `listId === readLastListId()` so
// we don't clobber an unrelated cached id when the user navigates
// directly to a different (also missing) list.
useEffect(() => {
  if (!list && listId && readLastListId() === listId) {
    clearLastListId()
  }
}, [list, listId])
```

(Place this alongside the write effect; both run after the list query resolves.)

Add the import at the top: `import { writeLastListId, readLastListId, clearLastListId } from '../lib/last-list-id'`.

**Why not just always clear on `!list`?** A user could deep-link to `/lists/<some-other-id>` while still having a valid cached id for a different list. We don't want that direct visit to wipe the cache and force the slow path on next root visit. The `readLastListId() === listId` guard scopes the clear to the actual stale-cache failure mode.

### Step 3 — Read on `/` redirect

Rewrite `RootRedirect.tsx`:

```tsx
import { Navigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { queryKeys, fetchLists } from '../lib/queries'
import { readLastListId } from '../lib/last-list-id'

// Authenticated landing for `/`. Picks the most-recently-touched list
// and redirects there.
//
// Fast path (M4): if localStorage has a cached last-visited list_id,
// redirect to it immediately without waiting for fetchLists. The
// destination page's queries start in parallel with what would have
// been the fetchLists round-trip on the cold path. Server-side misses
// (deleted list, different user) hit the destination's existing not-
// found branch and the user navigates away.
//
// Slow path: no cached id (first login, cleared storage). Fall back to
// fetchLists + sort-by-updated_at, identical to the prior behavior.
//
// Empty path: zero lists. Fall through to /lists which renders
// ListsEmptyState.
export default function RootRedirect() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const cachedId = readLastListId()
  if (cachedId) return <Navigate to={`/lists/${cachedId}`} replace />

  const { data: lists, isLoading } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: () => fetchLists(userId),
  })
  if (isLoading || !lists) return null

  const [mostRecent] = [...lists].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  if (!mostRecent) return <Navigate to="/lists" replace />
  return <Navigate to={`/lists/${mostRecent.id}`} replace />
}
```

**KNOWN RISK — Hooks order:** the early return for `cachedId` happens BEFORE `useQuery`. React's rules-of-hooks require hooks to be called unconditionally in the same order every render. With the early `return`, `useQuery` is sometimes called and sometimes not. **This will fail under React strict mode and the linter will flag it.**

The fix is to call `useQuery` unconditionally with `enabled: !cachedId` so the hook is always invoked but the request only fires when needed:

```tsx
const cachedId = readLastListId()

const { data: lists, isLoading } = useQuery({
  queryKey: queryKeys.lists(),
  queryFn: () => fetchLists(userId),
  enabled: !cachedId,
})

if (cachedId) return <Navigate to={`/lists/${cachedId}`} replace />
if (isLoading || !lists) return null
// ...rest unchanged
```

This is the load-bearing detail. **Use the `enabled` shape, not the early-return shape.**

**KNOWN RISK 2 — Cached id is wrong user.** If user A signs out and user B signs in, `lastListId` is still A's. User B's optimistic redirect goes to `/lists/<A's-list>`, the page hits the not-found branch (RLS denies the read), user navigates back. That's a one-render flicker on the user-switch case. To avoid it, clear `lastListId` on signout — add `clearLastListId()` in the signout handler.

Find the signout handler (likely in `AuthProvider` or `HamburgerMenu`) and call `clearLastListId()` there. If it's hard to locate, leave the flicker — it's a rare edge case and the existing not-found branch is the safety net.

### Step 4 — Verification

- `npm run build` — pass; bundle stays within ±0.5 KB (the helper adds ~200 bytes).
- `npm run lint` — pass; no react-hooks/rules-of-hooks violations.
- `npm test --run` — pass.
- Manual smoke (REQUIRED — this is the user-visible perf claim):
  1. Sign in. Navigate to `/lists/<some-id>`. Wait for full load. Confirm `localStorage.lastListId === <that-id>` (DevTools → Application).
  2. Reload `/`. Expect: immediate redirect to `/lists/<that-id>`. No "Loading..." flash.
  3. Clear localStorage. Reload `/`. Expect: brief "Loading..." then redirect to most-recently-updated list (slow path preserved).
  4. **Stale-cache regression check:** in DevTools, manually set `localStorage.lastListId = '00000000-0000-0000-0000-000000000000'` (a UUID-shape but non-existent id). Reload `/`. Expect: redirect to `/lists/00000000-...`, "List not found" renders, AND `localStorage.lastListId` is now removed. Reload `/` again — expect slow path (lists fetch + redirect to most-recent). If the cache wasn't cleared, the page would loop forever.
  5. Sign out. Sign back in. Navigate to `/`. If signout clears the cache, expect slow path; if it doesn't, expect a one-render flicker through the not-found branch (which will then clear the stale cache per step 4's mechanism) before subsequent visits hit the slow path.

**Acceptance criteria:** root redirect is immediate when cache is warm; slow path preserved when cold; signout cache-clear wired (or flicker accepted with comment).

**Suggested commit:** `perf(redirect): optimistic root redirect via cached last-list-id (M4)`

---

## Commit 4 — Audit-only entries (L3-L4 + M13)

No code changes. Documented in Commit 5's REVIEW-FIX.md entry as the rationale for closing them. Capturing here for the audit ledger:

**L3-L4 — Drag handlers / collision-detection memo:** the audit explicitly classifies these as "Cold path; runs once per drop; bounded." `GearLibraryPage.tsx` already has the `collisionDetection` wrapped in `useMemo`. The drag handlers (`handleDragStart`, `handleDragEnd`) are not props passed to memoized children — they're consumed once by `<DndContext>`. Memoizing them buys nothing. **Closed: no action required.**

**M13 — `lucide-react` tree-shaking:** bundle size is **consistent with tree-shaking working**. 36 distinct icons across 26 import sites; the entire main `index-*.js` chunk is 187.02 KB gzip and the app has multiple async chunks (Phase 3/4 introduced `MarkdownPage`, `ListSelectorDrawer`, `ListSidebarDrawer`, etc.) so the main number alone isn't a complete proof. A direct verification — `rg "createLucideIcon|lucide-react" dist/assets/*.js` against a built bundle, or running `vite-bundle-visualizer` — would be the rigorous check; deferring that to a future audit unless symptoms appear. **Closed for now: probable pass on bundle-size grounds, full verification deferred.**

**Suggested commit:** none. Roll the rationale into Commit 5.

---

## Commit 5 — Append Phase 7 summary to REVIEW-FIX.md

**File:** `.planning/REVIEW-FIX.md`

Append below the Phase 6 section. Structure:

```markdown
# grampacker — Phase 7 fix summary (2026-05-05)

## Shipped

- **Commit 1 (L9 — actual) — `<hash>`** — `formatPurchaseDate` in `src/gear/GearItemRow.tsx` now uses a hoisted `DATE_FORMATTER` constant alongside the existing `COST_FORMATTER`. Phase 5 mistakenly thought L9 referred to `formatItemWeight`; the actual L9 was always about purchase-date formatting in GearItemRow. Output identical character-for-character.
- **Commit 2 (M9) — `<hash>`** — relative dates on `/lists` cards now retick once a minute via a new `useNow(intervalMs)` hook (`src/lib/use-now.ts`). Pre-fix, "1 min ago" stayed "1 min ago" forever once the card mounted.
- **Commit 3 (M4) — `<hash>`** — `RootRedirect` now redirects to the cached last-visited list_id immediately when warm, without waiting for `fetchLists`. Cold path (no cached id) preserves prior behavior. Cache written **only after the list query resolves truthy** so a stale cache doesn't get re-written on a not-found visit. Cache cleared from the not-found branch when the cached id matches the failing route, so a poisoned cache self-heals on the next visit. Optionally also cleared on signout (note which).
- **L3-L4 — DROPPED.** Audit classified these as "Cold path; runs once per drop; bounded." `collisionDetection` is already memoized at `src/gear/GearLibraryPage.tsx:398`; drag handlers aren't props to memoized children, so memoizing them buys nothing. Closed: no action.
- **M13 — PROBABLE PASS, full verification deferred.** Bundle size is consistent with lucide-react tree-shaking working (36 distinct icons across 26 import sites; main chunk 187.02 KB gzip, multiple async chunks), but with the multi-chunk topology a single number isn't a complete proof. A direct bundle search or visualizer run is the rigorous check; deferred unless symptoms appear.

## Verification results

- `npm run build`: pass; bundle gzip stayed within ±0.5 KB of 187.02 across all three commits.
- `npm run lint`: pass.
- `npm test --run`: 31/31 pass.
- Manual smoke: pending user verification.

## Blockers / surprises

- (fill in or "none")

## Next phase

Phase 8 candidates:
- **RPC consolidation (M2, M3)** — `addNewItemMut` two-round-trip collapse and `duplicateList` / `createListFromSelection` 2-3 round-trip collapse. Higher-value backend perf, requires a migration with new RPCs.
- **Quality refactors** — W-1 (`useAnchoredMenu` extraction), W-7 (CategoryGroup name-shadow rename), W-2…W-13 (type/clarity nits).
- **Security hardening** — F4 (anon enumeration), F5 (ESLint rule), F8 (SW cache auth-keying decision).
- **Test-coverage cluster** — T-3…T-9; needs jsdom + @testing-library install.

Recommend Phase 8 as the RPC consolidation pass — it's the last remaining backend-perf cluster and closes the high/medium audit items in `Network / TanStack Query`.
```

**Suggested commit:** `docs(review-fix): append Phase 7 summary`

---

## Out of scope for Phase 7

Explicitly NOT in this phase:

- **M2 / M3 (RPC consolidation)** — separate phase. Requires a migration with new SECURITY DEFINER functions plus client refactor.
- **W-1 / W-7 / W-2..W-13** — quality refactors, not perf.
- **F4 / F5 / F8** — security hardening, separate phase.
- **T-3..T-9** — test-coverage cluster; needs jsdom install first.
- **`useNow` adoption beyond ListsPage** — if other relative-time displays surface (export timestamps, etc.), they can adopt the hook later. Not scope-creeping the M9 fix.

If a commit reveals scope expansion (e.g. M4's signout-clear requires touching AuthProvider in a non-trivial way), **stop and surface as a blocker** rather than rewriting the spec inline.
