# grampacker — Phase 18 fixes (2026-05-06)

**Source:** `REVIEW-quality.md` — T-cluster (T-1 through T-9). The final cluster in `REVIEW-quality.md`. Closes the campaign's quality phase per the user's stated ordering (quality → security → performance).
**Scope:** install the jsdom + `@testing-library/react` toolchain; backfill pure-function tests for high-value untested helpers (T-3, T-4, T-6, T-7, T-9); roll three deferred-from-prior-phases test surfaces into the new tests (M-1 mutation error logging, M-2 updated_at bump in apply, M-10 consumable+worn warn); fix one silent-no-op integration test (T-5); add jsdom-required tests for the highest-value UI-side surfaces (T-8 `usePortalPopover`, M-6 Modal backdrop). **Ten commits.**
**Why bundle this together:** the install (C1) is a one-time tooling change that gates every later commit's jsdom-using test. After that, each commit covers one cohesive area (one helper, one cluster, one fix) and stays small. The summary (C10) closes `REVIEW-quality.md` entirely.

> **Note on file paths:** all paths are repo-relative.
> **Phase 17 baseline:** main bundle = **187.84 KB gzip**. Bundle delta expected: **flat** — Phase 18 adds dev-time test code only; production bundle is unchanged.
> **Test count baseline:** 45 passing | 4 skipped (49 total). Expected end state for normal local runs: **~75-90 passing | 4 skipped** (45 existing + 30-45 new; the 4 skipped count is the bulk-reorder integration `describe.skip` block when `VITE_SUPABASE_URL` etc. aren't configured — that env-gated skip is unchanged by Phase 18). What T-5 *does* eliminate is the per-test silent no-op (`if (!row) return`) inside the integration describe when it *is* running; that path becomes a fail-loud assertion instead. Wording matters: silent no-op skips are removed; env-gated integration describe skips remain when env vars are absent.
> **Risk profile:** low. Test code is additive — no production code changes except the T-5 fail-loud guard (a one-line `expect(row).toBeTruthy()` change in an existing skipped-by-default integration test) and possibly a vite.config.ts test block. The jsdom + testing-library install is the largest devDep change since vitest itself.

---

## How to execute this file

Ten commits. C1 must come first (gates jsdom tests). C2-C9 are independent and could in principle land in any order after C1; the sequence below is by audit-cluster + cost order. C10 is the trailing summary.

C1 → C2 → C3 → C4 → C5 → C6 → C7 → C8 → C9 → C10.

After every commit:

```bash
npm run build && npm run lint && npm test -- --run
```

The lint and build gates verify that test files don't import production code in ways that break tree-shaking or types. The full test suite runs every commit because each commit's tests should pass alongside every prior commit's tests — no per-commit skip lists.

---

## Verification: audit-vs-current-code

| Audit ref | Audit said | Current code | Verdict |
|---|---|---|---|
| T-1 | `WeightTable` has no test | `src/lists/WeightTable.test.ts` exists with 3 tests covering orphan-category routing (B-1 path), `quantity * weight_grams` math, and empty-items returns null | **audit-stale (already covered)** — close in C10 summary |
| T-2 | grouping fns untested | `src/lib/grouping.test.ts` has 25 tests covering `groupListItemsByCategory`, `groupGearItemsByCategory`, generic `groupByCategory` including the "deliberate divergence" around empty categories (lines 200, 210, 221) | **audit-stale (already covered)** — close in C10 summary |
| T-3 | `assignSortOrderSlots` untested | confirmed at `src/lib/grouping.ts:174` (`export function assignSortOrderSlots<T extends { id: string; sort_order: number }>(...)`); not in `grouping.test.ts` | exact gap; **C2** |
| T-4 | `parseDnDId` untested | confirmed at `src/lib/dnd-ids.ts:54`; no test file exists for `dnd-ids.ts` | exact gap; **C2** |
| T-5 | bulk-reorder integration test silently no-ops | confirmed at `src/lib/queries.bulk-reorder.test.ts:51, 88, 124, 160` — every `it` does `if (!row) return` after a `.maybeSingle()` lookup | exact gap; **C7** |
| T-6 | CSV parse edge paths uncovered | `src/lib/csv.test.ts` covers happy paths + the 99,999,999.99 cost cap (line 340). Missing: BOM (U+FEFF prefix), quoted field with literal `\r\n`, header-only CSV with no data rows | partial gap (3 of 4 items still uncovered); **C3** |
| T-7 | `optimistic.ts` untested | `src/lib/queries/optimistic.test.ts` covers `makeOptimisticBulkDelete` and `makeOptimisticBulkMove` (8 tests). Missing: `makeOptimisticInsert`, `makeOptimisticUpdate`, `makeOptimisticDelete`, `makeOptimisticReorder` — every helper used by the per-page mutations | partial gap (4 of 7 helpers still untested); **C4** |
| T-8 | `usePortalPopover` untested | confirmed at `src/lib/use-portal-popover.ts`; no test file. Five sites depend (HamburgerMenu, PrivacyButton, RowKebab × 3 per CLAUDE.md) | exact gap; **C8** (first jsdom test) |
| T-9 | `resolveOrCreateGearForImport` dedup untested | confirmed at `src/lib/queries/import-helpers.ts:45` (`export async function resolveOrCreateGearForImport(...)`); no test file for `import-helpers.ts` | exact gap; **C5** |

Plus deferred-from-prior-phases test surfaces folded into the relevant commits:

| Phase | Item | Test surface | Where it lands |
|---|---|---|---|
| 14 | M-2 (updated_at bump in apply) | apply-function pass-through through `makeOptimisticUpdate` | folded into **C4** (T-7 makeOptimisticUpdate test asserts updated_at handling) |
| 15 | M-1 (production mutation error logging) | `MutationCache.onError` payload shape | folded into **C4** (separate `describe` block in optimistic.test.ts since it's QueryClient infrastructure) |
| 15 | M-10 (consumable+worn warn) | `computeWeightBreakdown` runtime guard | extends existing `WeightTable.test.ts` in **C6** |
| 16 | M-4 (`randomTempId` polyfill) | helper happy path + fallback path + throw branch | folded into **C2** (small pure-function cluster) |
| 16 | M-6 (Modal backdrop click) | dialog click event simulation | **C9** (jsdom) |

Explicitly deferred (low value vs. setup cost):

- **M-3** (ListSelector force-close on viewport change). useLayoutEffect viewport-change simulation is a heavy harness (window.matchMedia mock, layout flush) for a UX-only behavior whose visible effect is "drawer closes on rotate." Manual smoke covers it.
- **M-5** (FileReader error/abort handlers). FileReader is in jsdom but mocking realistic error/abort flows requires either spying on the constructor or wrapping the helper in a seam — neither is cheap. The error path is rare enough that manual smoke is sufficient.
- **M-7** (RootRedirect reduce). The reducer is inline inside the component and isn't extractable as a pure function without a deliberate refactor. Manual smoke verified the algorithm change in Phase 14.
- **M-8** (DnD lookup Map). The Map's correctness is verified by the DnD tests for dnd-kit itself; a regression here would manifest as broken drag rather than silent miscalculation.

---

## Commit 1 — chore: install jsdom + testing-library + setup files

**Origin:** prerequisite tooling change. Gates every later commit that needs DOM APIs.

**Why:**

Five existing tests are pure-function (vitest-on-node). Phase 18 adds tests that need DOM APIs (`document`, event simulation, `<dialog>.showModal()`, `useEffect` runs). Standard vitest setup is jsdom + `@testing-library/react` for rendering + `@testing-library/jest-dom` for assertion matchers + `@testing-library/user-event` for realistic interactions.

**Files:**

- Modify: `package.json` (devDependencies + lockfile sync).
- Modify: `vite.config.ts` (add `test` block with `setupFiles`).
- Create: `vitest.setup.ts` (jest-dom matcher import).

**What to do:**

### Step 1 — install dev dependencies

```bash
npm install -D jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Versions resolve at install time; pin nothing manually. The peer-dep range for `@testing-library/react` should pick up React 19 cleanly (the project's React major is `^19.2.5`).

### Step 2 — vitest setup file

Create `vitest.setup.ts` at the repo root:

```ts
// Loaded by every vitest test (configured via vite.config.ts test.setupFiles).
// Brings in @testing-library/jest-dom matchers (toBeInTheDocument,
// toHaveTextContent, etc.) so the existing pure-function tests don't have
// to import them per-file and the new jsdom-using tests can use them
// without ceremony.
import '@testing-library/jest-dom/vitest'
```

### Step 3 — vite.config.ts test block

Update the import line and add a `test` block:

```ts
// Before:
import { defineConfig } from 'vite'

// After:
import { defineConfig } from 'vitest/config'
```

`vitest/config`'s `defineConfig` is type-compatible with `vite`'s and adds the `test` field. Then add inside the config object (anywhere alongside `plugins`):

```ts
test: {
  // Default environment is `node`. Per-file `// @vitest-environment jsdom`
  // directives opt individual test files into jsdom. This keeps the
  // pure-function suite (csv, grouping, optimistic, queries-bulk-reorder,
  // WeightTable) running on node — fast and minimal — while only the
  // tests that actually touch the DOM pay the jsdom load tax.
  setupFiles: ['./vitest.setup.ts'],
},
```

### Step 4 — verify

```bash
npm run build && npm run lint && npm test -- --run
```

Expected:
- Build still passes (vitest/config replacing vite's defineConfig is a drop-in).
- Lint passes.
- All 45 existing tests pass on node (they don't have jsdom directives, so the setup file loads matchers but the environment defaults to node — matchers come from `@testing-library/jest-dom/vitest` which works in both environments).

**Acceptance criteria:** four new devDeps in `package.json`, lockfile updated, `vitest.setup.ts` created at repo root, vite.config.ts has the test block + `vitest/config` import. No production code changes.

**Suggested commit:** `chore(test): install jsdom + testing-library and add vitest setup`

---

## Commit 2 — test: pure helpers (T-3 + T-4 + M-4)

**Origin:** `REVIEW-quality.md` T-3 (Tier T), T-4 (Tier T); Phase 16 M-4 deferred.

**Why:**

Three small pure functions, all currently untested. Each test file is short. Bundling them in one commit is cheaper than three commits and keeps the per-commit narrative coherent ("close the small-pure-helper test gap").

**Files:**

- Create: `src/lib/grouping.assign.test.ts` — extends grouping coverage with `assignSortOrderSlots` (kept separate from `grouping.test.ts` since the two have distinct concerns; could equally be added to `grouping.test.ts` — adopt whichever convention the executor prefers, but don't bloat `grouping.test.ts` past 500 lines).
- Create: `src/lib/dnd-ids.test.ts`.
- Create: `src/lib/random-temp-id.test.ts`.

**What to do:**

### `src/lib/grouping.assign.test.ts` — T-3

Read `src/lib/grouping.ts:174-181` for the exact signature and behavior. The function is **slot redistribution**, not contiguous renumbering:

```ts
export function assignSortOrderSlots<T extends { id: string; sort_order: number }>(
  reorderedItems: T[],
): { id: string; sort_order: number }[]
```

What it does:
1. Collects the existing `sort_order` values from `reorderedItems` and sorts them ascending → `slots`.
2. Pairs each input item, in input order, with the slot at the same index.

So if input is `[{id:'a', sort_order:30}, {id:'b', sort_order:10}, {id:'c', sort_order:20}]`:
- `slots` = `[10, 20, 30]`
- output = `[{id:'a', sort_order:10}, {id:'b', sort_order:20}, {id:'c', sort_order:30}]`

The first input item gets the smallest existing slot value, the second gets the next, etc. The point is to redistribute existing sort_order values among a re-ordered subset *without renumbering items that weren't part of the drag*. Tests must reflect this contract — not "0..N-1 contiguous renumbering" (which is what an earlier draft of this spec said and which is wrong).

Five tests:

1. **Reversed input redistributes existing slots ascending** — input `[{a,30}, {b,10}, {c,20}]` → output `[{a,10}, {b,20}, {c,30}]`. Sorted slots `[10, 20, 30]` get assigned to input items in input order.
2. **Identity (already ascending)** — input `[{a,10}, {b,20}, {c,30}]` → output `[{a,10}, {b,20}, {c,30}]`. id↔sort_order pairing unchanged when input order already matches sorted slots.
3. **Non-contiguous slots preserved** — input `[{a,1000}, {b,500}]` → output `[{a,500}, {b,1000}]`. Slot values `[500, 1000]` (not `[0, 1]`) are what gets assigned — the function doesn't renumber, it redistributes.
4. **Empty input** — `assignSortOrderSlots([])` returns `[]`.
5. **Single item** — input `[{a, 42}]` → output `[{a, 42}]` (the lone slot is assigned to the lone item; no change).

Optional sixth test if extra safety is desired: assert the *return shape* drops every field except `id` and `sort_order` (extra fields like `name` on the input shouldn't appear on the output, since the function returns `{id, sort_order}[]` not `T[]`).

### `src/lib/dnd-ids.test.ts` — T-4

Read `src/lib/dnd-ids.ts` for the full picture. The real public contract:

- `DND_KINDS` is **deliberately not exported** (`src/lib/dnd-ids.ts:30-32`). Tests cannot import the runtime tuple. Enumerate the public contract through valid `makeDnDId` calls only — `makeDnDId(kind, id)` accepts `kind: DnDIdKind`, so the type system pins valid kinds at the call site.
- The four current valid kinds are `'category'`, `'gear-item'`, `'item'`, `'list-card'` (per `dnd-ids.ts:32`). Earlier drafts of this spec listed `list-item` and `list` — both wrong.
- `isDnDIdKind` is module-private (no `export`), so tests can't import it directly. Coverage of the typeguard happens implicitly through `parseDnDId`'s unknown-kind branch.

Five tests minimum:

1. **Valid each-kind round-trip** — for each of the four valid kinds, `parseDnDId(makeDnDId(kind, 'abc-uuid-123'))` returns `{ kind, id: 'abc-uuid-123' }`. Use `makeDnDId` to construct the input so test fixtures stay typed and any kind rename re-routes through the type system instead of silently rotting a string fixture. Four assertions, one per kind.
2. **Empty id** — `parseDnDId('category:')` returns `null` (the `id.length === 0` guard at line 60).
3. **No colon delimiter** — `parseDnDId('justanid')` returns `null` (the `idx < 0` guard at line 56).
4. **Unknown kind** — `parseDnDId('badkind:abc-def-ghi')` returns `null` (the `isDnDIdKind` guard at line 59 fails for an unrecognized prefix). This implicitly covers the typeguard's negative case.
5. **Multiple colons in id** — `parseDnDId('category:abc:def')` returns `{ kind: 'category', id: 'abc:def' }` because `parseDnDId` uses `indexOf(':')` (first occurrence) not `split(':')`. The comment at line 23-25 says uuids never contain colons today, so this is a contract test, not a real-world case — but locking it now prevents a future "let's switch to split" refactor from breaking the comment's promise silently.

### `src/lib/random-temp-id.test.ts` — M-4

Three branches in the helper, three test groups:

1. **Native path** — when `crypto.randomUUID` is available, return its value. Test by stubbing `crypto.randomUUID` to return a fixed string and asserting the helper returns it. Use `vi.stubGlobal('crypto', { ...crypto, randomUUID: () => 'fixed-uuid' })` and `vi.unstubAllGlobals()` in `afterEach`.
2. **Fallback path** — when `crypto.randomUUID` is undefined but `crypto.getRandomValues` exists, return a uuid v4-shaped string. Stub `randomUUID` to undefined and `getRandomValues` to fill bytes deterministically; assert the returned string matches `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`.
3. **Throw branch** — when both APIs are missing, the helper throws with the diagnosable message. Stub both to undefined; assert `expect(randomTempId).toThrow(/crypto.getRandomValues is unavailable/)`.

The helper has explicit branching for these three states; one test per branch is the minimum bar.

**Verification:**

- `npm run build && npm run lint && npm test -- --run` — passes; new tests counted.
- Per-test execution: ~milliseconds (pure functions; no jsdom overhead).

**Acceptance criteria:** three new test files; minimum 12 new tests (3 + 5 + 3 + edges); no production code changes.

**Suggested commit:** `test(lib): cover assignSortOrderSlots, parseDnDId, randomTempId (T-3, T-4, M-4)`

---

## Commit 3 — test: CSV edge cases (T-6)

**Origin:** `REVIEW-quality.md` T-6 (Tier T).

**Why:**

`csv.test.ts` covers happy paths and the cost-cap regression. Three edge cases the audit calls out are still uncovered:

1. **BOM** (U+FEFF prefix) — Windows-saved CSVs from Excel start with `\uFEFF`. The current parser's behavior under BOM is unverified; if the BOM ends up as part of the first header (`\uFEFFItem Name`), every column-resolution `keys.find` fails and the import errors out as "Missing required column."
2. **Quoted field with literal `\r\n`** — a description like `"line one\r\nline two"` should parse as a single cell; today's `splitLines` is supposed to handle it (it tracks `inQuote`), but no test verifies the round-trip.
3. **Header-only CSV** — the parser should return `[]` (no data rows). Already covered defensively at `parseCsv:55` (`if (!headerLine || dataLines.length === 0) return []`); test locks the contract.

Item 4 from the audit (cost above numeric(10,2) cap) is **already covered** at `csv.test.ts:340` — close as audit-stale within C10.

**Files:**

- Modify: `src/lib/csv.test.ts` — add tests in the appropriate `describe` block (or create a new `describe('csv parser edge cases', () => { ... })` block).

**What to do:**

Add three tests:

1. **BOM stripping** — feed `'\uFEFFItem Name,weight\nFoo,100'` to `parseGearCsv` (or `parseListCsv`). Assert the parsed row's `name` is `'Foo'` and `weight_grams` is `100`. The expected behavior here depends on whether the parser strips BOM (preferred) or whether it currently fails. **Investigate at execution time:** if the parser fails, this test surfaces a real bug (a small fix to `parseCsv` to strip BOM from `headerLine` before tokenizing) and the test commits the bug + fix together. If the parser already handles BOM, the test just locks the contract.
2. **Embedded CRLF in quoted field** — feed a CSV with a description column containing `"line one\r\nline two"` to `parseCsv` directly (or to `parseGearCsv`). Assert the parsed value is `'line one\r\nline two'` and exactly one row was produced (not two).
3. **Header-only CSV** — feed `'Item Name,weight\n'` (or trailing newline variants) to `parseGearCsv`. Assert the return is the audit error string (`'File appears empty or has no data rows.'`), not `[]` — `parseGearCsv` returns the error string when its internal `parseCsv` returns `[]`.

**Verification:**

- `npm test -- --run src/lib/csv.test.ts` — targeted run.
- Full suite still passes.

**Acceptance criteria:** three new tests in `csv.test.ts`; if the BOM test surfaces a real parser bug, the fix is in this commit (one-line strip on `headerLine`). No new files.

**Suggested commit:** `test(csv): cover BOM, embedded CRLF, header-only edge cases (T-6)`

---

## Commit 4 — test: optimistic infra (T-7 + M-2 + M-1)

**Origin:** `REVIEW-quality.md` T-7 (Tier T); Phase 14 M-2 deferred; Phase 15 M-1 deferred.

**Why:**

`makeOptimisticBulkDelete` and `makeOptimisticBulkMove` are tested. The four most-used helpers (`Insert`, `Update`, `Delete`, `Reorder`) are untested despite being load-bearing for every page's add/edit/delete/dnd flow. Same `QueryClient` test harness pattern as the existing two; cost is mostly typing.

M-2 (updated_at bump in optimistic apply) becomes a natural assertion inside the `makeOptimisticUpdate` test. M-1 (MutationCache.onError logging) is QueryClient infrastructure — fits the same file but a separate `describe` block.

**Files:**

- Modify: `src/lib/queries/optimistic.test.ts` — extend with four new `describe` blocks (Insert / Update / Delete / Reorder), one for MutationCache observability.

**What to do:**

For each of the four helpers, follow the existing test-harness pattern (see lines 14-77 for BulkDelete; same shape).

### `makeOptimisticInsert`

Three tests minimum:
- **Happy path** — given an empty cache, calling the mutation appends the optimistic row to the cache; on settle, the server row replaces.
- **Rollback on error** — the mutation rejects; cache returns to pre-mutation state.
- **Concurrent inserts** — two mutations queued back-to-back; both optimistic rows present until first resolves.

### `makeOptimisticUpdate` — folds in M-2

Three tests minimum:
- **Happy path** — `apply` callback runs, cache row is updated; on settle, server row replaces.
- **Rollback on error** — cache returns to pre-mutation state.
- **Apply preserves caller-supplied fields** (M-2 assertion) — pass an `apply` that returns `{ ...item, ...patch, updated_at: 'sentinel-2026-05-06' }`; assert the cached row reflects the sentinel after optimistic apply (proves the apply contract honors caller-supplied updated_at). The actual production `apply` lambdas at the three Phase 14 sites use `new Date().toISOString()`, but at the unit-test level we test the contract — that whatever the caller's `apply` returns is what lands in the cache.

### `makeOptimisticDelete`

Two tests minimum:
- **Happy path** — id removed from cache.
- **Rollback on error** — cache returns to pre-mutation state.

### `makeOptimisticReorder`

Two tests minimum:
- **Happy path** — given `[{id, sort_order}]` patches, cache rows have new sort_orders applied; cache is re-sorted.
- **Rollback on error** — cache returns to pre-mutation state.

### `MutationCache.onError` (M-1)

Separate `describe('MutationCache observability', () => { ... })` block.

**Mandatory extraction first.** The handler lives inline at `src/App.tsx:35-47` inside the module-level `queryClient` initializer. Copying it into the test would only test the copy — a future App.tsx tweak (rename a payload key, drop the `code` typeguard, etc.) would silently diverge.

The extraction (in this commit, not a separate refactor):
- Create `src/lib/mutation-error-handler.ts` exporting a single `mutationErrorHandler` function with the `MutationCache.onError` signature.
- Update `src/App.tsx`: replace the inline arrow with `mutationCache: new MutationCache({ onError: mutationErrorHandler })` and add `import { mutationErrorHandler } from './lib/mutation-error-handler'` at the top.

Then the test imports the same named handler:

```ts
import { mutationErrorHandler } from '../mutation-error-handler'
// or whatever the relative path is from optimistic.test.ts; if the
// handler ends up at src/lib/mutation-error-handler.ts, the test is at
// src/lib/queries/optimistic.test.ts, so the import is '../mutation-error-handler'.
```

Test plan:
- Spy on `console.warn` (`vi.spyOn(console, 'warn').mockImplementation(() => {})`).
- Build a fake `Mutation`-like object with `options.mutationKey: ['gear-items', 'create']`.
- Call `mutationErrorHandler(new Error('permission denied'), undefined, undefined, fakeMutation)`.
- Assert `console.warn` was called with `'[gear-items/create] failed'` and the payload `{ error: 'permission denied', code: undefined, mutationKey: ['gear-items', 'create'] }`.
- Second test: pass a Postgres-shaped error `{ message: 'permission denied', code: '42501' }` (a plain object with `code`, NOT an `Error` subclass — that's what Supabase returns). Assert the payload's `code: '42501'` is preserved by the typeguard branch.
- Third test: pass a non-Error, non-object value (a string). Assert `error: <stringified>` and `code: undefined`.
- Fourth test: pass a mutation with no `mutationKey` set. Assert the prefix is `[mutation] failed` (the `?? 'mutation'` fallback fires).

Restore the spy in `afterEach`.

**Verification:**

- `npm test -- --run src/lib/queries/optimistic.test.ts` — targeted run.
- Full suite still passes.

**Acceptance criteria:** ~12-15 new tests covering 4 helpers + MutationCache. The existing 8 tests stay untouched. New file `src/lib/mutation-error-handler.ts` exporting `mutationErrorHandler`, plus `src/App.tsx` updated to import that named export instead of using an inline arrow — both the production callsite and the test consume the same function.

**Suggested commit:** `test(optimistic): cover insert/update/delete/reorder + MutationCache (T-7, M-1, M-2)`

---

## Commit 5 — test: resolveOrCreateGearForImport dedup (T-9)

**Origin:** `REVIEW-quality.md` T-9 (Tier T).

**Why:**

CSV import uses `resolveOrCreateGearForImport` to dedupe rows against existing gear by `(category_id, name.toLowerCase(), weight_grams)`. The actual contract — confirmed by reading `src/lib/queries/import-helpers.ts:36-40` — is **existing-library dedup only; within-CSV duplicates create separate gear rows**:

> Match against existing library only — newly-created gear within this import is NOT considered a match candidate for later rows (within-CSV duplicates create separate gear items, matching user typing intent).

An earlier draft of this spec stated the inverse contract (within-CSV dedup → one insert). That was wrong; the implementation only checks `gearIdByExistingKey` (built from `existingGearItems`), never the in-progress `newGearRows`. The corrected test plan below tests the actual contract.

**Files:**

- Create: `src/lib/queries/import-helpers.test.ts`.

**What to do:**

The function does I/O at `import-helpers.ts:120-125`:

```ts
const { data: created, error } = await supabase
  .from('gear_items')
  .insert(newGearRows)
  .select('id')
```

Calling it without intervention would hit the real Supabase project. **Mandatory:** mock `'../supabase'` at the top of the test file using `vi.mock`, and assert against the recorded inserts. Don't let this hit real Supabase.

**Important: vi.mock is hoisted.** Vitest hoists every `vi.mock(...)` call to the top of the file before any imports execute. A factory that closes over normal top-level `let`/`const` variables sees them as uninitialized (TDZ) at hoist time and either throws or returns garbage. The fix is `vi.hoisted` — it runs the initializer at hoist time and returns a stable object that the mock factory and the test body both read from.

```ts
// src/lib/queries/import-helpers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted: declared and initialized at the same hoist tier as vi.mock,
// so the mock factory below can close over mockState safely. Plain
// top-level `const insertCalls: ... = []` would be hit by TDZ at hoist
// time and the mock would throw "Cannot access 'insertCalls' before
// initialization."
const mockState = vi.hoisted(() => ({
  insertCalls: [] as { table: string; rows: unknown }[],
  nextInsertReturn: {
    data: [] as { id: string }[],
    error: null as Error | null,
  },
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => ({
      insert: (rows: unknown) => {
        mockState.insertCalls.push({ table, rows })
        return {
          select: () => Promise.resolve(mockState.nextInsertReturn),
        }
      },
    }),
  },
}))

import { resolveOrCreateGearForImport } from './import-helpers'
import type { GearItem } from '../types'

beforeEach(() => {
  mockState.insertCalls.length = 0
  mockState.nextInsertReturn = { data: [], error: null }
})
```

For tests where new rows are inserted, mutate `mockState.nextInsertReturn` ahead of the call:

```ts
mockState.nextInsertReturn = {
  data: [{ id: 'new-gear-1' }, { id: 'new-gear-2' }],
  error: null,
}
```

Then assert against `mockState.insertCalls[0].rows` (the `newGearRows` payload sent to Supabase) and against the function's returned `gearIdByRow`.

Tests (six minimum, by branch):

1. **Existing exact match → no insert** — `existingGearItems` has `{id: 'g-1', name: 'Headlamp', weight_grams: 50, category_id: 'cat-electronics', ...}`; import row has the same triple. Assert `gearIdByRow` is `['g-1']`, `matchedCount` is `1`, `newCount` is `0`, and `insertCalls.length` is `0` (Supabase never called for an empty newGearRows).
2. **Case-insensitive name match** — `existingGearItems` has `name: 'Headlamp'`; import row has `name: 'headlamp'`. Same assertion as (1) — the `gearKey` helper lowercases (line 14: `name.trim().toLowerCase()`).
3. **Whitespace-trimmed name match** — `existingGearItems` has `name: 'Headlamp'`; import row has `name: '  Headlamp  '`. Same return as (1) (the helper trims; line 14: `name.trim()`).
4. **Within-CSV duplicates create SEPARATE gear rows** *(the contract)* — `existingGearItems` is empty; import has two rows with the same `(category, name, weight_grams)`. Set `nextInsertReturn = { data: [{id: 'new-1'}, {id: 'new-2'}], error: null }`. Assert `gearIdByRow` is `['new-1', 'new-2']`, `newCount` is `2`, `matchedCount` is `0`, and `insertCalls[0].rows.length` is `2` (Supabase received both rows). This is the core behavior the audit calls subtle: a user typing the same gear twice into the same CSV gets two separate gear items, matching their typing intent.
5. **No match → scheduled insert** — `existingGearItems` is empty, import has one unique row. Set `nextInsertReturn = { data: [{id: 'new-1'}], error: null }`. Assert `gearIdByRow` is `['new-1']`, `newCount` is `1`, `insertCalls[0].rows[0]` has the expected shape (user_id, name, weight_grams, etc.).
6. **Empty-name row yields null** — import row has `name: ''`. Assert `gearIdByRow` for that row is `null`, no insert is queued for it, and `matchedCount` doesn't change for it.

Edge cases to consider as judged: weight differing by 1 gram (no match — strict equality on weight_grams); category mismatch (no match); null category_id on both sides (matches when the rest does — `gearKey` uses `categoryId ?? ''`).

**Why mocking is the right tool here vs. extracting a pure planner:**

The function's logic is `90% pure planner + 10% Supabase round-trip`. Extracting the pure half (compute `newGearRows` + `gearIdByRow` + `queueIndices`) would let tests skip the mock, but it'd require either splitting the function into two exports (planner + persister) or threading the persister as a parameter. Both are real refactors that change the production call sites in `gear.ts` and `list-items.ts`. Mocking keeps the test surface honest (it tests the function as production sees it, with one Supabase boundary), and `vi.mock` is the codebase's existing convention for this pattern.

If a future commit wants the planner extraction (e.g., to test more edge cases without the mock harness), that's a separable refactor — not in Phase 18's scope.

**Verification:**

- `npm test -- --run src/lib/queries/import-helpers.test.ts` — targeted run.
- Full suite still passes.

**Acceptance criteria:** one new test file with at least six tests covering the dedup matrix; `vi.mock('../supabase', ...)` at module scope; zero real Supabase calls.

**Suggested commit:** `test(import): cover resolveOrCreateGearForImport dedup logic (T-9)`

---

## Commit 6 — test: WeightTable consumable+worn warn (M-10)

**Origin:** Phase 15 M-10 deferred.

**Why:**

`computeWeightBreakdown` runtime-warns when an impossible `is_consumable && is_worn` row appears (DB CHECK makes the state unreachable today; the warn is belt-and-suspenders for future migration regressions). One test fixture passes both flags true; assertion that `console.warn` fires with the documented payload shape.

**Files:**

- Modify: `src/lists/WeightTable.test.ts` — extend with one new test.

**What to do:**

Add to the existing `describe('computeWeightBreakdown', ...)`:

```ts
it('warns and buckets as consumable when an impossible is_consumable+is_worn row appears', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const items: ListItemWithGear[] = [
    {
      id: 'li-impossible',
      list_id: 'l-1',
      user_id: 'u',
      gear_item_id: 'g-1',
      gear_item: { id: 'g-1', name: 'Trail mix', weight_grams: 100, category_id: 'cat-food', description: null },
      quantity: 1,
      is_worn: true,
      is_consumable: true,
      is_packed: false,
      sort_order: 0,
    },
  ]
  const categories: Category[] = [/* one category 'cat-food' */]

  const result = computeWeightBreakdown(items, categories)

  expect(warnSpy).toHaveBeenCalledWith(
    '[weight-table] list_item has both is_consumable and is_worn; bucketing as consumable',
    { listItemId: 'li-impossible', gearItemId: 'g-1' },
  )
  expect(result.consumableGrams).toBe(100)
  expect(result.wornGrams).toBe(0)

  warnSpy.mockRestore()
})
```

Verify the exact warn message shape against the production code at `src/lists/WeightTable.tsx:49` — match the string and payload exactly.

**Verification:**

- `npm test -- --run src/lists/WeightTable.test.ts` — targeted run.
- Full suite still passes.

**Acceptance criteria:** one new test in `WeightTable.test.ts`; existing 3 tests stay passing.

**Suggested commit:** `test(weight-table): cover consumable+worn impossible-state warning (M-10)`

---

## Commit 7 — fix: bulk-reorder fail-loud when env is set (T-5)

**Origin:** `REVIEW-quality.md` T-5 (Tier T).

**Why:**

`src/lib/queries.bulk-reorder.test.ts:51, 88, 124, 160` all do:

```ts
if (!row) return // No <table> in the test account.
```

When `VITE_SUPABASE_URL` etc. are configured (`canRun === true`) but the test account is missing data for one table, that test silently passes as a no-op. This is exactly the failure mode CLAUDE.md describes ("a passing test on table A tells you nothing about table B"). The bulk-reorder helper was historically broken for categories for weeks because its existing test exercised an unused gear_items path and the categories path's row was missing — silent no-op masked the bug.

The fix is a fail-loud assertion: when the environment is configured to run integration tests, missing data is a *seed bug*, not a test-skip condition.

**Files:**

- Modify: `src/lib/queries.bulk-reorder.test.ts` — replace four `if (!row) return` with a fail-loud assertion.

**What to do:**

Replace each:

```ts
if (!row) return // No categories in the test account.
```

with:

```ts
expect(row).toBeTruthy()
```

…and add a `beforeAll` (or a scope-level comment) documenting the seed expectation: "Tests require the test account to have at least one row in each of `categories`, `gear_items`, `lists`, and `list_items`."

Better still (and recommended): a single `beforeAll` that asserts each table has at least one row and aborts the whole `describe` if not. That way the failure mode is "explicit seed assertion failed" rather than "individual test failed at a confusing place."

```ts
beforeAll(async () => {
  const { error } = await supabase.auth.signInWithPassword({
    email: email!,
    password: password!,
  })
  if (error) throw error

  // Seed precondition: every table this describe touches must have at
  // least one row in the test account. Without this, a per-test
  // .maybeSingle() returning null silently turned a missing-seed into
  // a passing no-op, which is exactly the failure mode CLAUDE.md flags
  // ("a passing test on table A tells you nothing about table B").
  for (const table of ['categories', 'gear_items', 'lists', 'list_items'] as const) {
    const { count, error: countErr } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
    if (countErr) throw countErr
    expect(count ?? 0, `Test account missing seed for ${table}`).toBeGreaterThanOrEqual(1)
  }
})
```

Then the per-test `if (!row) return` becomes `expect(row).toBeTruthy()` — same shape, just fail-loud now.

**Verification:**

- `npm test -- --run src/lib/queries.bulk-reorder.test.ts` — when env vars are configured, runs and either passes (seed exists) or fails with a clear "missing seed for X" message. When env vars aren't configured, the whole describe stays skipped per the existing `canRun ? describe : describe.skip` pattern.
- Full suite still passes.

**Acceptance criteria:** four `if (!row) return` lines replaced; one `beforeAll` seed assertion added. The per-test no-op silent pass is gone. The describe.skip behavior when env vars are absent is preserved.

**Suggested commit:** `test(bulk-reorder): fail loud on missing seed instead of silent no-op (T-5)`

---

## Commit 8 — test: usePortalPopover (T-8)

**Origin:** `REVIEW-quality.md` T-8 (Tier T). First jsdom-using test.

**Why:**

Five sites depend on the hook (HamburgerMenu, PrivacyButton, RowKebab × 3 per CLAUDE.md). It centralizes mousedown/scroll/resize/escape dismiss listeners. A regression here breaks every kebab and menu in the app at once.

**Files:**

- Create: `src/lib/use-portal-popover.test.ts` (or `.test.tsx` if rendering JSX).

**What to do:**

Read `src/lib/use-portal-popover.ts` for the hook's signature. The hook wires four listeners: `mousedown`, `scroll`, `resize`, `keydown` (Escape). Each except `mousedown` is gated by an opt-in flag (`closeOnScroll`, `closeOnResize`, `closeOnEscape`), all defaulting to `true`. Tests must cover all four listeners *and* the disabled-flag opt-outs for the three optional ones.

Test set (nine tests; covers every listener × every flag):

1. **Outside-mousedown closes** — open the popover, dispatch a `mousedown` on `document.body`, assert the close callback fired.
2. **Inside-trigger mousedown doesn't close** — dispatch `mousedown` on the trigger element, assert close didn't fire.
3. **Inside-content mousedown doesn't close** — dispatch `mousedown` on the content element, assert close didn't fire.
4. **Escape closes when `closeOnEscape: true`** (default) — dispatch `keydown` with `key: 'Escape'`, assert close fired.
5. **Escape doesn't close when `closeOnEscape: false`** — same, assert close didn't fire (and the Escape listener was never attached).
6. **Scroll closes when `closeOnScroll: true`** (default) — dispatch `scroll` on `window`, assert close fired. Note the listener is attached with `capture: true` (`use-portal-popover.ts:71`); the test should dispatch on `window` to match.
7. **Scroll doesn't close when `closeOnScroll: false`** — dispatch `scroll` on `window`, assert close didn't fire.
8. **Resize closes when `closeOnResize: true`** (default) — dispatch `resize` on `window`, assert close fired.
9. **Resize doesn't close when `closeOnResize: false`** — dispatch `resize` on `window`, assert close didn't fire.

That's nine tests. Optional tenth: **all three opt-outs together** — `closeOnScroll: false, closeOnResize: false, closeOnEscape: false` — only `mousedown` should remain wired. Useful as a "all listeners can be silenced" contract test.

Use `renderHook` from `@testing-library/react` if the hook is purely refs/listeners; `render` if it needs to be wrapped in a small test component. The hook signature requires `triggerRef` and `contentRef` — both `RefObject<HTMLElement | null>`. Set up two real DOM elements via `document.createElement('div')` (or use `render` with a small wrapper component) and attach them to refs. Set `// @vitest-environment jsdom` at the top of the file.

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePortalPopover } from './use-portal-popover'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('usePortalPopover', () => {
  it('closes on outside mousedown', () => {
    const onClose = vi.fn()
    // …setup, render, dispatch mousedown on body, assert onClose called
  })
  // …four more tests
})
```

**Verification:**

- `npm test -- --run src/lib/use-portal-popover.test.ts` — targeted run; first time jsdom kicks in.
- Full suite still passes.

**Acceptance criteria:** one new test file with at least 5 tests covering the dismiss-listener matrix. First successful jsdom test in the codebase.

**Suggested commit:** `test(popover): cover usePortalPopover dismiss listeners (T-8)`

---

## Commit 9 — test: Modal backdrop click (M-6)

**Origin:** Phase 16 M-6 deferred.

**Why:**

`Modal.handleClick` was simplified in Phase 16 from `target===currentTarget + getBoundingClientRect` to just `target===currentTarget`. The simplification's correctness depends on the `<dialog>` `p-0` + inner-wrapper structure. A test that simulates a backdrop click and a content click locks the simplification's contract.

**Files:**

- Create: `src/components/Modal.test.tsx`.

**What to do:**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import Modal from './Modal'

describe('Modal', () => {
  it('closes on backdrop click', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal open={true} onClose={onClose} title="Test">
        <div data-testid="content">content</div>
      </Modal>,
    )

    const dialog = container.querySelector('dialog')!
    // Click directly on the dialog element (target === currentTarget) —
    // this represents the ::backdrop area click in the current p-0 layout.
    fireEvent.click(dialog, { target: dialog, currentTarget: dialog })

    expect(onClose).toHaveBeenCalled()
  })

  it('does not close on content click', () => {
    const onClose = vi.fn()
    const { getByTestId, container } = render(
      <Modal open={true} onClose={onClose} title="Test">
        <div data-testid="content">content</div>
      </Modal>,
    )

    fireEvent.click(getByTestId('content'))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('respects closeOnBackdropClick={false}', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal open={true} onClose={onClose} title="Test" closeOnBackdropClick={false}>
        <div>content</div>
      </Modal>,
    )

    const dialog = container.querySelector('dialog')!
    fireEvent.click(dialog, { target: dialog, currentTarget: dialog })

    expect(onClose).not.toHaveBeenCalled()
  })
})
```

**Caveat at execution time:** `<dialog>.showModal()` is supported in jsdom (added in jsdom 22+) but `getBoundingClientRect` returns zeros and the `::backdrop` pseudo-element isn't truly modeled. The test simulates the *event delivery* the production code relies on (`target === currentTarget`), not the visual rendering. That's exactly the right level: M-6's simplification is about which event-handler branch fires, not about layout.

If `dialog.showModal()` throws in jsdom (some versions don't implement it), monkey-patch:

```ts
HTMLDialogElement.prototype.showModal = function() {
  this.setAttribute('open', '')
}
HTMLDialogElement.prototype.close = function() {
  this.removeAttribute('open')
}
```

Apply this at file scope or in a `beforeAll`. Document the workaround inline.

**Verification:**

- `npm test -- --run src/components/Modal.test.tsx` — targeted run.
- Full suite still passes.

**Acceptance criteria:** one new test file with at least 3 tests covering backdrop click, content click, and the `closeOnBackdropClick={false}` opt-out.

**Suggested commit:** `test(modal): cover backdrop click handler (M-6)`

---

## Commit 10 — Phase 18 summary in `REVIEW-FIX.md`

**Origin:** workflow housekeeping.

**Why:**

Documents Phase 18 closures: T-3 through T-9 + the rolled-in M-cluster deferreds (M-1, M-2, M-4, M-6, M-10) + T-1 / T-2 audit-stale closures. With Phase 18 closed, **`REVIEW-quality.md` is fully closed as a campaign artifact** and the campaign moves to `REVIEW-security.md`.

**Files:**

- Modify: `.planning/REVIEW-FIX.md` — append Phase 18 summary.

**What to do:**

Standard structure (Shipped / Audit closures / Verification / Blockers / Next phase). Critical content:

- **Shipped: T-3, T-4, T-5, T-6, T-7, T-8, T-9, M-1, M-2, M-4, M-6, M-10** — per-commit detail.
- **Audit closures:**
  - T-1 audit-stale (already covered by `WeightTable.test.ts` written before the audit but missed by it).
  - T-2 audit-stale (already covered by `grouping.test.ts`'s 25 tests).
  - T-7 partially audit-stale (BulkDelete + BulkMove already covered by `optimistic.test.ts`; this phase covers the remaining four helpers + MutationCache).
- **M-cluster deferred (no test added in Phase 18, deliberate):** M-3 (ListSelector force-close — UX-only, low coverage value vs. setup cost), M-5 (FileReader handlers — heavy mocking for a rare error path), M-7 (RootRedirect reduce — inline reducer, would require refactor or full-component render), M-8 (DnD lookup Map — covered by dnd-kit's own tests indirectly).
- **Campaign milestone:** `REVIEW-quality.md` is fully closed. W-cluster (Phases 12-13), M-cluster (Phases 14-16), N-cluster (Phase 17), T-cluster (Phase 18). The seven prior-phase deferred test surfaces are now four closures (M-1, M-2, M-4, M-6, M-10) and three explicit deferrals (M-3, M-5, M-7) with documented reasoning.
- **Test count:** 45 → ~80-90 (new total depends on exact test count adopted at execution time).
- **Bundle:** flat (test code only).
- **Next phase: `REVIEW-security.md`** review per the user's stated quality → security → performance ordering. The recent dependency commits (`3853399` security bump, `d28af3e` Node 20+ pin) addressed acute supply-chain risk; the remaining audit work is the unread security findings.

**Suggested commit:** `docs(review-fix): append Phase 18 summary`

---

## Audit ledger (mark each as it lands)

- **Commit 1 — `<hash>`** — chore: jsdom + testing-library install, vitest setup file, vite.config.ts test block. Per-file `// @vitest-environment jsdom` directive convention; pure-function tests stay on node.
- **Commit 2 — `<hash>`** — T-3 + T-4 + M-4 pure-function tests. Three new test files; ~12+ tests.
- **Commit 3 — `<hash>`** — T-6 CSV edge cases (BOM, embedded CRLF, header-only). Three new tests in `csv.test.ts`. If BOM surfaces a real parser bug, fix is in this commit.
- **Commit 4 — `<hash>`** — T-7 + M-1 + M-2 optimistic infra. ~12-15 new tests in `optimistic.test.ts`. **Mandatory** extraction of `App.tsx` MutationCache.onError to a named export at `src/lib/mutation-error-handler.ts` (with App.tsx updated to import the named handler) — duplicating the handler in the test would only test the copy.
- **Commit 5 — `<hash>`** — T-9 import-helpers dedup. New test file with 6+ tests; `vi.mock('../supabase', ...)` at module scope so the test never hits real Supabase. Tests reflect the actual contract (existing-library dedup only; within-CSV duplicates create separate gear rows per `import-helpers.ts:36-40`).
- **Commit 6 — `<hash>`** — M-10 WeightTable consumable+worn warn. One new test in `WeightTable.test.ts`.
- **Commit 7 — `<hash>`** — T-5 bulk-reorder fail-loud. Four `if (!row) return` replaced with `expect(row).toBeTruthy()`; seed-precondition `beforeAll` added.
- **Commit 8 — `<hash>`** — T-8 usePortalPopover. First jsdom test; 9 tests (all four listeners — mousedown, scroll, resize, Escape — plus disabled-option opt-outs for scroll/resize/Escape).
- **Commit 9 — `<hash>`** — M-6 Modal backdrop click. 3+ jsdom tests.
- **Commit 10 — `<hash>`** — Phase 18 summary appended to REVIEW-FIX.md. `REVIEW-quality.md` fully closed.

## Decisions and explicitly-deferred items

- **Per-file jsdom directive over global config.** Pure-function tests (csv, grouping, optimistic, queries-bulk-reorder, WeightTable) stay on node and don't pay the jsdom load tax. Only T-8 and M-6 add `// @vitest-environment jsdom` directives. Less ceremony for the existing suite and the new pure-function tests.
- **T-1 closes audit-stale.** `WeightTable.test.ts` covers exactly what T-1 asked for (orphan-cat path, quantity math, empty input). Audit was stale at writing.
- **T-2 closes audit-stale.** `grouping.test.ts` covers `groupListItemsByCategory`, `groupGearItemsByCategory`, and the generic `groupByCategory` including the deliberate-divergence cases.
- **T-7 partially audit-stale.** BulkDelete + BulkMove already tested. New work covers Insert/Update/Delete/Reorder + MutationCache.
- **M-3, M-5, M-7, M-8 deferred.** Each has a documented reason (UX-only, heavy mocking, inline reducer, indirect coverage). Each is an explicit decision, not an oversight; documenting it in C10 prevents audit reopening.
- **App.tsx MutationCache handler extraction is mandatory, not optional.** The handler is inline at `src/App.tsx:35-47` inside the module-level `queryClient` initializer. C4 extracts it to `src/lib/mutation-error-handler.ts` exporting a named `mutationErrorHandler`, with App.tsx updated to import the named export. Both production and the test consume the same function — duplicating the handler in the test would only test the copy, not production behavior. The extraction is in C4 (not a separate refactor commit) since it has zero behavior change and the test depends on it.

- **Supabase is mocked in C5, not exercised.** `resolveOrCreateGearForImport` does I/O at `import-helpers.ts:120-125` (`supabase.from('gear_items').insert(...).select('id')`). C5 uses `vi.mock('../supabase', ...)` at module scope to capture insert payloads and stub returns. Don't let this hit real Supabase. A pure-planner extraction would be cleaner long-term but requires changing production call sites in `gear.ts` and `list-items.ts` — that's a separable refactor, not in Phase 18's scope.

- **Within-CSV dedup test direction.** Earlier draft had this backwards. The actual contract per `import-helpers.ts:36-40` is *no* within-CSV dedup: two duplicate rows in the same import create two separate gear items, matching user typing intent. The implementation only checks `gearIdByExistingKey` (built from the existing library), never `newGearRows`. C5's test 4 asserts this direction.
- **BOM test may surface a parser bug.** If the parser currently fails to strip BOM, the fix is a one-line `headerLine.replace(/^\uFEFF/, '')` (or similar) in `parseCsv` (now `csv/core.ts`). The fix lands in C3 alongside the test.
- **Test count target:** ~30-45 new tests (final count depends on edge cases adopted at execution time). Existing 45 stay green throughout. End state for normal local runs: ~75-90 passing | 4 skipped (the 4 skipped is the bulk-reorder integration `describe.skip` block when `VITE_SUPABASE_URL` etc. aren't set — env-gated, unchanged by Phase 18). What T-5 eliminates is the per-test silent no-op *inside* that describe when it *is* running; that path becomes `expect(row).toBeTruthy()` and fails loud on missing seed instead of silently passing.
- **Bundle target:** flat. Test code never enters the production bundle.
