# List Draft Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-list `is_draft` completeness flag that shows a "Draft" pill on every owner surface, is clickable to "Mark list complete," and renders a "work in progress" banner on the public share view.

**Architecture:** One boolean column on `lists`, defaulting to draft for new lists and complete for existing ones. A shared `draftMut` (in `useCurrentListActions`) does an optimistic `['lists']`-cache toggle reused by the detail header and the settings panel. Two new presentational components - `DraftBadge` (pill) and `DraftBanner` (share-view banner) - keep the visual in one place. The status is a label only: it never locks editing and is independent of `is_shared`.

**Tech Stack:** React + TypeScript, TanStack Query (optimistic updates via `makeOptimisticUpdate`), Supabase/PostgREST, Vite, Vitest + @testing-library/react, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-05-list-draft-status-design.md`

---

## File Structure

**Create:**
- `supabase/migrations/20260605000000_add_is_draft_to_lists.sql` - the column + default flip.
- `src/components/DraftBadge.tsx` - reusable "Draft" pill (indicator).
- `src/components/DraftBadge.test.tsx`
- `src/lists/DraftBanner.tsx` - share-view "work in progress" banner.
- `src/lists/DraftBanner.test.tsx`

**Modify:**
- `src/lib/types.ts` - add `is_draft` to `List` and to the `PublicList` Pick.
- `src/lib/queries/lists.ts` - `fetchSharedList` select + `updateList` whitelist.
- `src/lib/optimistic-list-placeholder.ts` - set `is_draft: true`.
- `src/lib/queries/shared-projections.test.ts` - widen the pinned public projection.
- `src/lists/use-current-list-actions.ts` - add shared `draftMut`.
- `src/lists/SharePage.tsx` - render `DraftBanner` when `is_draft`.
- `src/lists/ListsPage.tsx` - `DraftBadge` in `ListRow`.
- `src/lists/DesktopListsPanel.tsx` - `DraftBadge` in `ListPanelRow`.
- `src/lists/CurrentListHeader.tsx` - clickable "Mark list complete" pill.
- `src/lists/ListSettingsPanel.tsx` - Draft toggle row.

**Intentionally NOT modified:** `duplicate_list` RPC (decision 8 - duplicates inherit the table default `true`), `createList` (new lists get the DB default `true`).

---

## Task 1: Database migration - add `is_draft` to `lists`

**Files:**
- Create: `supabase/migrations/20260605000000_add_is_draft_to_lists.sql`

A column migration is not unit-testable in this repo (the test suite mocks Supabase). Verification is review of the SQL + the downstream type/query tasks. The default-flip ordering is the load-bearing detail.

- [ ] **Step 1: Write the migration**

```sql
-- Phase: per-list draft/complete status.
--
-- Adds public.lists.is_draft. A list is a "draft" (still being built) or not.
-- This is a completeness LABEL only: it never locks editing, and it is
-- independent of is_shared (you can share a draft for a "shakedown" review).
-- The public /r/<slug> share view renders a "work in progress" banner when
-- is_draft is true; the owner sees a "Draft" pill on every list surface.
--
-- Default flip (the important part): NEW lists must default to draft (true),
-- but EXISTING lists are already built/shared and must NOT be retroactively
-- labeled "work in progress". So we add the column with DEFAULT false - which
-- sets every existing row to false in place, no bulk UPDATE - and THEN flip the
-- default to true so future inserts are drafts.
--
-- Append-only column add: RLS policies, FK constraints, and existing query
-- results are unaffected.
alter table public.lists
  add column is_draft boolean not null default false;

alter table public.lists
  alter column is_draft set default true;

-- duplicate_list is intentionally NOT modified. It enumerates the columns it
-- copies and already omits is_shared, so duplicates reset to private. is_draft
-- follows the same "status resets, shape inherits" rule: by omitting it, a
-- duplicated row takes the table default (true), so every duplicate starts as a
-- draft - consistent with new-list creation. See the design spec, decision 8.
```

- [ ] **Step 2: Verify the file**

Run: `cat supabase/migrations/20260605000000_add_is_draft_to_lists.sql`
Expected: the two `alter table` statements in order (add column default false, then set default true), and no change to `duplicate_list`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260605000000_add_is_draft_to_lists.sql
git commit -m "feat(lists): add is_draft column with new-lists-draft default

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Data layer - `is_draft` on types, query, placeholder, and public projection

**Files:**
- Modify: `src/lib/queries/shared-projections.test.ts:153-183` (the `fetchSharedList` describe block)
- Modify: `src/lib/types.ts:3-22` (`List`) and `src/lib/types.ts:90` (`PublicList`)
- Modify: `src/lib/queries/lists.ts:83` (`fetchSharedList` select) and `src/lib/queries/lists.ts:117-125` (`updateList` whitelist)
- Modify: `src/lib/optimistic-list-placeholder.ts:33-45`

`is_draft` is a deliberate widening of the public projection (it IS the public signal). The pinned projection test is where that widening must be reviewed, so we change the test first and watch it fail.

- [ ] **Step 1: Widen the public projection test (RED)**

In `src/lib/queries/shared-projections.test.ts`, inside `describe('fetchSharedList ...')`, update the mock data, the select-string assertion, and the key-set assertion.

Change the mock data block (was `id/name/description/group_worn`) to add `is_draft`:

```tsx
    mockState.nextSingle = {
      data: {
        id: 'list-1',
        name: 'Trip',
        description: 'Notes',
        group_worn: false,
        is_draft: true,
      },
      error: null,
    }
```

Change the select-string assertion:

```tsx
    expect(cols).toBe('id, name, description, group_worn, is_draft')
```

Change the key-set assertion (sorted, `is_draft` inserted before `name`):

```tsx
    expect(Object.keys(result!).sort()).toEqual(
      ['description', 'group_worn', 'id', 'is_draft', 'name'],
    )
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/queries/shared-projections.test.ts`
Expected: FAIL - `fetchSharedList` still selects `'id, name, description, group_worn'`, so the `cols` assertion mismatches and the key set lacks `is_draft`.

- [ ] **Step 3: Add `is_draft` to the `List` type**

In `src/lib/types.ts`, inside `export type List = {`, add the field after `ready_checks_enabled`:

```tsx
  // Draft (still being built) vs complete. Completeness LABEL only - never
  // locks editing, independent of is_shared. Default true for new lists
  // (DB default); existing lists were backfilled false. Exposed on PublicList
  // so the share view can render a "work in progress" banner.
  is_draft: boolean
```

- [ ] **Step 4: Add `is_draft` to the `PublicList` Pick**

In `src/lib/types.ts`, change the `PublicList` Pick (line ~90) from:

```tsx
export type PublicList = Pick<List, 'id' | 'name' | 'description' | 'group_worn'>
```

to:

```tsx
export type PublicList = Pick<List, 'id' | 'name' | 'description' | 'group_worn' | 'is_draft'>
```

- [ ] **Step 5: Add `is_draft` to the `fetchSharedList` select**

In `src/lib/queries/lists.ts`, change the select string (line ~83) from:

```tsx
    .select('id, name, description, group_worn')
```

to:

```tsx
    .select('id, name, description, group_worn, is_draft')
```

- [ ] **Step 6: Add `is_draft` to the `updateList` whitelist**

In `src/lib/queries/lists.ts`, change the `updateList` patch type (line ~119-121) from:

```tsx
  patch: Partial<
    Pick<List, 'name' | 'description' | 'is_shared' | 'group_worn' | 'ready_checks_enabled'>
  >,
```

to:

```tsx
  patch: Partial<
    Pick<List, 'name' | 'description' | 'is_shared' | 'group_worn' | 'ready_checks_enabled' | 'is_draft'>
  >,
```

- [ ] **Step 7: Set `is_draft: true` in the optimistic placeholder**

In `src/lib/optimistic-list-placeholder.ts`, add `is_draft: true` to the returned object (new lists are drafts, mirroring the DB default), after `ready_checks_enabled: false`:

```tsx
    is_shared: false,
    group_worn: false,
    ready_checks_enabled: false,
    is_draft: true,
    created_at: now,
    updated_at: now,
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run src/lib/queries/shared-projections.test.ts`
Expected: PASS - `fetchSharedList` now selects `is_draft` and the mock returns it, satisfying both assertions.

- [ ] **Step 9: Run the build**

Run: `npm run build`
Expected: PASS. (The required new `List.is_draft` field forces `optimisticListPlaceholder` to set it - which step 7 did - so the build is the guard that no other `List` constructor was missed.)

- [ ] **Step 10: Commit**

```bash
git add src/lib/types.ts src/lib/queries/lists.ts src/lib/optimistic-list-placeholder.ts src/lib/queries/shared-projections.test.ts
git commit -m "feat(lists): thread is_draft through types, query, and public projection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Shared `draftMut` in `useCurrentListActions`

**Files:**
- Modify: `src/lists/use-current-list-actions.ts:38-93`

The detail header and the settings panel both need to flip draft state, so the mutation lives in the shared hook (DRY), mirroring `renameMut`'s `makeOptimisticUpdate` shape. It writes the `['lists']` cache only - `is_draft` does not touch the `list_items.gear_item` join, so no `['list-items']` invalidation (per the CLAUDE.md cache rule).

- [ ] **Step 1: Add `draftMut` to the hook**

In `src/lists/use-current-list-actions.ts`, after the `renameMut` block (ends line 50) and before `duplicateMut`, add:

```tsx
  // Toggle a list between draft (still being built) and complete. Label
  // only - never locks editing. Optimistic on the ['lists'] cache; is_draft
  // does not affect list_items, so no ['list-items'] invalidation. Shared by
  // CurrentListHeader (the clickable "Mark list complete" pill) and
  // ListSettingsPanel (the Draft toggle).
  const draftMut = useMutation({
    mutationFn: (target: List) => updateList(target.id, { is_draft: !target.is_draft }),
    ...makeOptimisticUpdate<List, List>({
      qc,
      queryKey: queryKeys.lists(),
      id: (target) => target.id,
      apply: (item) => ({
        ...item,
        is_draft: !item.is_draft,
        updated_at: new Date().toISOString(),
      }),
    }),
  })
```

- [ ] **Step 2: Export `draftMut`**

In `src/lists/use-current-list-actions.ts`, change the return statement (line 93) from:

```tsx
  return { renameMut, duplicateMut, deleteListMut, exportCsv }
```

to:

```tsx
  return { renameMut, duplicateMut, deleteListMut, exportCsv, draftMut }
```

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: PASS. (`updateList` already accepts `is_draft` from Task 2; `makeOptimisticUpdate<List, List>` type-checks.)

- [ ] **Step 4: Commit**

```bash
git add src/lists/use-current-list-actions.ts
git commit -m "feat(lists): add shared draftMut for draft/complete toggle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `DraftBadge` pill component

**Files:**
- Create: `src/components/DraftBadge.tsx`
- Test: `src/components/DraftBadge.test.tsx`

Matches the existing `GearStatusBadge` pill grammar (`rounded-full px-1.5 py-0.5 text-xs font-medium`), in amber to read as "in progress."

- [ ] **Step 1: Write the failing test**

Create `src/components/DraftBadge.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import DraftBadge from './DraftBadge'

afterEach(() => {
  cleanup()
})

describe('DraftBadge', () => {
  it('renders the Draft label', () => {
    render(<DraftBadge />)
    expect(screen.getByText('Draft')).toBeTruthy()
  })

  it('merges a passed className', () => {
    render(<DraftBadge className="ml-2" />)
    expect(screen.getByText('Draft').className).toContain('ml-2')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/DraftBadge.test.tsx`
Expected: FAIL - module `./DraftBadge` does not exist.

- [ ] **Step 3: Write the component**

Create `src/components/DraftBadge.tsx`:

```tsx
type Props = { className?: string }

// Owner-facing "Draft" pill (indicator). Shown on every list surface where a
// draft list appears: /lists cards, the desktop list rail, and the detail
// header (where it is wrapped in a button to mark the list complete). Complete
// lists render no badge. Amber to read as "in progress"; matches the
// GearStatusBadge pill grammar.
export default function DraftBadge({ className = '' }: Props) {
  return (
    <span className={`inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 ${className}`.trim()}>
      Draft
    </span>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/DraftBadge.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/DraftBadge.tsx src/components/DraftBadge.test.tsx
git commit -m "feat(lists): add DraftBadge pill component

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `DraftBanner` share-view banner component

**Files:**
- Create: `src/lists/DraftBanner.tsx`
- Test: `src/lists/DraftBanner.test.tsx`

The exact reviewer-facing copy from the spec (decision 5b): a heading plus an "expect gaps" sentence. Never "hold off judging."

- [ ] **Step 1: Write the failing test**

Create `src/lists/DraftBanner.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import DraftBanner from './DraftBanner'

afterEach(() => {
  cleanup()
})

describe('DraftBanner', () => {
  it('renders the work-in-progress heading and the expect-gaps copy', () => {
    render(<DraftBanner />)
    expect(screen.getByText('Work in progress')).toBeTruthy()
    expect(
      screen.getByText('This list is still being built and may be incomplete.'),
    ).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lists/DraftBanner.test.tsx`
Expected: FAIL - module `./DraftBanner` does not exist.

- [ ] **Step 3: Write the component**

Create `src/lists/DraftBanner.tsx`:

```tsx
// Public share-view banner shown when the shared list is a draft (is_draft).
// Sets reviewer expectations: the list is incomplete, expect gaps. Deliberately
// does NOT say "hold off judging" - a shared draft is usually a shakedown, where
// feedback is wanted (design spec, "completeness not feedback-readiness").
export default function DraftBanner() {
  return (
    <div role="status" className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-900">Work in progress</p>
      <p className="mt-0.5 text-sm text-amber-800">
        This list is still being built and may be incomplete.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lists/DraftBanner.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lists/DraftBanner.tsx src/lists/DraftBanner.test.tsx
git commit -m "feat(lists): add DraftBanner share-view banner

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Render `DraftBanner` on the public share view

**Files:**
- Modify: `src/lists/SharePage.tsx:22` (imports) and `src/lists/SharePage.tsx:151-154` (header area)

The only logic added to `SharePage` is one conditional; the banner's own rendering is unit-tested in Task 5. `list.is_draft` is available now that `PublicList` includes it (Task 2).

- [ ] **Step 1: Import `DraftBanner`**

In `src/lists/SharePage.tsx`, add to the import block near the other local imports (after the `MarkdownContent` lazy import on line 22 is fine, place a static import among the component imports, e.g. after the `UnitSegmentedControl` import on line 15):

```tsx
import DraftBanner from './DraftBanner'
```

- [ ] **Step 2: Render the banner above the title block when draft**

In `src/lists/SharePage.tsx`, inside the `<div className="mx-auto max-w-5xl px-4 py-10">` (line 145), immediately before the header `<div className="mb-6 flex flex-wrap items-center gap-3">` (line 151), add:

```tsx
        {list.is_draft && <DraftBanner />}
```

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: PASS. (`list` is `PublicList`, which now has `is_draft`.)

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open a shared draft list at `/r/<slug>`, confirm the "Work in progress" banner appears above the title; mark the list complete (or set `is_draft=false`) and confirm the banner disappears on reload. (Share view is read-only and not optimistic, so a normal reload is sufficient.)

- [ ] **Step 5: Commit**

```bash
git add src/lists/SharePage.tsx
git commit -m "feat(lists): show work-in-progress banner on shared draft lists

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `DraftBadge` on `/lists` cards

**Files:**
- Modify: `src/lists/ListsPage.tsx` (imports + `ListRow` name area, around line 606)

Indicator only - the card pill is not clickable (the clickable control lives on the detail header, Task 9).

- [ ] **Step 1: Import `DraftBadge`**

In `src/lists/ListsPage.tsx`, add among the component imports:

```tsx
import DraftBadge from '../components/DraftBadge'
```

- [ ] **Step 2: Render the pill after the name link**

In `src/lists/ListsPage.tsx`, in `ListRow`, immediately after the closing `</Link>` of the name link (the `<Link>` ending `{list.name}</Link>` around line 606), add:

```tsx
{list.is_draft && <DraftBadge className="ml-2 shrink-0" />}
```

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open `/lists`. A newly created list shows a "Draft" pill on its card; a complete list shows none.

- [ ] **Step 5: Commit**

```bash
git add src/lists/ListsPage.tsx
git commit -m "feat(lists): show Draft pill on /lists cards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `DraftBadge` on the desktop list rail

**Files:**
- Modify: `src/lists/DesktopListsPanel.tsx` (imports + `ListPanelRow` name area, around line 610)

Same indicator-only pill in the list-switcher rail rendered inside `/lists/:id`. Without this, other draft lists in the rail would be indistinguishable (spec decision 4).

- [ ] **Step 1: Import `DraftBadge`**

In `src/lists/DesktopListsPanel.tsx`, add among the component imports:

```tsx
import DraftBadge from '../components/DraftBadge'
```

- [ ] **Step 2: Render the pill after the name link**

In `src/lists/DesktopListsPanel.tsx`, in `ListPanelRow`, immediately after the closing `</Link>` of the name link (ending `{list.name}</Link>` around line 610), add:

```tsx
{list.is_draft && <DraftBadge className="ml-2 shrink-0" />}
```

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open `/lists/:id` on a desktop-width viewport; draft lists in the left rail show the "Draft" pill, complete lists do not.

- [ ] **Step 5: Commit**

```bash
git add src/lists/DesktopListsPanel.tsx
git commit -m "feat(lists): show Draft pill in the desktop list rail

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Clickable "Mark list complete" pill in the detail header

**Files:**
- Modify: `src/lists/CurrentListHeader.tsx:1-57`

The detail-header pill is the prominent forward control (draft -> complete). When the list is complete it renders nothing; reverting to draft happens through the settings toggle (Task 10), per the spec's asymmetric matrix (decision 5).

- [ ] **Step 1: Import `DraftBadge` and pull `draftMut`**

In `src/lists/CurrentListHeader.tsx`, add the import among the existing imports:

```tsx
import DraftBadge from '../components/DraftBadge'
```

Change the destructure (line 25) from:

```tsx
  const { renameMut } = useCurrentListActions(userId)
```

to:

```tsx
  const { renameMut, draftMut } = useCurrentListActions(userId)
```

- [ ] **Step 2: Render the clickable pill after the title**

In `src/lists/CurrentListHeader.tsx`, inside the wrapping `<div className="group flex flex-1 min-w-0 items-center">`, immediately after the `<InlineTitle ... />` element (before the `{!editing && (` rename-pencil block), add:

```tsx
      {list.is_draft && (
        <button
          type="button"
          onClick={() => draftMut.mutate(list)}
          aria-label="Mark list complete"
          title="Mark list complete"
          className="ml-2 shrink-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <DraftBadge />
        </button>
      )}
```

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open a draft list's `/lists/:id`. The "Draft" pill shows next to the title; clicking it optimistically removes the pill (list is now complete). Hard-refresh to confirm the server accepted the write (per CLAUDE.md: optimistic UI can hide a server rejection). The settings toggle (Task 10) returns it to draft.

- [ ] **Step 5: Commit**

```bash
git add src/lists/CurrentListHeader.tsx
git commit -m "feat(lists): clickable Mark list complete pill in detail header

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Draft toggle in `ListSettingsPanel`

**Files:**
- Modify: `src/lists/ListSettingsPanel.tsx:63` (destructure) and `src/lists/ListSettingsPanel.tsx:105-114` (toggle rows)

The canonical bidirectional control and the only way to revert a complete list to draft. Reuses the shared `draftMut` and the existing `ToggleSwitch` + `PANEL_TOGGLE_LABEL` grammar (same shape as the Group-worn toggle).

- [ ] **Step 1: Pull `draftMut` from the actions hook**

In `src/lists/ListSettingsPanel.tsx`, change the destructure (line 63) from:

```tsx
  const { renameMut, duplicateMut, deleteListMut, exportCsv } = useCurrentListActions(userId)
```

to:

```tsx
  const { renameMut, duplicateMut, deleteListMut, exportCsv, draftMut } = useCurrentListActions(userId)
```

- [ ] **Step 2: Add the Draft toggle row above Group worn**

In `src/lists/ListSettingsPanel.tsx`, inside the top `<div className="space-y-3">` (line 105), as the first child before the Group-worn `<div className="flex items-center justify-between">` (line 106), add:

```tsx
      <div className="flex items-center justify-between">
        <span className={PANEL_TOGGLE_LABEL}>Draft</span>
        <ToggleSwitch
          checked={list.is_draft}
          onChange={() => draftMut.mutate(list)}
          ariaLabel="Draft"
        />
      </div>
```

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: PASS. (`ToggleSwitch`, `PANEL_TOGGLE_LABEL` are already imported in this file.)

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open a list's settings panel (List options popover at md+, or the mobile Options modal). The "Draft" toggle reflects the current state; toggling it off marks the list complete (pill disappears from header/cards), toggling on returns it to draft. Hard-refresh to confirm the server accepted each write.

- [ ] **Step 5: Commit**

```bash
git add src/lists/ListSettingsPanel.tsx
git commit -m "feat(lists): add Draft toggle to list settings panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: PASS, including the updated `shared-projections.test.ts`, `DraftBadge.test.tsx`, and `DraftBanner.test.tsx`.

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: PASS (`tsc -b && vite build`).

- [ ] **Step 3: Confirm `duplicate_list` was not touched and duplicates default to draft**

Run: `rg -n "is_draft" supabase/migrations/`
Expected: `is_draft` appears ONLY in `20260605000000_add_is_draft_to_lists.sql`, NOT in any `duplicate_list` definition. This confirms decision 8: a duplicate inherits the table default (`true` = draft).

Then manually: duplicate a complete list via the kebab/settings "Duplicate" action and confirm the copy shows a "Draft" pill.

- [ ] **Step 4: Grep that every owner list surface renders the pill**

Run: `rg -n "DraftBadge" src/lists/ListsPage.tsx src/lists/DesktopListsPanel.tsx src/lists/CurrentListHeader.tsx`
Expected: a hit in each of the three files (cards, rail, header) - the full owner-surface set from spec decision 4.

- [ ] **Step 5: Manual end-to-end pass**

Run: `npm run dev` and verify:
- New list -> draft pill on card, rail, and header.
- Mark complete from the header pill -> pills vanish everywhere; hard-refresh confirms persistence.
- Revert via settings toggle -> pills return.
- Share a draft (`is_shared` on, `is_draft` on) -> `/r/<slug>` shows the "Work in progress" banner; mark complete -> banner gone on reload.
- Sharing and draft state are independent (a complete list can be private; a draft can be shared).

---

## Self-Review

**Spec coverage** (each spec decision -> task):
- Decision 1 (single boolean `is_draft`): Task 1 (column), Task 2 (type).
- Decision 2 (label, never a mode): no lock implemented anywhere; `draftMut` only flips the flag (Task 3) - nothing gates editing.
- Decision 3 (default draft new / complete existing): Task 1 (add-false-then-default-true), Task 2 step 7 (`optimisticListPlaceholder: is_draft true`).
- Decision 4 (prominent on every owner surface): Task 7 (cards), Task 8 (rail), Task 9 (header); Task 11 step 4 greps all three.
- Decision 5 (asymmetric header control + matrix): Task 9 (clickable pill in draft state only), Task 10 (settings is the revert path).
- Decision 5b (banner only in draft state): Task 5 (component), Task 6 (gated render).
- Decision 6 (independent of `is_shared`): nothing couples them; Task 11 step 5 verifies.
- Decision 7 (wording: "Draft" pill, "Mark list complete", banner sentence): Task 4 (pill text), Task 9 (`aria-label`/`title` "Mark list complete"), Task 5 (banner copy).
- Decision 8 (duplicate always draft): Task 1 (RPC untouched), Task 11 step 3 (grep + manual).
- Data-flow/caching rule (`['lists']` only, no `['list-items']`): Task 3 comment + `makeOptimisticUpdate` on `queryKeys.lists()`.
- Public projection widening reviewed in the pinned test: Task 2 steps 1-2, 8.

**Placeholder scan:** none - every code step shows complete code; every command has expected output.

**Type consistency:** `is_draft: boolean` (types), `draftMut` (hook export + both consumers), `DraftBadge` / `DraftBanner` (default exports, imported by exact path) are used consistently across tasks. `makeOptimisticUpdate<List, List>` matches the helper signature confirmed in `optimistic.ts`. `updateList(..., { is_draft })` matches the whitelist widened in Task 2.
