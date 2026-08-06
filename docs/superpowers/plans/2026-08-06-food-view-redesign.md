# Food View Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the food estimate out of the inline gear list into its own list view at `/lists/:id/food`, then redesign it per `docs/food-view-design.md` — UI only, zero server changes.

**Architecture:** Food becomes a third `ListDetailMode` (`'food'`) peer to List and Pack, rendered by `ListDetailPage` through a new self-contained `FoodView` component that owns the food query + mutations. PR 1 moves the existing `FoodSection` behind the new route with a summary row left behind; PR 2 replaces `FoodSection` with new components (day sections, add-food card, carrying card).

**Tech Stack:** React 19 + TypeScript (strict, `noUncheckedIndexedAccess`), React Router, TanStack Query v5, Tailwind, Vitest + Testing Library. No new dependencies.

## Global Constraints

- Branch: `food-view-redesign` (already exists, holds the design doc commit).
- Zero server changes, zero migrations, no new API calls. `docs/authz-matrix.md` untouched.
- Gates per AGENTS.md: `npm run build` AND `npm run test:unit` before claiming done. `npm run test:api` unaffected (no `server/**` change) — do not run it for these PRs unless CI does.
- `noUncheckedIndexedAccess` is on: indexed access returns `T | undefined`. Use `.find()`, destructuring with defaults, or length guards — never bare `!` without a comment.
- v5 query gates: read paths gate `isLoadingError` then `isPending` (never `isError`/`isLoading`); mutation payloads computed from cache require the collection RESOLVED, gate on the ACTION.
- No fire-and-forget promises. Mutations use the existing `meta.errorToast` / explicit `onError` patterns — copy them verbatim when moving code.
- US spelling, ASCII in code/comments/commit messages. No formatter — match surrounding style by hand.
- Stage exact files (`git add <paths>`), never `-A` or `.`. One logical change per commit.
- Error copy states what is proven ("Couldn't confirm…" not "Couldn't delete…") — keep every existing message string byte-identical when moving code.
- Weight display goes through `ItemWeightValue` (component) / `formatItemWeight` (text); entry goes through `WeightInput`. Never hand-format grams.

---

## PR 1 — Move food to `/lists/:id/food`

### Task 1: Add `'food'` to `ListDetailMode`

**Files:**
- Modify: `src/lists/list-detail-mode.ts`
- Test: `src/lists/list-detail-mode.test.ts`

**Interfaces:**
- Produces: `ListDetailMode = 'edit' | 'pack' | 'food'`; `deriveListMode(pathname, search, listId)` returns `'food'` for `/lists/:id/food`; `persistedListPath(listId, 'food')` returns `` `/lists/${listId}/food` ``; `listDocumentTitle(name, 'food')` returns `` `${name} - Food` ``.

- [ ] **Step 1: Write the failing tests** — add to the existing `it.each` tables in `src/lists/list-detail-mode.test.ts`:

```ts
// in the deriveListMode it.each table:
    [`/lists/${LIST_ID}/food`, '', 'food'],
    // A food URL with a legacy pack query param is a food URL; path wins.
    [`/lists/${LIST_ID}/food`, '?mode=pack', 'food'],

// in the persistedListPath describe (add cases to its existing tests or table):
  it('persists the food view path', () => {
    expect(persistedListPath(LIST_ID, 'food')).toBe(`/lists/${LIST_ID}/food`)
  })

// in the listDocumentTitle describe:
  it('titles the food view', () => {
    expect(listDocumentTitle('JMT', 'food')).toBe('JMT - Food')
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lists/list-detail-mode.test.ts`
Expected: FAIL — `'food'` not assignable / derive returns `'edit'`.

- [ ] **Step 3: Implement** in `src/lists/list-detail-mode.ts`:

```ts
export type ListDetailMode = 'edit' | 'pack' | 'food'

const LIST_VIEW_LABELS: Record<ListDetailMode, string> = {
  edit: 'List',
  pack: 'Pack',
  food: 'Food',
}
```

In `deriveListMode`, after the legacy-organize check:

```ts
  if (pathname === `${base}/food`) return 'food'
```

In `persistedListPath`:

```ts
export function persistedListPath(listId: string, mode: ListDetailMode): string {
  const base = `/lists/${listId}`
  if (mode === 'pack') return `${base}/pack`
  if (mode === 'food') return `${base}/food`
  return base
}
```

Update the file-top comment ("Two views of a list, not three") — it is now three views; say Food joined as a peer view 2026-08 and why (food planning got its own surface; see docs/food-view-design.md).

- [ ] **Step 4: Run tests, then typecheck to find every site the widened union breaks**

Run: `npx vitest run src/lists/list-detail-mode.test.ts` → PASS.
Run: `npm run typecheck`
Expected: errors only where `Record<ListDetailMode, …>` or exhaustive switches exist. Fix each by adding the `food` arm — do NOT weaken any type. Known sites: `LIST_VIEW_LABELS` (done above). If others appear (e.g. in `ListDocumentToolbar`, `MobileListActionBar`), add the food case choosing pack-like behavior for chrome (no list-admin Options in food view).

- [ ] **Step 5: Commit**

```bash
git add src/lists/list-detail-mode.ts src/lists/list-detail-mode.test.ts
git commit -m "feat: add 'food' as a third list detail mode"
```

### Task 2: Stored last-list path accepts `/food`

**Files:**
- Modify: `src/lib/last-list-path.ts:31`
- Test: `src/lib/last-list-path.test.ts`

**Interfaces:**
- Produces: `LIST_PATH_RE` accepts `/lists/<uuid>/food`; `getListIdFromListPath('/lists/<uuid>/food')` returns the uuid.

Without this, leaving the app from the Food view stores a path the reader rejects, and the next visit forgets the list. The regex's own comment says to broaden it explicitly.

- [ ] **Step 1: Write the failing test** — add to `src/lib/last-list-path.test.ts`, following its existing fixture style (use the same uuid constant the file already uses; read the file first and mirror its save/read helpers):

```ts
  it('round-trips a food view path', () => {
    writeLastListPath(`/lists/${UUID}/food`, OWNER)
    expect(readLastListPath(OWNER)).toBe(`/lists/${UUID}/food`)
  })

  it('extracts the list id from a food path', () => {
    expect(getListIdFromListPath(`/lists/${UUID}/food`)).toBe(UUID)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/last-list-path.test.ts`
Expected: FAIL — read returns null (regex rejects `/food`).

- [ ] **Step 3: Implement** — in `src/lib/last-list-path.ts` change the regex suffix group:

```ts
const LIST_PATH_RE =
  /^\/lists\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/(?:pack|food))?$/i
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/last-list-path.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/last-list-path.ts src/lib/last-list-path.test.ts
git commit -m "feat: stored list path accepts the food view"
```

### Task 3: Route and nav entry

**Files:**
- Modify: `src/AuthenticatedApp.tsx` (after the `lists/:id/pack` route, line ~49)
- Modify: `src/lists/ListViewNav.tsx:5-8`
- Test: `src/lists/ListViewNav.test.tsx`

**Interfaces:**
- Produces: route `lists/:id/food` → `ListDetailPage`; `ListViewNav` renders **List | Food | Pack** with `aria-current="page"` on the active mode.

- [ ] **Step 1: Write the failing test** — extend `src/lists/ListViewNav.test.tsx` (mirror its existing render helper):

```tsx
  it('renders List, Food, Pack in order', () => {
    render(<MemoryRouter><ListViewNav listId="abc" mode="edit" /></MemoryRouter>)
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['List', 'Food', 'Pack'])
    expect(links[1]).toHaveAttribute('href', '/lists/abc/food')
  })

  it('marks Food current in food mode', () => {
    render(<MemoryRouter><ListViewNav listId="abc" mode="food" /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Food' })).toHaveAttribute('aria-current', 'page')
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lists/ListViewNav.test.tsx`
Expected: FAIL — only two links.

- [ ] **Step 3: Implement**

`src/lists/ListViewNav.tsx`:

```ts
const VIEWS: { mode: ListDetailMode; label: string }[] = [
  { mode: 'edit', label: 'List' },
  { mode: 'food', label: 'Food' },
  { mode: 'pack', label: 'Pack' },
]
```

`src/AuthenticatedApp.tsx`, after the pack route:

```tsx
        <Route path="lists/:id/food" element={<ListDetailPage />} />
```

The top-level `food/*` → `/lists` redirect at line 39 is the deleted planner's home and does not collide with `lists/:id/food`; leave it alone.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lists/ListViewNav.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/AuthenticatedApp.tsx src/lists/ListViewNav.tsx src/lists/ListViewNav.test.tsx
git commit -m "feat: food view route and nav entry"
```

### Task 4: `FoodSummaryRow`

**Files:**
- Create: `src/lists/FoodSummaryRow.tsx`
- Test: `src/lists/FoodSummaryRow.test.tsx`

**Interfaces:**
- Consumes: `foodGramsFor` from `src/lib/weight-breakdown.ts`, `ItemWeightValue`, `ListFoodResponse` from `shared/food.ts`.
- Produces: `FoodSummaryRow({ listId, food, weightUnit }: { listId: string; food: ListFoodResponse; weightUnit: WeightUnit })` — the one-line derived row on the LIST view (only — see Task 5) linking to the Food view.

- [ ] **Step 1: Write the failing test**:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import FoodSummaryRow from './FoodSummaryRow'
import type { ListFoodResponse } from '../../shared/food'

const EMPTY: ListFoodResponse = { dayCount: 0, slots: [], items: [] }

function makeFood(over: Partial<ListFoodResponse>): ListFoodResponse {
  return { ...EMPTY, ...over }
}

function renderRow(food: ListFoodResponse) {
  return render(
    <MemoryRouter>
      <FoodSummaryRow listId="list-1" food={food} weightUnit="g" />
    </MemoryRouter>,
  )
}

describe('FoodSummaryRow', () => {
  it('links to the food view', () => {
    renderRow(EMPTY)
    expect(screen.getByRole('link', { name: /food/i })).toHaveAttribute(
      'href',
      '/lists/list-1/food',
    )
  })

  it('shows days and total weight when planned', () => {
    renderRow(
      makeFood({
        dayCount: 3,
        items: [
          { id: 'f1', name: 'Ramen', weightGrams: 85, quantity: 2, sortOrder: 0, slotIds: [] },
        ],
      }),
    )
    expect(screen.getByText('3 days')).toBeInTheDocument()
    // 85 g x 2 carried units = 170 g, via foodGramsFor - never slot-joined
    expect(screen.getByLabelText('170 g')).toBeInTheDocument()
  })

  it('reads none-yet when nothing is planned', () => {
    renderRow(EMPTY)
    expect(screen.getByText('none yet')).toBeInTheDocument()
  })

  it('reads none-yet when days are set but nothing is carried', () => {
    // A three-day grid with zero items is still "nothing planned" weight-wise
    renderRow(makeFood({ dayCount: 3 }))
    expect(screen.getByText('3 days')).toBeInTheDocument()
    expect(screen.getByText('none yet')).toBeInTheDocument()
  })
})
```

(If `getByLabelText('170 g')` mismatches `formatItemWeight`'s exact label, read `src/lib/weight.ts:formatItemWeight` and assert its actual output — the assertion must go through the aria-label `ItemWeightValue` renders.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lists/FoodSummaryRow.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/lists/FoodSummaryRow.tsx`:

```tsx
import { Link } from 'react-router'
import {
  FLAT_TABLE_HEADER_TITLE,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_ROW,
  FLAT_TABLE_SURFACE,
} from '../components/flat-table-styles'
import ItemWeightValue from '../components/ItemWeightValue'
import { foodGramsFor } from '../lib/weight-breakdown'
import type { ListFoodResponse } from '../../shared/food'
import type { WeightUnit } from '../lib/weight'

// The List/Pack-view trace of the Food view. Food weight counts toward the
// totals shown on those views (withFoodWeight), and a weight contributor with
// no visible source is a trap - so the row stays behind when the planner
// moves to /lists/:id/food. Derived, never editable here.
export default function FoodSummaryRow({
  listId,
  food,
  weightUnit,
}: {
  listId: string
  food: ListFoodResponse
  weightUnit: WeightUnit
}) {
  const grams = foodGramsFor(food.items)
  return (
    <section aria-label="Food summary" className={`mt-3 ${FLAT_TABLE_SURFACE}`}>
      <Link
        to={`/lists/${listId}/food`}
        className={`${FLAT_TABLE_ROW} flex items-center gap-2 hover:bg-gray-50`}
      >
        <span className={`flex-1 ${FLAT_TABLE_HEADER_TITLE}`}>Food</span>
        {food.dayCount > 0 && (
          <span className={FLAT_TABLE_META_TEXT}>
            {food.dayCount} {food.dayCount === 1 ? 'day' : 'days'}
          </span>
        )}
        {food.items.length > 0 ? (
          <ItemWeightValue grams={grams} unit={weightUnit} />
        ) : (
          // Days without items is still zero carried weight - say so rather
          // than render a row that trails off after the day count.
          <span className={FLAT_TABLE_META_TEXT}>none yet</span>
        )}
      </Link>
    </section>
  )
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lists/FoodSummaryRow.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lists/FoodSummaryRow.tsx src/lists/FoodSummaryRow.test.tsx
git commit -m "feat: derived food summary row for list views"
```

### Task 5: `FoodView` — move the wiring, integrate the mode

**Files:**
- Create: `src/lists/FoodView.tsx`
- Modify: `src/lists/ListDetailPage.tsx` (mutations block ~lines 537-610, render site ~lines 1997-2029, main-column branch BEFORE the detail-data gate at ~line 690)
- Modify: `src/lists/ListDocumentToolbar.tsx:38` (split the unit selector from list settings)
- Modify: `src/lists/MobileListActionBar.tsx` (no gear Add in food mode)
- Test: `src/lists/ListDetailPage.food.test.tsx` (rework), `src/lists/FoodView.test.tsx` (new), `src/app-routes.test.tsx`, `src/layout/RootRedirect.test.tsx`, `src/lists/list-unit-control.test.tsx`, `src/layout/mobile-action-bars.test.tsx`

**Interfaces:**
- Consumes: `FoodSection` (unchanged in PR 1), query fns from `src/lib/queries/food.ts`, `queryKeys.listFood`, `mutationKeys.setFoodDays` etc.
- Produces: `FoodView({ listId }: { listId: string })` — self-contained: owns `useQuery(listFood)` + the five food mutations + `foodBusy`, renders `FoodSection`. `ListDetailPage` renders `<FoodView listId={listId} />` as the main-column content when `mode === 'food'`, branched BEFORE the `detailDataLoading`/`detailDataError` gate — the Food route must not be blocked by a gear/categories/items failure, and a food failure must reach FoodView's own retry, not the generic "Couldn't load list details". `<FoodSummaryRow … />` renders on the LIST view only (`mode === 'edit'`): the spec (docs/food-view-design.md section 3) puts the trace on the List view, and Pack keeps its packing focus — the Food tab in ListViewNav is the pack-mode path to food.

- [ ] **Step 1: Create `src/lists/FoodView.tsx`** by MOVING code, not rewriting it:

```tsx
import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import FoodSection from './FoodSection'
import { queryKeys } from '../lib/queries/keys'
import { mutationKeys } from '../lib/queries/mutation-keys'
import {
  createFoodItem,
  deleteFoodItem,
  fetchListFood,
  setFoodDays,
  setFoodSlotNeeded,
  updateFoodItem,
} from '../lib/queries/food'
import { ApiError } from '../lib/api'
import { showToast } from '../lib/toast'
import { FOOD_ITEM_CAP } from '../../shared/food'
import { useWeightUnit } from '../lib/use-weight-unit'

// The Food view: /lists/:id/food. Owns the food document query and every food
// mutation; ListDetailPage keeps its OWN subscription to the same query key
// for the weight breakdown and the summary row (React Query dedupes the
// fetch). Moved verbatim from ListDetailPage when food got its own view.
export default function FoodView({ listId }: { listId: string }) {
  const qc = useQueryClient()
  const { weightUnit } = useWeightUnit()

  const listFoodQuery = useQuery({
    queryKey: queryKeys.listFood(listId),
    queryFn: () => fetchListFood(listId),
  })

  // [MOVE the invalidateFood callback and ALL FIVE mutations
  //  (foodDaysMut, foodSlotMut, foodItemCreateMut, foodItemSlotsMut,
  //  foodItemDeleteMut) and foodBusy from ListDetailPage lines ~541-610,
  //  BYTE-IDENTICAL including every comment and toast string.]

  // Same three-state gate every reader uses (AGENTS.md): a fabricated empty
  // food object under live controls would let a day change write against
  // real rows. FoodSection only renders on resolved data.
  if (listFoodQuery.isLoadingError) {
    return (
      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        Couldn't load the food plan.{' '}
        <button
          type="button"
          onClick={() => void listFoodQuery.refetch()}
          className="font-medium underline"
        >
          Retry
        </button>
      </div>
    )
  }
  if (listFoodQuery.isPending) {
    return <p className="mt-3 px-3 py-2 text-sm text-gray-500">Loading food…</p>
  }

  return (
    <FoodSection
      food={listFoodQuery.data}
      weightUnit={weightUnit}
      busy={foodBusy}
      onSetDays={(days) => foodDaysMut.mutate(days)}
      onSetSlotNeeded={(slotId, needed) => foodSlotMut.mutate({ slotId, needed })}
      onAddItem={(input, onSuccess) =>
        foodItemCreateMut.mutate(input, { onSuccess: () => { invalidateFood(); onSuccess() } })
      }
      onDeleteItem={(itemId) => foodItemDeleteMut.mutate(itemId)}
      onSetItemSlots={(itemId, slotIds) => foodItemSlotsMut.mutate({ itemId, slotIds })}
    />
  )
}
```

The bracketed MOVE is literal: cut ListDetailPage lines 541-610 (from `const invalidateFood` through `const foodBusy = …`) and paste them where the comment sits. Check `useWeightUnit`'s real import path (grep `useWeightUnit` in ListDetailPage's imports) and mirror it. Note the current FoodSection render comment block (lines 1997-2017) explains why food renders in both views — move that comment's discoverability rationale into FoodSummaryRow's usage or delete it with the block; the Food tab in ListViewNav now answers it. The loading/error gate strings are new UI; keep them exactly as written here so tests can pin them.

- [ ] **Step 2: Integrate in `ListDetailPage.tsx`:**

1. Delete the moved mutations block (keep `listFoodQuery`/`listFood` at lines 531-535 — the breakdown at line 1188 and the summary row still need it; delete `foodBusy` and all five mutation consts and `invalidateFood`).
2. Replace the `<FoodSection …/>` block (lines 2018-2029) with a LIST-view-only summary row (Pack keeps its focus; the Food tab is pack's path to food):

```tsx
              {mode === 'edit' && (
                <FoodSummaryRow food={listFood} listId={listId} weightUnit={weightUnit} />
              )}
```

3. Render `FoodView` INSTEAD of the list body when `mode === 'food'`, branched ABOVE the `detailDataLoading`/`detailDataError` gate (line ~690's consumers). Food mode needs the lists query for the toolbar and nothing else from the detail set — `FoodView` owns its own food-query gates:

```tsx
{mode === 'food' ? (
  <FoodView listId={listId} />
) : (
  /* existing edit/pack body behind the detail-data gate, untouched */
)}
```

The `detailDataLoading`/`detailDataError` composite (which deliberately includes food so LIST/PACK totals can never silently omit food weight) stays exactly as it is for the other two modes.

4. Remove now-unused imports (`FoodSection`, `ApiError`/`showToast`/`FOOD_ITEM_CAP` if food mutations were their only consumers — check with `npm run lint`, which fails on unused imports).
5. Chrome decisions, explicit (each existing gate mishandles a third mode silently):
   - `ListDocumentToolbar.tsx:38` currently gates the unit selector AND list settings together on `mode === 'edit'`. Split them: `UnitSegmentedControl` renders when `mode === 'edit' || mode === 'food'` (the food view is weights everywhere; hiding the page-level unit control there is a regression), `ListSettingsButton` stays edit-only (list admin is not a food-view concern).
   - `MobileListActionBar` always pushes an Add item labeled "Add gear to list", and the drawer registration (`ListDetailPage.tsx:446`, `mode === 'edit' || mode === 'pack'`) leaves it DISABLED in food mode — a dead button. In food mode push no Add and no Options: destinations only. Leave the drawer registration as-is.
   - Then grep `grep -n "mode ===" src/lists/ListDetailPage.tsx src/lists/ListDocumentToolbar.tsx src/lists/MobileListActionBar.tsx` and read every remaining site for third-mode sanity; list any further decision in the PR description.
6. Extend `src/lists/list-unit-control.test.tsx` (unit selector present in food mode, absent in pack) and `src/layout/mobile-action-bars.test.tsx` (food mode: destinations only, no disabled Add).

- [ ] **Step 3: Rework `ListDetailPage.food.test.tsx`** — be honest about what it contains: six mounting/query-gate tests (reachable from both views; absent while loading; absent on sibling failure; absent on food failure), NOT mutation-contract tests. They rework as follows:
  - "renders the food section in List/Pack view" → the food EDITOR renders at `/lists/<id>/food`; the List view renders the summary row; the Pack view renders neither (assert absence).
  - "absent while detail data is still loading" → on the food route, FoodView shows its loading state, no live controls.
  - "absent when a sibling detail query fails" → INVERTED on the food route: a failed gear/categories/items query must NOT block the food editor (this pins Task 5's before-the-gate branch). On the List view the summary row stays behind the existing composite gate — assert that too.
  - "absent when the food query itself fails" → on the food route this now shows FoodView's retry state ("Couldn't load the food plan."), not the generic detail error.

  Also add a `/lists/:id/food` case to `src/app-routes.test.tsx` (route mounts ListDetailPage) and a cached-food-path fast-path case to `src/layout/RootRedirect.test.tsx` (a stored `/lists/<uuid>/food` restores to the food route) — the Task 2 regex test proves acceptance, not that the accepted path reaches a mounted route. Then add two assertions:

```tsx
  it('shows the food summary row on the list view', async () => {
    // render at /lists/<id> (the OLD initial entry), wait for load
    expect(await screen.findByRole('link', { name: /food/i })).toHaveAttribute(
      'href',
      `/lists/${LIST_ID}/food`,
    )
  })

  it('does not render the food editor inline on the list view', async () => {
    // render at /lists/<id>; the day-grid heading must be absent
    await screen.findByText(/* an element the list view always shows */)
    expect(screen.queryByLabelText('Trip length in days')).not.toBeInTheDocument()
  })
```

- [ ] **Step 4: New `src/lists/FoodView.test.tsx`** pinning the query gates (mock the fetch like ListDetailPage.food.test.tsx does — reuse its MSW/mock setup style):

```tsx
  it('shows retry, not live controls, when the food read fails', async () => {
    // arrange fetch to reject
    expect(await screen.findByText("Couldn't load the food plan.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Trip length in days')).not.toBeInTheDocument()
  })
```

- [ ] **Step 5: Run the full gates**

Run: `npx vitest run src/lists/` → all green.
Run: `npm run build` → exit 0.
Run: `npm run test:unit` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lists/FoodView.tsx src/lists/FoodView.test.tsx src/lists/ListDetailPage.tsx src/lists/ListDetailPage.food.test.tsx
git commit -m "feat: food gets its own list view at /lists/:id/food"
```

### Task 6: PR 1 gates and landing

- [ ] **Step 1:** `npm run build && npm run test:unit` — both exit 0. Review the complete diff (`git diff main...HEAD`) against docs/food-view-design.md section 2, 3, 6-PR-1.
- [ ] **Step 2:** GATE 2 adversarial review per CLAUDE.md (`/codex:adversarial-review --base main --background` if available in the session, else `codex exec -s read-only` with the same framing, and say which was used). Framing must name: the standing invariants from CLAUDE.md, plus "UI-only move: assert NO server files changed, NO api call added or reshaped, the moved mutation code is byte-identical, the query-gate trap (isLoadingError before isPending) holds in FoodView, and the stored-path regex broadening cannot accept a non-list path". Wait for VERDICT; fix MERGE-WITH-FIXES items.
- [ ] **Step 3:** Push, open PR 1 ("feat: food gets its own list view") with the design doc commit included. Confirm CI green with `gh run watch`, then merge only with the human's OK: `gh pr merge --squash --match-head-commit <sha>`.

---

## PR 2 — Redesign the Food view

Branch from fresh `main` after PR 1 lands: `git checkout main && git pull && git checkout -b food-view-redesign-2`.

### Task 7: `addFoodPreview` — the live preview line, pure

**Files:**
- Create: `src/lists/add-food-preview.ts`
- Test: `src/lists/add-food-preview.test.ts`

**Interfaces:**
- Consumes: `formatItemWeight(grams, unit)` from `src/lib/weight.ts`, `MEALS`/`FoodSlotResponse` from `shared/food.ts`.
- Produces:

```ts
export function addFoodPreview(input: {
  name: string
  weightGrams: number
  quantity: number
  slotIds: readonly string[]
  slots: readonly FoodSlotResponse[]   // the NEEDED slots the picker offers
  unit: WeightUnit
}): string | null
```

Returns null until the name is non-blank. Collapse rule (design 4.3): a fully-selected meal reads "every breakfast"; otherwise up to three slots are named "Day 2 breakfast", then "+ n more". No slots → "any time".

- [ ] **Step 1: Write the failing tests**:

```ts
import { describe, expect, it } from 'vitest'
import { addFoodPreview } from './add-food-preview'
import type { FoodSlotResponse } from '../../shared/food'

function slot(id: string, dayNumber: number, meal: FoodSlotResponse['meal']): FoodSlotResponse {
  return { id, dayNumber, meal, needed: true }
}

const SLOTS = [
  slot('b1', 1, 'breakfast'), slot('b2', 2, 'breakfast'),
  slot('l1', 1, 'lunch'), slot('l2', 2, 'lunch'),
  slot('d1', 1, 'dinner'), slot('d2', 2, 'dinner'),
]

describe('addFoodPreview', () => {
  it('is null with a blank name', () => {
    expect(addFoodPreview({ name: '  ', weightGrams: 80, quantity: 1, slotIds: [], slots: SLOTS, unit: 'g' })).toBeNull()
  })

  it('assembles name, weight, and a named slot', () => {
    expect(
      addFoodPreview({ name: 'Oatmeal', weightGrams: 80, quantity: 1, slotIds: ['b2'], slots: SLOTS, unit: 'g' }),
    ).toBe('Adding: Oatmeal · 80 g · Day 2 breakfast')
  })

  it('shows quantity past one', () => {
    expect(
      addFoodPreview({ name: 'Oatmeal', weightGrams: 80, quantity: 2, slotIds: [], slots: SLOTS, unit: 'g' }),
    ).toBe('Adding: Oatmeal · 80 g × 2 · any time')
  })

  it('collapses a fully selected meal', () => {
    expect(
      addFoodPreview({ name: 'Oatmeal', weightGrams: 80, quantity: 1, slotIds: ['b1', 'b2'], slots: SLOTS, unit: 'g' }),
    ).toBe('Adding: Oatmeal · 80 g · every breakfast')
  })

  it('elides past three named slots', () => {
    expect(
      addFoodPreview({ name: 'Bar', weightGrams: 50, quantity: 1, slotIds: ['b1', 'l1', 'd1', 'l2'], slots: SLOTS, unit: 'g' }),
    ).toBe('Adding: Bar · 50 g · Day 1 breakfast, Day 1 lunch, Day 1 dinner, + 1 more')
  })

  it('omits the weight segment at zero grams', () => {
    expect(
      addFoodPreview({ name: 'Mystery', weightGrams: 0, quantity: 1, slotIds: [], slots: SLOTS, unit: 'g' }),
    ).toBe('Adding: Mystery · any time')
  })
})
```

(Adjust the exact weight strings to `formatItemWeight`'s real output after reading it — the tests assert through the same formatter the UI uses; do not hand-roll "80 g" if the formatter emits something else.)

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement**:

```ts
import { MEALS, type FoodSlotResponse } from '../../shared/food'
import { formatItemWeight, type WeightUnit } from '../lib/weight'

const NAMED_SLOT_LIMIT = 3

// The add-form's confirmation-before-commit line. Pure so it is testable
// without rendering; the form derives it every keystroke.
export function addFoodPreview(input: {
  name: string
  weightGrams: number
  quantity: number
  slotIds: readonly string[]
  slots: readonly FoodSlotResponse[]
  unit: WeightUnit
}): string | null {
  const name = input.name.trim()
  if (!name) return null
  const parts = [name]
  if (input.weightGrams > 0) {
    const weight = formatItemWeight(input.weightGrams, input.unit)
    parts.push(input.quantity > 1 ? `${weight} × ${input.quantity}` : weight)
  }
  parts.push(describeSlots(input.slotIds, input.slots))
  return `Adding: ${parts.join(' · ')}`
}

function describeSlots(
  slotIds: readonly string[],
  slots: readonly FoodSlotResponse[],
): string {
  if (slotIds.length === 0) return 'any time'
  const selected = new Set(slotIds)
  const wholeMeals: string[] = []
  const rest: FoodSlotResponse[] = []
  for (const meal of MEALS) {
    const mealSlots = slots.filter((s) => s.meal === meal)
    if (mealSlots.length > 0 && mealSlots.every((s) => selected.has(s.id))) {
      wholeMeals.push(`every ${meal}`)
    } else {
      rest.push(...mealSlots.filter((s) => selected.has(s.id)))
    }
  }
  const named = rest
    .slice(0, NAMED_SLOT_LIMIT)
    .map((s) => `Day ${s.dayNumber} ${s.meal}`)
  const parts = [...wholeMeals, ...named]
  const more = rest.length - named.length
  if (more > 0) parts.push(`+ ${more} more`)
  return parts.join(', ')
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lists/add-food-preview.ts src/lists/add-food-preview.test.ts
git commit -m "feat: pure preview line for the add-food form"
```

### Task 8: `FoodSlotPicker` — full-name touch targets

**Files:**
- Create: `src/lists/FoodSlotPicker.tsx` (extraction of `SlotChoices` from `FoodSection.tsx:534-613`)
- Test: `src/lists/FoodSlotPicker.test.tsx`

**Interfaces:**
- Produces: `FoodSlotPicker({ slots, selected, onChange }: { slots: readonly FoodSlotResponse[]; selected: readonly string[]; onChange: (next: string[]) => void })`. Whole-meal chips keep their current labels ("Every breakfast", `aria-pressed`). Per-day rows become three full-name toggle chips with `aria-pressed` and `aria-label` `` `${Meal label} day ${n}` `` (same accessible names as the old checkboxes so ported tests keep passing).

- [ ] **Step 1: Write the failing tests** — port the SlotChoices-related assertions out of `FoodSection.test.tsx` (whole-meal toggle selects all of a meal; single-slot toggle; deselect) and add:

```tsx
  it('renders full meal names as day toggles, not single letters', () => {
    renderPicker() // 2 days x 3 meals, all needed
    const dayOneBreakfast = screen.getByRole('button', { name: 'Breakfast day 1' })
    expect(dayOneBreakfast).toHaveTextContent('Breakfast')
    expect(dayOneBreakfast).toHaveAttribute('aria-pressed', 'false')
  })
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement** — copy `SlotChoices` into the new file with the checkbox row replaced:

```tsx
      {days.map((day) => (
        <div key={day} className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
          <span className={`w-12 shrink-0 ${FLAT_TABLE_META_TEXT}`}>Day {day}</span>
          {MEALS.map((meal) => {
            const slot = slots.find((s) => s.dayNumber === day && s.meal === meal)
            if (!slot) return null
            const on = selected.includes(slot.id)
            return (
              <button
                key={slot.id}
                type="button"
                aria-pressed={on}
                aria-label={`${MEAL_LABELS[meal]} day ${day}`}
                onClick={() =>
                  onChange(
                    on
                      ? selected.filter((id) => id !== slot.id)
                      : [...selected, slot.id],
                  )
                }
                className={`min-h-9 rounded-full border px-3 text-sm font-medium ${
                  on
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {MEAL_LABELS[meal]}
              </button>
            )
          })}
        </div>
      ))}
```

Keep the whole-meal chips block verbatim. `MEAL_LABELS` moves here (exported) since `FoodSection` dies in Task 12; export it: `export const MEAL_LABELS: Record<Meal, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' }` (keep the "Joe's definition" comment on lunch). Drop the `max-h-40 overflow-y-auto` scroll cage — the full page owns scrolling now (design 4.3 wants touch-friendly, not a 10rem viewport).

- [ ] **Step 4: Run tests** → PASS. `FoodSection.tsx` still has its own private copies; they die in Task 12 — do not edit FoodSection in this task.

- [ ] **Step 5: Commit**

```bash
git add src/lists/FoodSlotPicker.tsx src/lists/FoodSlotPicker.test.tsx
git commit -m "feat: touch-friendly food slot picker with full meal names"
```

### Task 9: `AddFoodForm` — labeled, unit-aware, previewing

**Files:**
- Create: `src/lists/AddFoodForm.tsx`
- Test: `src/lists/AddFoodForm.test.tsx`

**Interfaces:**
- Consumes: `WeightInput`, `FoodSlotPicker`, `addFoodPreview`, bounds from `shared/food.ts`.
- Produces:

```ts
export default function AddFoodForm(props: {
  slots: readonly FoodSlotResponse[]        // needed slots only (caller filters)
  busy: boolean
  weightUnit: WeightUnit
  // Slot selection is CONTROLLED by the caller. A prop captured once into
  // useState would make a second per-slot "+ Add" a no-op while the form is
  // already open - FoodView owns the selection so it can union a slot in at
  // any time without remounting (a remount would eat the typed name/weight).
  selectedSlotIds: readonly string[]
  onSelectedSlotIdsChange: (next: string[]) => void
  onCancel: () => void
  onSubmit: (
    input: { name: string; weightGrams: number; quantity: number; slotIds: string[] },
    onSuccess: () => void,
  ) => void
})
```

`onSubmit` keeps the existing success-close contract: the CALLER closes the form only via the `onSuccess` callback, so a cap rejection never eats typed input.

- [ ] **Step 1: Write the failing tests** — port the ONE existing add-form assertion from `FoodSection.test.tsx` ("defaults quantity to 1 even when every breakfast is selected"). The rest are NEW — the current suite never tested them (GATE 1 finding): validation bounds mirroring `shared/food.ts` (blank name, name > 128, weight > 100000, quantity 0 and > 9999 all disable submit), the exact submit payload shape, busy-state disabling, and typed data surviving a rejected submit (the caller not invoking `onSuccess` leaves every field intact — render with an `onSubmit` that never calls it and assert the values persist). Then add:

```tsx
  it('labels every field and shows the unit toggle', () => {
    renderForm()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Weight')).toBeInTheDocument()
    expect(screen.getByLabelText('Qty')).toBeInTheDocument()
    // WeightInput's unit toggle: "Entering grams, switch to ounces"
    expect(screen.getByRole('button', { name: /entering grams/i })).toBeInTheDocument()
  })

  it('assembles the live preview as fields fill', async () => {
    renderForm()
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.type(screen.getByLabelText('Weight'), '80')
    expect(screen.getByText(/Adding: Oatmeal/)).toBeInTheDocument()
  })

  it('reflects the controlled slot selection', () => {
    renderForm({ selectedSlotIds: ['b2'] })
    expect(screen.getByRole('button', { name: 'Breakfast day 2' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('reports selection changes instead of owning them', async () => {
    const onSelectedSlotIdsChange = vi.fn()
    renderForm({ selectedSlotIds: [], onSelectedSlotIdsChange })
    await user.click(screen.getByRole('button', { name: 'Breakfast day 2' }))
    expect(onSelectedSlotIdsChange).toHaveBeenCalledWith(['b2'])
  })
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** — start from `FoodSection.tsx`'s `AddFoodForm` (lines 390-491) with these changes:

1. Weight state becomes grams (number), fed by `WeightInput`:

```tsx
  const [weightGrams, setWeightGrams] = useState(0)
```

`MAX_ITEM_WEIGHT_GRAMS` (100000, `src/lib/caps.ts:25`) equals the food weight cap in `shared/food.ts`, so WeightInput's internal clamp and the server bound agree; state this in a comment rather than re-clamping.

2. Visible labels, fields in a row on desktop:

```tsx
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-gray-700">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={128}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
          Weight
          <WeightInput
            grams={weightGrams}
            onChange={setWeightGrams}
            className="w-32"
            inputClassName="w-full rounded border border-gray-300 px-2 py-1.5 text-right text-sm font-normal tabular-nums"
            inputId="add-food-weight"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
          Qty
          <input
            type="number" min={1} max={9999} value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-16 rounded border border-gray-300 px-2 py-1.5 text-right text-sm font-normal tabular-nums"
          />
        </label>
      </div>
```

Associate the Weight label with WeightInput's input via `htmlFor="add-food-weight"` + `inputId` (WeightInput exposes `inputId`). Keep the ONE-not-slot-count quantity comment.

3. The preview, above the buttons:

```tsx
      {preview && <p className="text-sm text-gray-600">{preview}</p>}
```

where `const preview = addFoodPreview({ name, weightGrams, quantity: quantityValue, slotIds: selected, slots, unit: weightUnit })` — pass the CURRENT WeightInput display unit? No: `weightUnit` prop (the app display preference) — the preview is display, not entry.

4. Validation mirrors `shared/food.ts` bounds as today, minus the string-weight parsing (grams are already a clamped number).
5. Primary button text becomes "Add food"; keep the existing blue button classes from FoodSection's form.
6. Slot selection: no local state — render `FoodSlotPicker` with `selected={selectedSlotIds}` and `onChange={onSelectedSlotIdsChange}` straight from props; submit reads `props.selectedSlotIds`.

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lists/AddFoodForm.tsx src/lists/AddFoodForm.test.tsx
git commit -m "feat: labeled, unit-aware add-food form with live preview"
```

### Task 10: `FoodDaySection` — the redesigned day grid

**Files:**
- Create: `src/lists/FoodDaySection.tsx`
- Test: `src/lists/FoodDaySection.test.tsx`

**Interfaces:**
- Consumes: `ItemWeightValue`, flat-table styles, `MEAL_LABELS` from `FoodSlotPicker.tsx`.
- Produces:

```ts
export default function FoodDaySection(props: {
  day: number
  slots: readonly FoodSlotResponse[]              // this day's slots, MEALS order
  itemsBySlot: ReadonlyMap<string, FoodItemResponse[]>
  weightUnit: WeightUnit
  busy: boolean
  onSetSlotNeeded: (slotId: string, needed: boolean) => void
  onAddToSlot: (slotId: string) => void           // opens the add form preselected
})
```

- [ ] **Step 1: Write the failing tests** — port the day-grid assertions from `FoodSection.test.tsx` (three states render distinguishably; skip-with-food confirms; toggle calls through) updating for the new copy, and add:

```tsx
  it('shows each food with quantity and weight inline', () => {
    renderDay() // lunch holds Trail mix, 120 g x 2
    const lunch = screen.getByText('Lunch').closest('div')!
    expect(within(lunch).getByText('Trail mix')).toBeInTheDocument()
    expect(within(lunch).getByText('× 2')).toBeInTheDocument()
    expect(within(lunch).getByLabelText('240 g')).toBeInTheDocument()
  })

  it('totals the day counting a twice-scheduled item once', () => {
    // same item id in breakfast AND lunch of this day: day total must not double
    renderDayWithSharedItem() // one 500 g item in two slots
    expect(screen.getByLabelText('500 g')).toBeInTheDocument()
  })

  it('offers + Add on an empty needed slot, preselecting it', async () => {
    renderDay()
    await user.click(within(dinnerRow()).getByRole('button', { name: /add/i }))
    expect(onAddToSlot).toHaveBeenCalledWith('d1')
  })

  it('reads Skip and Restore, not the old labels', () => {
    renderDay()
    expect(screen.getAllByRole('button', { name: 'Skip' }).length).toBeGreaterThan(0)
    expect(screen.queryByText('Not needed')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**:

```tsx
import { within } from 'no-op' // (illustrative removal — no such import; structure below)

export default function FoodDaySection({ day, slots, itemsBySlot, weightUnit, busy, onSetSlotNeeded, onAddToSlot }: Props) {
  // Day total counts each distinct item ONCE even when it is scheduled at two
  // of this day's meals - summing per-slot repeats is the exact inflation
  // foodGramsFor's comment warns about (weight-breakdown.ts:135).
  const dayItems = new Map<string, FoodItemResponse>()
  for (const slot of slots) {
    for (const item of itemsBySlot.get(slot.id) ?? []) dayItems.set(item.id, item)
  }
  const dayGrams = foodGramsFor([...dayItems.values()])

  return (
    <section aria-label={`Day ${day}`} className="border-t border-gray-100 first:border-t-0">
      <div className={`px-3 pt-2.5 pb-1 ${FLAT_TABLE_EYEBROW}`}>Day {day}</div>
      {slots.map((slot) => {
        const slotItems = itemsBySlot.get(slot.id) ?? []
        const slotGrams = foodGramsFor(slotItems)
        return (
          <div key={slot.id} className={`${FLAT_TABLE_ROW} flex items-start gap-2 ${slot.needed ? '' : 'bg-gray-50'}`}>
            <span className={`w-20 shrink-0 pt-0.5 ${FLAT_TABLE_META_TEXT} ${slot.needed ? '' : 'line-through'}`}>
              {MEAL_LABELS[slot.meal]}
            </span>
            <span className="min-w-0 flex-1">
              {!slot.needed ? (
                <span className={FLAT_TABLE_META_TEXT}>Skipped</span>
              ) : slotItems.length === 0 ? (
                <span className="inline-flex items-center gap-2">
                  {/* The omission check. Reads as unfinished on purpose. */}
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                    Nothing planned
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onAddToSlot(slot.id)}
                    className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
                  >
                    + Add
                  </button>
                </span>
              ) : (
                <span className="flex flex-col gap-0.5">
                  {slotItems.map((item) => (
                    <span key={item.id} className="flex items-baseline gap-2">
                      <span className={`min-w-0 flex-1 truncate ${FLAT_TABLE_BODY_TEXT}`}>{item.name}</span>
                      {item.quantity > 1 && (
                        <span className={FLAT_TABLE_META_TEXT}>× {item.quantity}</span>
                      )}
                      <ItemWeightValue grams={item.weightGrams * item.quantity} unit={weightUnit} />
                    </span>
                  ))}
                  {slotItems.length > 1 && (
                    <span className={`flex justify-end border-t border-gray-100 pt-0.5 ${FLAT_TABLE_META_TEXT}`}>
                      <ItemWeightValue grams={slotGrams} unit={weightUnit} />
                    </span>
                  )}
                </span>
              )}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => { /* MOVE the skip-with-food window.confirm from FoodSection.tsx:229-241, copy updated: "Skipping" for "Marking it not needed" */ onSetSlotNeeded(slot.id, !slot.needed) }}
              className="shrink-0 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
            >
              {slot.needed ? 'Skip' : 'Restore'}
            </button>
          </div>
        )
      })}
      <div className={`flex justify-end gap-2 px-3 pb-2 ${FLAT_TABLE_META_TEXT}`}>
        <span>Day total</span>
        <ItemWeightValue grams={dayGrams} unit={weightUnit} />
      </div>
    </section>
  )
}
```

(The first illustrative import line is not real — the component imports `foodGramsFor`, `ItemWeightValue`, flat-table constants, `MEAL_LABELS`, and shared food types.) The confirm text, moved and reworded:

```ts
`${MEAL_LABELS[slot.meal]} on day ${day} has food planned for it. ` +
  'Skipping it unschedules that food - it stays on the list and still ' +
  'counts toward your pack weight. Continue?'
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lists/FoodDaySection.tsx src/lists/FoodDaySection.test.tsx
git commit -m "feat: redesigned food day sections with inline weights"
```

### Task 11: `FoodCarryingList` — one list, badge, totals

**Files:**
- Create: `src/lists/FoodCarryingList.tsx` (absorbs `FoodItemRow`, FoodSection.tsx:339-388)
- Test: `src/lists/FoodCarryingList.test.tsx`

**Interfaces:**
- Produces:

```ts
export default function FoodCarryingList(props: {
  items: readonly FoodItemResponse[]
  weightUnit: WeightUnit
  busy: boolean
  onReschedule: (itemId: string) => void
  onDelete: (itemId: string) => void
})
```

- [ ] **Step 1: Write the failing tests** — these are NEW, not ports: `FoodSection.test.tsx` never covered `FoodItemRow` (GATE 1 finding). Write: Schedule vs Reschedule button naming by `slotIds` presence, the `Remove <name>` delete aria-label, per-row quantity display (`2 × `), and:

```tsx
  it('renders one list with an Unscheduled badge instead of a duplicate section', () => {
    renderList() // one scheduled, one unscheduled item
    expect(screen.getAllByText('Ramen')).toHaveLength(1)
    const unscheduledRow = screen.getByText('Trail mix').closest('div')!
    expect(within(unscheduledRow).getByText('Unscheduled')).toBeInTheDocument()
    expect(screen.queryByText('Any time')).not.toBeInTheDocument()
  })

  it('closes with an item count and total weight', () => {
    renderList() // 85 g + 240 g
    expect(screen.getByText('2 items')).toBeInTheDocument()
    expect(screen.getByLabelText('325 g')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** — `FoodItemRow` moves in nearly verbatim (keep the repairable-without-retyping comment on `onEditSlots`); the unscheduled state renders as a badge in the row's meta line instead of the "Any time" text:

```tsx
        <span className={`block ${FLAT_TABLE_META_TEXT}`}>
          {item.quantity > 1 ? `${item.quantity} × ` : ''}
          {item.slotIds.length > 0 ? (
            `${item.slotIds.length} ${item.slotIds.length === 1 ? 'meal' : 'meals'}`
          ) : (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">
              Unscheduled
            </span>
          )}
        </span>
```

Footer row:

```tsx
      <div className={`flex items-center justify-end gap-2 border-t border-gray-100 px-3 py-2 ${FLAT_TABLE_META_TEXT}`}>
        <span>{items.length} {items.length === 1 ? 'item' : 'items'}</span>
        <ItemWeightValue grams={foodGramsFor(items)} unit={weightUnit} />
      </div>
```

The "don't double-count a Food bag gear row" paragraph (FoodSection.tsx:327-333) moves under this footer verbatim.

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lists/FoodCarryingList.tsx src/lists/FoodCarryingList.test.tsx
git commit -m "feat: single carrying list with unscheduled badge and totals"
```

### Task 12: Compose the new `FoodView`; delete `FoodSection`

**Files:**
- Modify: `src/lists/FoodView.tsx`
- Delete: `src/lists/FoodSection.tsx`, `src/lists/FoodSection.test.tsx`
- Test: extend `src/lists/FoodView.test.tsx`

**Interfaces:**
- Consumes: everything Tasks 7-11 produced.
- Produces: the shipped Food view — header (title, days input, meal counts, explainer), day sections, add-food card, carrying card, inline reschedule.

- [ ] **Step 1: Write/port the failing tests** — everything left in `FoodSection.test.tsx` not already ported (days-input guards: empty-is-not-zero, out-of-range revert, shrink-confirm via `losesWorkBelow`; add-success closes the form; reschedule save path) moves into `FoodView.test.tsx`, retargeted at `FoodView`. Add:

```tsx
  it('shows the explainer line', async () => {
    renderFoodView()
    expect(await screen.findByText("Skip meals you'll eat in town or on the road.")).toBeInTheDocument()
  })

  it('+ Add on a slot opens the form with that slot preselected', async () => {
    renderFoodView()
    await user.click(within(await findDinnerRow()).getByRole('button', { name: /add/i }))
    expect(screen.getByRole('button', { name: 'Dinner day 1' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('+ Add unions into an already-open form without eating typed input', async () => {
    renderFoodView()
    await user.click(screen.getByRole('button', { name: 'Add food' }))
    await user.type(screen.getByLabelText('Name'), 'Oatmeal')
    await user.click(within(await findDinnerRow()).getByRole('button', { name: /add/i }))
    expect(screen.getByRole('button', { name: 'Dinner day 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Name')).toHaveValue('Oatmeal')
  })
```

Plus the mutation-contract tests the old suites never had (GATE 1 finding — write them here, where FoodView owns the mutations, mocking the query-fn modules the way `ListDetailPage.food.test.tsx` does):

- the 422 cap rejection raises exactly `Food item limit reached (200 per list).` and the form stays open with its typed values;
- a 400 raises the check-the-fields toast, never the generic one;
- create/delete/reschedule call `createFoodItem`/`deleteFoodItem`/`updateFoodItem` with the expected arguments;
- unscheduling sends an explicit `slotIds: []` (the DTO distinguishes `[]` from omitted — omitted means leave-alone);
- the add form closes ONLY after mutation success (success-only close), and every control disables while `foodBusy`.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** — `FoodView` replaces its `<FoodSection …/>` render with the composition. State and pieces that MOVE from FoodSection (keep their comments): `daysDraft`/`lastSeenDayCount` follow-the-server pair, `losesWorkBelow` (with its doc comment), the days input JSX with the empty-field guard and KNOWN GAP comment (Phase 8 removes it; it must survive this refactor verbatim), `itemsBySlot` construction, derived `counts`, `editingItemId` + the inline reschedule block (now rendering `FoodSlotPicker` + Save/Cancel). New state:

```tsx
  const [adding, setAdding] = useState(false)
  // Owned HERE, not in AddFoodForm: a per-slot "+ Add" must be able to union
  // a slot into an ALREADY-OPEN form without remounting it (a remount would
  // eat the typed name and weight). GATE 1 caught the captured-once version.
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([])
  const addFormRef = useRef<HTMLDivElement | null>(null)

  function openAddForSlot(slotId: string) {
    setSelectedSlotIds((prev) => (prev.includes(slotId) ? prev : [...prev, slotId]))
    setAdding(true)
    // Scroll after the form mounts; rAF beats the render race without a layout effect.
    requestAnimationFrame(() => addFormRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }
```

Composition (structure, using the moved pieces):

```tsx
    <div className="mt-3 space-y-3">
      <section className={FLAT_TABLE_SURFACE}>
        {/* header: "Food" title + days input + counts eyebrow (moved) */}
        <p className={`px-3 pb-2 ${FLAT_TABLE_META_TEXT}`}>
          Skip meals you'll eat in town or on the road.
        </p>
      </section>

      {food.dayCount === 0 ? (
        <p className="px-3 py-3 text-sm text-gray-500">{/* moved zero-day copy */}</p>
      ) : (
        <section className={FLAT_TABLE_SURFACE}>
          {days.map((day) => (
            <FoodDaySection key={day} day={day} slots={slotsForDay(day)} itemsBySlot={itemsBySlot}
              weightUnit={weightUnit} busy={foodBusy}
              onSetSlotNeeded={(slotId, needed) => foodSlotMut.mutate({ slotId, needed })}
              onAddToSlot={openAddForSlot} />
          ))}
        </section>
      )}

      <section ref={addFormRef} className={`${FLAT_TABLE_SURFACE} px-3 py-2.5`}>
        {adding ? (
          <AddFoodForm slots={neededSlots} busy={foodBusy} weightUnit={weightUnit}
            selectedSlotIds={selectedSlotIds}
            onSelectedSlotIdsChange={setSelectedSlotIds}
            onCancel={() => { setAdding(false); setSelectedSlotIds([]) }}
            onSubmit={(input, onSuccess) =>
              foodItemCreateMut.mutate(input, { onSuccess: () => { invalidateFood(); onSuccess(); setAdding(false); setSelectedSlotIds([]) } })
            } />
        ) : (
          <button type="button" disabled={foodBusy} onClick={() => setAdding(true)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            Add food
          </button>
        )}
      </section>

      {food.items.length > 0 && (
        <section className={FLAT_TABLE_SURFACE}>
          <div className={`px-3 pt-2 ${FLAT_TABLE_EYEBROW}`}>Carrying</div>
          <FoodCarryingList items={food.items} weightUnit={weightUnit} busy={foodBusy}
            onReschedule={setEditingItemId} onDelete={(id) => foodItemDeleteMut.mutate(id)} />
          {editingItem && (/* moved reschedule block, rendering FoodSlotPicker */)}
        </section>
      )}
    </div>
```

Note the AddFoodForm submit wiring: FoodView owns BOTH the mutate call and the close (the `onSuccess` callback closes; a failure leaves the form open with its state — same contract as today).

Then delete `FoodSection.tsx` and `FoodSection.test.tsx`.

- [ ] **Step 4: Prove the deletion is complete**

Run: `grep -rn "FoodSection" src/ shared/ server/`
Expected: zero hits. Run: `npx vitest run src/lists/` → green. Run: `npm run build` → exit 0 (also proves no unused imports).

- [ ] **Step 5: Commit**

```bash
git add src/lists/FoodView.tsx src/lists/FoodView.test.tsx
git rm src/lists/FoodSection.tsx src/lists/FoodSection.test.tsx
git commit -m "feat: compose the redesigned food view, retire FoodSection"
```

### Task 13: PR 2 gates and landing

- [ ] **Step 1:** `npm run build && npm run test:unit` — exit 0. Review the complete diff against docs/food-view-design.md sections 4, 5, 7; confirm every kept behavior in section 5 has a surviving test (grep test names).
- [ ] **Step 2:** Browser verification with the `verify` skill (dev server): walk List → Food tab → set days → skip/restore with confirm → add via form watching the preview → per-slot + Add preselects → reschedule → delete → summary row updates on List view → totals match the weight summary. Check mobile viewport (drawer width) and desktop.
- [ ] **Step 3:** GATE 2 adversarial review (same mechanics as Task 6 Step 2). Framing adds: "day totals must count a twice-scheduled item once (foodGramsFor discipline); the add form's grams state cannot drift from WeightInput's clamp; the KNOWN GAP comment must have survived; confirm dialogs still fire on skip-with-food and shrink-with-work."
- [ ] **Step 4:** Push, PR 2, `gh run watch`, human OK, `gh pr merge --squash --match-head-commit <sha>`.
- [ ] **Step 5:** Report back for Phase 8 (P1.6) — releases 8A/8B now land on `FoodView` per `docs/review-remediation-plan.md` N1.

---

## Plan self-review notes (done at write time)

- Spec coverage: design §2 → Tasks 1-3; §3 → Tasks 4-5; §4.1 → Task 12; §4.2 → Task 10; §4.3 → Tasks 7-9; §4.4 → Task 11; §5 → test ports throughout; §6 → PR split as specified; §7 decisions all embodied.
- The `losesWorkBelow` shrink-confirm and KNOWN GAP comment are explicitly carried (Task 12) — Phase 8 depends on finding them.
- Type consistency: `FoodSlotResponse`/`FoodItemResponse` names match `shared/food.ts`; `MEAL_LABELS` exported once from `FoodSlotPicker.tsx` after Task 8, consumed by Task 10.
- Exact-string test assertions (weight labels, preview lines) are flagged to verify against `formatItemWeight` before trusting — the formatter, not the plan, is authoritative.

## GATE 1 amendments (2026-08-06, Codex VERDICT: MERGE-WITH-FIXES)

All six findings verified against the code and folded in above:

1. `FoodView` now branches ABOVE the `detailDataLoading`/`detailDataError` composite (Task 5), with route-level tests for sibling-failure independence and FoodView's own retry.
2. Food-mode chrome decided explicitly (Task 5 step 5): unit selector yes, list settings no, mobile bar destinations-only (no disabled gear-Add); `list-unit-control` and `mobile-action-bars` tests extended.
3. `AddFoodForm` slot selection is controlled by `FoodView` (Tasks 9/12) so per-slot "+ Add" unions into an open form without a remount; already-open test added.
4. `FoodSummaryRow` is List-view-only per the spec, and reads "none yet" whenever no items are carried, days or not (Tasks 4-5).
5. Test-port language corrected to match what the old suites actually contain; the never-written mutation-contract tests (422/400 toasts, failure persistence, busy states, wiring, `[]`-vs-omitted `slotIds`, success-only close) are scheduled in Tasks 9/11/12, plus `app-routes` and `RootRedirect` route-reachability cases (Task 5).
6. `writeLastListPath` (the real helper name) replaces the invented `saveLastListPath` in Task 2.
