# grampacker — Phase 15 fixes (2026-05-06)

**Source:** `REVIEW-quality.md` — defensive half of the M-cluster: M-1 (production observability for failed mutations), M-5 (`FileReader` error/abort), M-8 (`gearItems.find` / `listItems.find` consolidation via `Map`), M-10 (consumable-vs-worn precedence assert).
**Scope:** four small defensive fixes + summary. **Five commits.** No new tests in this phase — these touch error paths, async file IO, and assertion-style guards that are hard to unit-test without jsdom + `@testing-library` (deferred to the T-cluster phase).
**Why bundle these four:** all are defensive/observability items, all small, all touch failure or guard paths rather than user-observable UX. The UX-visible half (M-2, M-3, M-7) shipped in Phase 14.

> **Note on file paths:** all paths are repo-relative.
> **Phase 14 baseline:** main bundle = **187.47 KB gzip**. Bundle delta expected: **±0.05 KB** (M-1 adds ~5 lines of structured payload; M-5 adds two event handlers; M-8 adds three `useMemo` Maps and converts ~7 `find` calls to `.get` — likely net-neutral; M-10 adds one structured warn).
> **Risk profile:** low. M-1 expands logging surface but keeps the failure path identical for callers. M-5 adds two event handlers that already-have-a-failure-path callers wire to. M-8 is mechanical `find → Map.get` conversions on non-ref array sources. M-10 is a structured warn that's unreachable per DB constraint — purely belt-and-suspenders.

---

## How to execute this file

Five commits. Order does NOT matter — none depend on each other.

C1 → C2 → C3 → C4 → C5.

After every commit:

```bash
npm run build && npm run lint && npm test -- --run
```

Build, lint, and tests must all pass before moving to the next commit.

---

## Verification: audit-vs-current-code

| Audit ref | Audit said | Current code | Verdict |
|---|---|---|---|
| M-1 | `App.tsx` `MutationCache.onError` is dev-only `console.error`; production has zero observability | confirmed at `App.tsx:25-31`; `if (!import.meta.env.DEV) return` gates the log to dev only | exact |
| M-5 | `useCsvFileInput` doesn't handle `FileReader.error` / `.onabort` | confirmed at `use-csv-file-input.ts:38-50`; only `reader.onload` is wired, `onerror` and `onabort` are absent | exact |
| M-8 | "Five sites repeat `gearItems.find(...)` / `listItems.find(...)` lookups" | actually **12 sites** across 2 files; 7 are by-id on non-ref arrays (in scope), 4 are inside ref-based callbacks (deferred), 1 is a render-time `lists.find` for the current-list lookup (deferred — different array, single consumer) | shifted but real |
| M-10 | `is_consumable` + `is_worn` mutual exclusion at DB; `WeightTable` branch order silently picks consumable | confirmed at `WeightTable.tsx:41-44`: `if (item.is_consumable) { consumableGrams += w } else if (item.is_worn) { wornGrams += w }` — silent precedence | exact |

**M-8 site enumeration.** A broader grep than the audit's wording surfaces these:

| File | Line | Pattern | Source array | Key | Scope |
|---|---|---|---|---|---|
| `ListDetailPage.tsx` | 509 | `listItems.find((i) => i.id === activeParsed.id)` | direct (non-ref) | id | **in scope** |
| `ListDetailPage.tsx` | 511 | `listItems.find((i) => i.id === overParsed.id)` | direct (non-ref) | id | **in scope** |
| `ListDetailPage.tsx` | 830 | `listItems.find((i) => i.id === activeParsed.id)` | direct (non-ref) | id | **in scope** |
| `ListDetailPage.tsx` | 627 | `listItemsRef.current.find((l) => l.gear_item_id === item.id)` | ref-based | gear_item_id | **deferred** |
| `ListDetailPage.tsx` | 665 | `gearItemsRef.current.find((x) => x.id === gearId)` | ref-based | id | **deferred** |
| `ListDetailPage.tsx` | 666 | `listItemsRef.current.find((l) => l.gear_item.id === gearId)` | ref-based | embedded gear_item.id | **deferred** |
| `ListDetailPage.tsx` | 670 | `gearItemsRef.current.find((x) => x.id === gearId)` | ref-based | id | **deferred** |
| `GearLibraryPage.tsx` | 474 | `allItems.find((i) => i.id === overParsed.id)` | direct (non-ref) | id | **in scope** |
| `GearLibraryPage.tsx` | 492 | `allItems.find((i) => i.id === activeParsed.id)` | direct (non-ref) | id | **in scope** |
| `GearLibraryPage.tsx` | 494 | `allItems.find((i) => i.id === overParsed.id)` | direct (non-ref) | id | **in scope** |
| `GearLibraryPage.tsx` | 717 | `allItems.find((i) => i.id === activeParsed.id)` | direct (non-ref) | id | **in scope** |
| `ListDetailPage.tsx` | 174 | `lists.find((l) => l.id === listId)` | direct (non-ref) | id | **deferred** (different array, single consumer) |

**Scope decision 1: defer ref-based callback finds.** The four ref-based finds (627, 665, 666, 670) are inside `useCallback`s with empty dep arrays that read `*Ref.current` at click-time. Replacing them with a Map would require either (a) `*ByIdRef` updated in a `useEffect`, which adds two new refs and an effect for what's already a ~50ns linear scan at click cadence, or (b) violating the existing ref pattern by making the callbacks depend on the Map's identity, which would re-create them on every render and defeat the memoization the refs exist to enable. Neither trade is favorable.

**Scope decision 2: defer the `lists.find` at line 174.** This is a once-per-render lookup of the *current list* in the `lists` array — different array shape (`List`, not `ListItemWithGear`) and single consumer (the document-title hook + a few downstream uses of `list?.name`). Adding a `listsById` Map for one render-time lookup over an array that's typically <20 entries is over-engineering. The audit's framing was "five sites repeating gear/list-item lookups" — the cleanup spirit is well-served by the seven gear/list-item conversions; the current-list lookup is a separate concern that doesn't share the DnD/DragOverlay hot-path motivation.

The audit's "five sites" wording was a count; the cleanup spirit is well-served by the seven non-ref item conversions.

---

## Commit 1 — M-1: production-aware mutation error logging

**Origin:** `REVIEW-quality.md` M-1 (Medium).

**Why:**

`App.tsx:25-31` defines a global `MutationCache.onError` that does nothing in production:

```ts
mutationCache: new MutationCache({
  onError: (error, _vars, _ctx, mutation) => {
    if (!import.meta.env.DEV) return
    const key = mutation.options.mutationKey?.join('/') ?? 'mutation'
    console.error(`[${key}] failed:`, error)
  },
}),
```

The dev-gate ensured production builds stay quiet, but it also means a silent mutation failure in production (network error, RLS denial, race condition) leaves zero trace anywhere. The user sees the optimistic snap-back; the developer never knows it happened.

**Files:**

- Modify: `src/App.tsx:25-31`.

**What to do:**

Drop the `DEV` gate and emit a structured `console.warn` payload with mutation metadata, in every environment. Use `console.warn` rather than `console.error` because most failures are recoverable (the optimistic update rolled back, the user can retry) — `console.error` carries severity that doesn't match the operational reality.

```ts
// Global default error handler for every useMutation in the app. Per-mutation
// onError still wins for surfacing errors inline; this just guarantees no
// failed write disappears silently.
//
// Logged in every environment (not just DEV) so production failures are
// visible when a developer or technically-curious user opens DevTools.
// Deliberately uses console.warn rather than console.error: most mutation
// failures are recoverable (optimistic snap-back, user can retry), and
// reserving console.error for genuinely non-recoverable cases keeps the
// signal-to-noise ratio honest. A future Sentry/PostHog/etc. integration
// would wrap this call site — the structured payload is already the
// shape a reporter wants.
//
// Most mutation failures are surfaced inline at their call site (e.g.,
// GearItemDialog's transactional save shows the error in the dialog) or
// are silent optimistic rollbacks where the user sees the snap-back. We
// deliberately do NOT route every mutation failure through the toast
// system from here — that would spam users with toasts for transient
// network failures and background refetch errors. The toast system
// exists (src/lib/toast.ts) and is used selectively by
// makeOptimisticReorder.onError where the rollback is otherwise silent
// and confusing. New mutation paths should consider whether their
// failure mode warrants a toast on a case-by-case basis.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 30 },
  },
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      const key = mutation.options.mutationKey?.join('/') ?? 'mutation'
      const message = error instanceof Error ? error.message : String(error)
      const code =
        error && typeof error === 'object' && 'code' in error
          ? (error as { code: unknown }).code
          : undefined
      console.warn(`[${key}] failed`, {
        error: message,
        code,
        mutationKey: mutation.options.mutationKey,
      })
    },
  }),
})
```

Three local extractions (`message`, `code`) keep each line short and the `console.warn` payload readable. The `code` extraction in particular is hard to scan inline — Postgres errors carry it as a five-character SQL state, fetch errors don't, and the in-`'code' in error` typeguard plus the cast is enough complexity to warrant its own line.

**Why the structured payload:**

- `error.message` keeps the human-readable line at the top of the log.
- `error.code` (when present — Postgres errors have it, fetch errors don't) lets a future log-shipper grep failures by error class without parsing strings.
- `mutationKey` array (not just the joined `key` string) preserves the structured form so a future reporter can dimension-group by mutation type.
- `console.warn(message, payload)` is the standard one-call shape that DevTools console renders inline-expandable.

**Why not full Sentry integration:**

- Adds an SDK dependency, an env var, and a build-time hook. Out of proportion for a project at this scale.
- The structured-warn payload is the shape a future Sentry/PostHog wrapper would already want — wrapping is a one-line change later.

**Verification:**

- `npm run build` — passes; dev gate removal doesn't change types.
- `npm run lint` — passes.
- `npm test -- --run` — passes (no new tests).
- Manual smoke (deferred to user): in browser DevTools console, simulate a mutation failure (DevTools → Network → block all requests, then trigger a save). Should see the structured warn payload with mutation key and error message.

**Acceptance criteria:** mutation errors log in every environment via structured `console.warn`. Per-mutation `onError` paths still take precedence for surfacing errors inline.

**Suggested commit:** `fix(app): log mutation errors in every environment with structured payload (M-1)`

---

## Commit 2 — M-5: handle `FileReader.error` and `.onabort`

**Origin:** `REVIEW-quality.md` M-5 (Medium).

**Why:**

`useCsvFileInput` at `src/lib/use-csv-file-input.ts:38-50` only wires `reader.onload`. A failed read (corrupt file, permissions, OS-level abort) silently produces no callback — the consumer's `onError` is never called, the dialog/picker waits forever, the user sees nothing happen and assumes the import worked or was lost.

**Files:**

- Modify: `src/lib/use-csv-file-input.ts:38-50` — add `reader.onerror` and `reader.onabort` calling `handlers.onError(...)` with user-facing copy.

**What to do:**

Add the two handlers right before `reader.readAsText(file)`:

```ts
const reader = new FileReader()
reader.onload = (ev) => {
  // ... unchanged ...
}
reader.onerror = () => {
  // FileReader.error fires for I/O failures: corrupt file, OS-level
  // permission denial, removable media yanked mid-read, etc. The
  // global error path is independent of the parser callback, so
  // failed reads can otherwise produce zero feedback.
  handlers.onError(
    "Couldn't read this file. It may be corrupt or your browser may have blocked file access. Try a different file.",
  )
}
reader.onabort = () => {
  // Programmatic .abort() or some browser-internal cancellations.
  // Not user-cancel via the OS picker (that produces no file at all
  // and is handled by the `if (!file) return` guard above).
  handlers.onError('File read was canceled.')
}
reader.readAsText(file)
```

**Why this is safe:**

- The existing `handlers.onError(string)` shape is already used for the >2 MB-size and parser-rejection cases. Both new sites call it with the same shape and route through the same surface (toast / dialog inline error / etc., depending on the consumer).
- `reader.onerror` fires after `reader.error` is set; we don't need to read it (the user-facing copy is generic — "couldn't read this file"). Logging the underlying error is M-1's job, not M-5's.
- `reader.onabort` is rare in practice. Including it for completeness so the consumer's failure path is exhaustive.

**Verification:**

- `npm run build`, `npm run lint`, `npm test -- --run` all pass.
- Manual smoke (deferred, low-value — this requires deliberately corrupting a file): not really worth doing manually. The two consumers (`/lists` import, `/lists/:id` import) already handle the existing `>2 MB` and parser-failure paths the same way; the new branches plug into the same surfaces.

**Acceptance criteria:** all three FileReader async outcomes (`onload`, `onerror`, `onabort`) call into the consumer's handler. No silent dead-end.

**Suggested commit:** `fix(csv-input): handle FileReader.error and .onabort so failed reads aren't silent (M-5)`

---

## Commit 3 — M-8: `gearById` / `listItemsById` Maps for non-ref ID lookups

**Origin:** `REVIEW-quality.md` M-8 (Medium).

**Why:**

Seven sites (3 in `ListDetailPage`, 4 in `GearLibraryPage`) do `array.find((i) => i.id === id)` over arrays that are passed in as props or from `useQuery` data. Linear scan is fine at typical N (50–500), but a `useMemo`'d `Map` keyed by id is O(1) per lookup and signals intent ("by id") more clearly. The DnD callbacks in particular do these scans on every drag tick or DragOverlay render — the cumulative cost is small but real.

**Files:**

- Modify: `src/lists/ListDetailPage.tsx` — add a `listItemsById` `useMemo`, convert lines 509, 511, 830 to `.get`.
- Modify: `src/gear/GearLibraryPage.tsx` — add an `allItemsById` `useMemo`, convert lines 474, 492, 494, 717 to `.get`.

**What to do:**

### Step 1 — ListDetailPage

After the existing `listItems` is defined (search for `const { data: listItems` or the top-level useQuery destructuring), add:

```ts
// O(1) id lookups for DnD callbacks and DragOverlay rendering.
// Linear scan would be fine at typical N (~50 list_items per list);
// the Map signals intent more clearly and keeps drag-tick cost flat
// rather than scaling with N.
const listItemsById = useMemo(
  () => new Map(listItems.map((i) => [i.id, i])),
  [listItems],
)
```

Convert each in-scope find:

```ts
// Line 509:
const activeItem = listItems.find((i) => i.id === activeParsed.id)
// →
const activeItem = listItemsById.get(activeParsed.id)

// Line 511:
const overItem = listItems.find((i) => i.id === overParsed.id)
// →
const overItem = listItemsById.get(overParsed.id)

// Line 830:
activeParsed?.kind === 'item' ? listItems.find((i) => i.id === activeParsed.id) : null
// →
activeParsed?.kind === 'item' ? (listItemsById.get(activeParsed.id) ?? null) : null
```

The `?? null` at line 830 is required because `Map.get` returns `T | undefined`, while the original ternary's else-branch yielded `null`. Preserving the same shape avoids downstream type churn.

**Do NOT touch lines 627, 665, 666, 670.** Those are inside ref-based callbacks (`listItemsRef.current.find`, `gearItemsRef.current.find`) — see the scope decision in the verification table.

### Step 2 — GearLibraryPage

After the existing `allItems` is defined (line ~96), add:

```ts
// O(1) id lookups for DnD callbacks and DragOverlay rendering. See
// ListDetailPage's listItemsById comment for the rationale.
const allItemsById = useMemo(
  () => new Map(allItems.map((i) => [i.id, i])),
  [allItems],
)
```

Convert the four finds (474, 492, 494, 717) to `allItemsById.get(...)`. Apply the same `?? null` treatment at line 717 if its else-branch yields `null`.

**Verification:**

- `npm run build` — `tsc -b` confirms `Map.get` return type narrows correctly via `?? null` where needed.
- `npm run lint`, `npm test -- --run` all pass.
- Manual smoke (deferred): drag items on `/lists/:id` (within-category reorder) and `/gear` (within-category reorder + cross-category category reorder). Behavior should be byte-identical.

**Acceptance criteria:** seven `find((i) => i.id === ...)` calls converted to `Map.get(...)`. Two new `useMemo`'d Maps. No behavior change. Ref-based callback finds (4 sites) explicitly preserved.

**Suggested commit:** `refactor(dnd): cache items-by-id in useMemo'd Maps for O(1) DnD lookups (M-8)`

---

## Commit 4 — M-10: explicit consumable-vs-worn precedence

**Origin:** `REVIEW-quality.md` M-10 (Medium).

**Why:**

`WeightTable.tsx:41-44` accumulates per-item grams via:

```ts
if (item.is_consumable) {
  consumableGrams += w
} else if (item.is_worn) {
  wornGrams += w
}
```

If both flags are true, consumable wins silently. The DB enforces mutual exclusion via a CHECK constraint (a list_item with both flags set can't be persisted), so the impossible state isn't reachable in practice — but if a future migration relaxes the constraint, or a test fixture skips it, or an optimistic update creates a momentarily-inconsistent state, the precedence bug would silently mis-categorize weight.

**Files:**

- Modify: `src/lists/WeightTable.tsx:36-49` — add a structured `console.warn` when both flags are true; preserve the existing precedence (consumable first).

**What to do:**

```ts
for (const item of items) {
  const w = item.gear_item.weight_grams * item.quantity
  // Defensive: the DB CHECK constraint forbids is_consumable +
  // is_worn both being true on the same list_item, but if a future
  // migration or optimistic-update path produces this impossible
  // state, log it and pick consumable (the historical precedence)
  // so the page doesn't silently mis-bucket the weight.
  if (item.is_consumable && item.is_worn) {
    console.warn('[weight-table] list_item has both is_consumable and is_worn; bucketing as consumable', {
      listItemId: item.id,
      gearItemId: item.gear_item.id,
    })
  }
  if (item.is_consumable) {
    consumableGrams += w
  } else if (item.is_worn) {
    wornGrams += w
  } else {
    // ... existing per-cat bucketing ...
  }
}
```

(The `else` branch is the existing per-cat bucketing — leave it untouched.)

**Why warn-and-preserve, not throw:**

- Throwing kills the page render. The user loses access to their list because of a defensive guard for an unreachable case. Bad trade.
- Preserving the historical precedence (consumable wins) keeps the visible behavior identical to the previous implementation when the impossible state appears, just now with a log line. No surprises for anyone reading the page.
- The structured warn payload (`listItemId`, `gearItemId`) gives a future debugger enough to track the row down without crashing the page.

**Why not change to `is_consumable && !is_worn` etc.:**

- The DB invariant means the additional check is redundant in 100% of real cases. Adding the gate gains nothing for the common path and obscures the simpler `if/else if` the audit pointed at.

**Verification:**

- `npm run build`, `npm run lint`, `npm test -- --run` all pass.
- The existing `WeightTable.test.ts` tests use exclusive `is_consumable: true` / `is_worn: true` shapes (see `WeightTable.test.ts:5-37` factory — they're separate fields with default false). No test exercises the both-true path; the warn won't fire.

**Acceptance criteria:** loud (structured `console.warn`) when the impossible state appears; quiet (existing `if/else if`) when it doesn't. Visible behavior unchanged.

**Suggested commit:** `fix(weight-table): warn when impossible is_consumable+is_worn state appears at runtime (M-10)`

---

## Commit 5 — Phase 15 summary in `REVIEW-FIX.md`

**Origin:** workflow housekeeping.

**Files:**

- Modify: `.planning/REVIEW-FIX.md` — append `# grampacker — Phase 15 fix summary (2026-05-06)`.

**What to do:**

Use the standard structure (Shipped / Audit closures / Verification results / Blockers / Next phase). Hashes filled in after C1–C4 land. Notable items to capture:

- **M-1**: structured `console.warn` payload, no external SDK; the shape is what a future Sentry/PostHog wrapper would already want.
- **M-5**: two new event handlers; failed reads route through the existing `handlers.onError(string)` surface.
- **M-8**: 7 of 12 find sites converted (3 in ListDetailPage, 4 in GearLibraryPage). The other 5 deferred: 4 inside ref-based callbacks (would require ref-based Maps; little benefit at click-cadence), 1 render-time `lists.find` for current-list lookup (different array, single consumer, not a hot path).
- **M-10**: warn-and-preserve, not throw-and-crash. Defensive guard for an unreachable case.
- **M-cluster status:** after Phase 14 (UX-visible) + Phase 15 (defensive), the active M-items are closed. M-4 (`crypto.randomUUID` polyfill), M-6 (Modal backdrop simplify), M-9 (sharedGroupProps recompute), M-11 (parseDnDId comment) remain — most are likely audit-stale or N-tier. Triage in Phase 16 prep.

**Suggested commit:** `docs(review-fix): append Phase 15 summary`

---

## Audit ledger (mark each as it lands)

- **Commit 1 — `<hash>`** — M-1. `App.tsx` mutation error handler logs in every environment via structured `console.warn(message, { error, code, mutationKey })`. Dev gate removed; future external-reporter wrapping is a one-line change.
- **Commit 2 — `<hash>`** — M-5. `useCsvFileInput` adds `reader.onerror` and `reader.onabort`, both calling `handlers.onError(...)` with user-facing copy.
- **Commit 3 — `<hash>`** — M-8. Two `useMemo`'d Maps (`listItemsById` in `ListDetailPage`, `allItemsById` in `GearLibraryPage`). 7 of 12 `find((i) => i.id === ...)` calls converted to `Map.get(...)`. 4 ref-based callback finds and 1 render-time `lists.find` (current-list lookup, different array, single consumer) explicitly preserved.
- **Commit 4 — `<hash>`** — M-10. `WeightTable.computeWeightBreakdown` warns when an impossible `is_consumable + is_worn` row appears, preserving consumable precedence. DB CHECK makes this unreachable today; warn is belt-and-suspenders for future migration regressions.
- **Commit 5 — `<hash>`** — Phase 15 summary appended to REVIEW-FIX.md.

## Decisions and explicitly-deferred items

- **No new tests in Phase 15.** All four fixes touch error paths, async file IO, or runtime-assertion guards. M-1 / M-5 / M-10 specifically need a console-spy harness that's typically jsdom-flavored. M-8 is mechanical and the existing 45 tests cover the surrounding code paths. Backfill deferred to the T-cluster phase along with Phase 14's deferred items.
- **M-1 ships structured `console.warn`, not Sentry.** Adding an external observability SDK is out of proportion for a project at this scale. The structured payload is the shape a future reporter wants — wrapping is a one-line change later. Documented in the commit message and summary so future readers know the integration path is intentional, not forgotten.
- **M-1 uses `console.warn`, not `console.error`.** Most mutation failures are recoverable (optimistic snap-back, user retry). Reserving `console.error` for genuinely non-recoverable cases keeps the signal-to-noise ratio honest.
- **M-8 defers ref-based callback finds (4 sites) and the current-list lookup (1 site).** The ref-based finds would require either `*ByIdRef` updated in a `useEffect` (clunky) or breaking the ref pattern by adding the Map as a `useCallback` dependency (defeats the memoization the refs exist to enable). Click-cadence linear scans at N≤500 are imperceptible. The `lists.find` at line 174 is a single-consumer render-time lookup over an array that's typically <20 entries; a `listsById` Map for one consumer would be over-engineering. Documented in the enumeration table.
- **M-10 warns instead of throwing.** Crashing the page on a defensive guard for an unreachable case is the wrong trade. Preserving the historical consumable-precedence keeps visible behavior unchanged when the impossible state appears.
- **M-4, M-6, M-9, M-11 not in scope here.** These are the remaining M-items after Phase 14 and Phase 15:
  - **M-4** (`crypto.randomUUID` polyfill) — dev-only convenience for `vite preview` over plain HTTP / older Safari. Likely audit-stale post-deployment-on-Cloudflare. Triage.
  - **M-6** (Modal backdrop simplify) — `if (e.target === e.currentTarget) e.currentTarget.close()` instead of rect arithmetic. Tiny.
  - **M-9** (sharedGroupProps recompute) — already addressed during Phase 5/M7 memoization phases, likely audit-stale. Verify.
  - **M-11** (parseDnDId comment) — doc-only fix, likely already addressed by Phase 11/12. Verify.
- **Bundle target:** ≈ ±0.05 KB gzip after all four commits. M-1 adds ~5 lines of payload structure; M-5 adds two short event handlers; M-8 is roughly net-neutral (Map construction added, find body bytes removed); M-10 adds one structured warn statement.
