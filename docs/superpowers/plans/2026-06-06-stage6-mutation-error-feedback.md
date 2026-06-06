# Stage 6 — Non-optimistic Mutation/Action Failure Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every non-optimistic user action that can fail now surfaces explicit failure feedback (an error toast), and no async handler can leak an unhandled promise rejection. Optimistic mutations are untouched (their silent rollback IS the documented signal).

**Architecture:** Two feedback channels, picked by what the call site already is:
1. **`useMutation` sites** opt into a toast declaratively via `meta: { errorToast: "..." }`. The already-extracted global `mutationErrorHandler` (wired into the app's single `MutationCache`) reads that meta and shows the toast. This keeps the two god-file mutation sites a **one-line, logic-free** change (no `onError` closure, no render harness needed) and puts the tested behavior in a small isolated module.
2. **Non-mutation async actions** (`exportCsv`, `resetPacked`, `resetReady`) wrap their body in `try/catch`, `showToast` on failure, and **consume** the error (no rethrow), so their fire-and-forget call sites can never reject.

**Why this split:** It satisfies three hard constraints simultaneously — TDD (the handler + the hook are unit-testable), surgical (additive lines only), and **no god-file refactor** (no extraction from `ListDetailPage.tsx` / `GearLibraryPage.tsx`).

**Tech Stack:** React 19, TanStack Query v5 (`MutationCache`, `meta`, `Register` augmentation), `src/lib/toast.ts` (`showToast`), Vitest + `@testing-library/react` (`renderHook`), jsdom.

**Scope (six finding IDs):** C-01 (resets), C-02 (createListFromSelection), C-03 (addNewItem/Quick Add), C-04 (duplicate), C-21 (exportCsv). Plus the convention docs. **Out of scope:** any god-file restructure, the within-category DnD work (C-13), and the orphan-import RPC (C-05 / Stage 10).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/mutation-error-handler.ts` | Global mutation error handler | Add `Register` meta augmentation + `meta.errorToast` → `showToast` |
| `src/lib/mutation-error-handler.test.ts` | Handler unit test | **New** — covers meta→toast behavior |
| `src/gear/GearLibraryPage.tsx` | Gear page (god-file) | One `meta:` line on `createListFromSelectionMut` |
| `src/lists/ListDetailPage.tsx` | List workspace (god-file) | One `meta:` line on `addNewItemMut`; `resetPacked`/`resetReady` catch → toast+consume |
| `src/lists/use-current-list-actions.ts` | Shared list actions hook | `meta:` on `duplicateMut`; `exportCsv` try/catch+toast+consume; import `showToast` |
| `src/lists/use-current-list-actions.test.ts` | Hook unit test | **New** — duplicate (meta path) + exportCsv (direct) |
| `CLAUDE.md` | Project instructions | New convention subsection (3 bullets) |
| `SPEC.md` | Behavior reference | Update "Toast notifications → Current usage" |

---

## Task 1: `meta.errorToast` support in the global mutation error handler

**Files:**
- Modify: `src/lib/mutation-error-handler.ts`
- Create: `src/lib/mutation-error-handler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/mutation-error-handler.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mutation } from '@tanstack/react-query'
import { mutationErrorHandler } from './mutation-error-handler'
import { showToast } from './toast'

vi.mock('./toast', () => ({ showToast: vi.fn() }))

// Minimal mutation-shaped stub. The handler only reads
// options.mutationKey and options.meta.
function fakeMutation(meta?: { errorToast?: string }, mutationKey?: string[]) {
  return { options: { mutationKey, meta } } as unknown as Mutation<unknown, unknown, unknown>
}

describe('mutationErrorHandler', () => {
  beforeEach(() => {
    vi.mocked(showToast).mockClear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('shows an error toast when meta.errorToast is set', () => {
    mutationErrorHandler(new Error('boom'), undefined, undefined, fakeMutation({ errorToast: 'Could not do it.' }, ['dup']))
    expect(showToast).toHaveBeenCalledWith('Could not do it.', { type: 'error' })
  })

  it('does NOT toast when meta has no errorToast', () => {
    mutationErrorHandler(new Error('boom'), undefined, undefined, fakeMutation(undefined, ['reorder']))
    expect(showToast).not.toHaveBeenCalled()
  })

  it('ignores a non-string errorToast', () => {
    // @ts-expect-error deliberately wrong runtime shape
    mutationErrorHandler(new Error('boom'), undefined, undefined, fakeMutation({ errorToast: 123 }))
    expect(showToast).not.toHaveBeenCalled()
  })

  it('still logs to console.warn regardless of meta', () => {
    mutationErrorHandler(new Error('boom'), undefined, undefined, fakeMutation({ errorToast: 'x' }))
    expect(console.warn).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/mutation-error-handler.test.ts`
Expected: FAIL — `showToast` not called (handler doesn't read meta yet).

- [ ] **Step 3: Implement meta support**

In `src/lib/mutation-error-handler.ts`:

1. Add the import at the top:
```ts
import { showToast } from './toast'
```
2. Add the typed meta augmentation (below the existing `import type { Mutation }` line):
```ts
// Opt-in per-mutation failure feedback. A mutation that is NOT optimistic
// (no visible snap-back to act as the error signal) sets
// `meta: { errorToast: "..." }`; this handler turns that into a toast.
// Optimistic mutations leave it unset and keep relying on their rollback.
declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { errorToast?: string }
  }
}
```
3. At the END of the `mutationErrorHandler` body (after the existing `console.warn(...)`):
```ts
  const errorToast = mutation.options.meta?.errorToast
  if (typeof errorToast === 'string') {
    showToast(errorToast, { type: 'error' })
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/mutation-error-handler.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Verify the build (meta augmentation typechecks app-wide)**

Run: `npm run build`
Expected: clean. (The `Register` augmentation makes `meta.errorToast` typed on every `useMutation`; confirm nothing else set an incompatible `meta`.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/mutation-error-handler.ts src/lib/mutation-error-handler.test.ts
git commit -m "feat(mutations): honor meta.errorToast in the global error handler"
```

---

## Task 2: Wire the three non-optimistic `useMutation` sites to `errorToast`

**Files:**
- Modify: `src/lists/ListDetailPage.tsx` (`addNewItemMut`, C-03)
- Modify: `src/gear/GearLibraryPage.tsx` (`createListFromSelectionMut`, C-02)
- Modify: `src/lists/use-current-list-actions.ts` (`duplicateMut`, C-04)
- Create: `src/lists/use-current-list-actions.test.ts` (duplicate end-to-end test)

- [ ] **Step 1: Write the failing test (duplicate → toast via the real handler)**

Create `src/lists/use-current-list-actions.test.ts`. This wires the REAL `mutationErrorHandler` into the QueryClient so the test exercises the full meta→toast path:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { createElement, type ReactNode } from 'react'
import { mutationErrorHandler } from '../lib/mutation-error-handler'
import { useCurrentListActions } from './use-current-list-actions'
import { showToast } from '../lib/toast'
import { duplicateList } from '../lib/queries'
import type { List } from '../lib/types'

vi.mock('../lib/toast', () => ({ showToast: vi.fn() }))
vi.mock('../lib/queries', async (orig) => ({
  ...(await orig<typeof import('../lib/queries')>()),
  duplicateList: vi.fn(),
}))

const LIST: List = {
  id: 'l1', user_id: 'u1', name: 'Trip', description: null, slug: 'abc123',
  is_shared: false, is_draft: false, group_worn: false, ready_checks_enabled: false,
  sort_order: 0, created_at: '', updated_at: '',
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    mutationCache: new MutationCache({ onError: mutationErrorHandler }),
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return createElement(QueryClientProvider, { client: qc }, createElement(MemoryRouter, null, children))
}

describe('useCurrentListActions — duplicate failure feedback', () => {
  beforeEach(() => { vi.mocked(showToast).mockClear() })
  afterEach(() => cleanup())

  it('toasts when duplicateList rejects', async () => {
    vi.mocked(duplicateList).mockRejectedValueOnce(new Error('nope'))
    const { result } = renderHook(() => useCurrentListActions('u1'), { wrapper })
    act(() => { result.current.duplicateMut.mutate(LIST) })
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("Couldn't duplicate that list. Please try again.", { type: 'error' }),
    )
  })
})
```

> NOTE for implementer: confirm the exact `List` field set against `src/lib/types.ts` before running (add/remove fields so the object typechecks under `noUncheckedIndexedAccess`). Adjust the `duplicateList` mock path if the barrel re-export differs.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lists/use-current-list-actions.test.ts`
Expected: FAIL — no toast (duplicateMut has no `meta` yet).

- [ ] **Step 3: Add `meta.errorToast` to all three mutations**

`src/lists/use-current-list-actions.ts` — `duplicateMut` (currently `useMutation({ mutationFn, onSuccess })`), add a `meta` property:
```ts
  const duplicateMut = useMutation({
    mutationFn: (target: List) => {
      const currentLists = qc.getQueryData<List[]>(queryKeys.lists()) ?? []
      return duplicateList(target, userId, nextListSortOrder(currentLists))
    },
    meta: { errorToast: "Couldn't duplicate that list. Please try again." },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
      navigate(`/lists/${created.id}`)
    },
  })
```

`src/gear/GearLibraryPage.tsx` — `createListFromSelectionMut`, add `meta` above `onSuccess`:
```ts
    meta: { errorToast: "Couldn't create the list. Please try again." },
```

`src/lists/ListDetailPage.tsx` — `addNewItemMut`, add `meta` above `onSuccess`:
```ts
    meta: { errorToast: "Couldn't add that item. Please try again." },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lists/use-current-list-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lists/use-current-list-actions.ts src/gear/GearLibraryPage.tsx src/lists/ListDetailPage.tsx src/lists/use-current-list-actions.test.ts
git commit -m "fix(mutations): surface failure toast on duplicate, quick-add, and create-from-selection"
```

> Coverage note: the `createListFromSelectionMut` (C-02) and `addNewItemMut` (C-03) wirings are one declarative `meta:` line each; their behavior is proven by Task 1's handler test, and the wiring is build-verified. The duplicate path is proven end-to-end by the renderHook test above. No per-site render harness for the god-files (out of scope).

---

## Task 3: `exportCsv` — try/catch + toast + consume (C-21)

**Files:**
- Modify: `src/lists/use-current-list-actions.ts`
- Modify: `src/lists/use-current-list-actions.test.ts` (add export cases)

- [ ] **Step 1: Write the failing tests**

Append to `src/lists/use-current-list-actions.test.ts`. Mock the CSV module so we can assert `downloadCsv` is NOT called on failure:

```tsx
import { downloadCsv } from '../lib/csv'
// add to the top-level mocks:
vi.mock('../lib/csv', () => ({ listItemsToCsv: vi.fn(() => 'csv'), downloadCsv: vi.fn() }))

describe('useCurrentListActions — exportCsv failure feedback', () => {
  beforeEach(() => { vi.mocked(showToast).mockClear(); vi.mocked(downloadCsv).mockClear() })
  afterEach(() => cleanup())

  it('toasts and does not download when the fetch rejects', async () => {
    // Make the underlying list-items fetch reject. Mock the queries barrel's
    // fetchListItems (used inside exportCsv via qc.fetchQuery).
    const { fetchListItems } = await import('../lib/queries')
    vi.mocked(fetchListItems).mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useCurrentListActions('u1'), { wrapper })
    await act(async () => { await result.current.exportCsv(LIST) })
    expect(showToast).toHaveBeenCalledWith("Couldn't export the list. Please try again.", { type: 'error' })
    expect(downloadCsv).not.toHaveBeenCalled()
  })
})
```

> NOTE for implementer: `exportCsv` calls `qc.fetchQuery({ queryKey, queryFn: () => fetchListItems(...) })` and `fetchCategories(...)`. Mock whichever of `fetchListItems`/`fetchCategories` is reached first to reject. Add them to the `../lib/queries` mock factory (`fetchListItems: vi.fn()`, `fetchCategories: vi.fn()`). Verify the exact exported names against `src/lib/queries/index.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lists/use-current-list-actions.test.ts`
Expected: FAIL — the rejection currently propagates (no catch); `showToast` not called.

- [ ] **Step 3: Wrap `exportCsv` in try/catch**

In `src/lists/use-current-list-actions.ts`, add `import { showToast } from '../lib/toast'` (top), and change `exportCsv` to:

```ts
  const exportCsv = useCallback(
    async (list: List) => {
      try {
        const [items, categories] = await Promise.all([
          qc.fetchQuery({
            queryKey: queryKeys.listItems(list.id),
            queryFn: () => fetchListItems(list.id, userId),
          }),
          qc.fetchQuery({
            queryKey: queryKeys.categories(),
            queryFn: () => fetchCategories(userId),
          }) as Promise<Category[]>,
        ])
        const csv = listItemsToCsv(items, categories)
        downloadCsv(
          `${list.name.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'list'}.csv`,
          csv,
        )
      } catch {
        // Non-optimistic action with no snap-back: surface feedback and
        // consume so the fire-and-forget call sites (ListsPage,
        // DesktopListsPanel, ListSettingsPanel) cannot reject.
        showToast("Couldn't export the list. Please try again.", { type: 'error' })
      }
    },
    [qc, userId],
  )
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lists/use-current-list-actions.test.ts`
Expected: PASS (all duplicate + export cases).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lists/use-current-list-actions.ts src/lists/use-current-list-actions.test.ts
git commit -m "fix(lists): surface export-CSV failures and stop the fire-and-forget rejection"
```

---

## Task 4: `resetPacked` / `resetReady` — toast + consume (C-01)

**Files:**
- Modify: `src/lists/ListDetailPage.tsx`

This is the one site that lives inside a god-file as a non-exported async function with no render harness. The change is the minimal correction you specified: keep the existing field-scoped rollback, replace the `throw err` with a toast, and consume the error. NO extraction (that would be a god-file refactor, explicitly out of scope). A component-level test is deferred to the god-file test backfill (see AUDIT-REPORT.md M-test-6 era); this task is verified by `npm run build` + the full suite staying green + the invariant below.

- [ ] **Step 1: Edit `resetPacked`'s catch block**

In `resetPacked`, the `catch (err) { ... throw err }` becomes (keep the `qc.setQueryData` rollback exactly as-is; replace only the `throw err`):

```ts
    } catch {
      // Restore only is_packed=true on the ids we cleared. Any concurrent
      // resetReady write on those same rows survives because we never
      // touch is_ready here.
      qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
        curr ? curr.map((i) => (wasPackedIds.has(i.id) ? { ...i, is_packed: true } : i)) : curr,
      )
      // Non-optimistic action: surface the failure and CONSUME it. Rethrowing
      // here would be an unhandled rejection — onReset() is called
      // fire-and-forget from PackingProgress (() => void contract).
      showToast("Couldn't reset packed items. Please try again.", { type: 'error' })
    } finally {
      qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    }
```

- [ ] **Step 2: Edit `resetReady`'s catch block (mirror)**

Same change in `resetReady`: keep the `wasReadyIds` rollback `setQueryData`, replace `throw err` with:
```ts
      showToast("Couldn't reset ready checks. Please try again.", { type: 'error' })
```
(`showToast` is already imported in `ListDetailPage.tsx` — verify line ~61.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean. (`err` is no longer referenced — using bare `catch {}` avoids an unused-var lint error; confirm `npm run lint` is clean too.)

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: all green (no behavioral test for resets; confirm nothing regressed).

- [ ] **Step 5: Commit**

```bash
git add src/lists/ListDetailPage.tsx
git commit -m "fix(lists): toast and consume on reset-packed/ready failure instead of throwing"
```

---

## Task 5: Convention docs (CLAUDE.md + SPEC.md)

**Files:**
- Modify: `CLAUDE.md`
- Modify: `SPEC.md`

- [ ] **Step 1: Add the convention to `CLAUDE.md`**

Add a new subsection (place it immediately after the "## Cache invalidation rules" section, before "## Row/table visual system"):

```markdown
## Mutation & async-action failure feedback

- **Optimistic mutation with a visible rollback:** the snap-back IS the failure
  signal; do NOT add a toast (this is the existing documented policy, e.g.
  `makeOptimisticUpdate`/fan-out rollbacks). The only exception already in place
  is `makeOptimisticReorder`, whose rollback is otherwise invisible.
- **Non-optimistic `useMutation`:** opt into explicit feedback by setting
  `meta: { errorToast: "Couldn't ... Please try again." }`. The global
  `mutationErrorHandler` (`src/lib/mutation-error-handler.ts`) turns that into an
  error toast. Do not hand-roll an `onError` toast when the meta covers it.
- **Non-optimistic async action that is NOT a mutation** (a `useCallback` like
  `exportCsv`, or a raw async like `resetPacked`/`resetReady`): wrap the body in
  `try/catch`, `showToast(..., { type: 'error' })` on failure, and CONSUME the
  error (no rethrow). A toast-then-rethrow still leaves an unhandled rejection.
- **Fire-and-forget rejected promises are prohibited.** If an async handler is
  invoked without `await`/`.catch` (e.g. `onClick={() => doThing()}`), it must
  catch internally and surface feedback, or its contract must become
  `() => Promise<void>` and be awaited+caught at the call site.
```

- [ ] **Step 2: Update `SPEC.md` "Toast notifications → Current usage"**

Find the "**Current usage.**" bullet under "## Toast notifications" and replace it with:

```markdown
- **Current usage.** Reorder failures across all four reorderable surfaces
  (`makeOptimisticReorder.onError`). Plus the non-optimistic actions that have no
  snap-back to signal failure: gear delete / move-to-category, Quick Add, list
  duplicate, create-list-from-selection (via `meta.errorToast` routed through the
  global `mutationErrorHandler`), and `exportCsv` / reset-packed / reset-ready
  (direct `try/catch` + toast). Optimistic mutations still rely on silent
  rollback; the global `MutationCache.onError` in `App.tsx` (the
  `mutationErrorHandler`) documents the policy and now also emits the
  `meta.errorToast` toast when a mutation opts in.
```

> NOTE for implementer: read the current "Current usage." sentence first and preserve any wording about inline call-site errors; the above is the target meaning, adjust to merge cleanly.

- [ ] **Step 3: Build (docs don't affect build, but run to confirm nothing else drifted)**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md SPEC.md
git commit -m "docs: codify non-optimistic mutation/action failure-feedback convention"
```

---

## Final verification (after all tasks)

- [ ] `npx vitest run` — full suite green (expect the prior 379 passed + the new handler/hook tests; 4 integration tests still skipped).
- [ ] `npm run build` — clean (`tsc -b && vite build`).
- [ ] `npm run lint` — clean (watch for unused `err` in the reset catches).
- [ ] Grep sanity: `grep -rn "errorToast" src/` shows exactly the handler + the three mutation sites.
- [ ] Manual (per CLAUDE.md hard-refresh discipline, on the Cloudflare preview): force a failure (offline) on duplicate, Quick Add, create-from-selection, export, and reset — each shows an error toast and no console unhandled-rejection.

## Self-review notes (author)

- **Spec coverage:** C-01 (Task 4), C-02 + C-03 + C-04 (Tasks 1–2), C-21 (Task 3), convention (Task 5) — all five findings + the convention are covered.
- **Type consistency:** `meta.errorToast` is typed via the `Register` augmentation in Task 1 and consumed identically in Tasks 2. `showToast(message, { type: 'error' })` signature matches `src/lib/toast.ts`.
- **Known testability limit:** Task 4 (resets) has no unit test because the functions are god-file-inline and a render harness is out of scope; this is intentional and flagged. Everything else is unit-tested.
