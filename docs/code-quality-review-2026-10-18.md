# Code-quality review: findings (2026-10-18)

Full-repo quality review on `main` @ `3649bcf`. Scope: all non-test source
(`server/`, `shared/`, `src/`, `scripts/`, config, CI). Focus: DRY,
overbuilding, readability, consistency — plus any real bugs found along the
way. Method: four parallel area reviews (server; lists UI; gear/components/lib;
shared/scripts/config), cross-checked against mechanical scans (jscpd token
clone detection, knip unused-export analysis, repo-wide greps for every dead
code claim). **Findings only — no remediation plan yet.** Adversarially
validated by Codex (read-only, source-level) on 2026-10-18; its corrections
are folded in below and summarized in the Validation section at the end.
Codex verdict, condensed: useful inventory, most duplication claims supported,
but several conclusions were overstated, some citations were wrong (fixed
below), and three concrete defects were missed (now section K).

## Executive summary

This is not the mess feared. The architecture-level decisions are sound and
consistently executed: user-scoped repositories, synchronous immediate
transactions, the strict share DTO, fail-closed rate limiting, disciplined
error classification, a real style-token system, and a well-factored
client data layer (`src/lib/queries/`, the pure planners). No authorization or
share-disclosure defect was found; the four AGENTS.md invariants (user
scoping, strict share DTO, ownership prechecks, CSRF-then-auth) were checked
by this review and independently re-traced by Codex, and hold. Three
medium-severity correctness/enforcement defects do exist (section K: a
foreign-key failure misclassified as client error, unsafe retry copy on list
creation, and a quoting gap in the action-pin checker). Mechanical copy-paste
is low: jscpd measures ~1% duplicated tokens across 37k lines.

The real debt is structural, and it is concentrated in four patterns:

1. **God components.** `ListDetailInner` is one 2,200-line closure;
   `GearLibraryPage` is 1,137 lines holding three interleaved state machines.
2. **Horizontal duplication of UI shells.** The same kebab/popover scaffold,
   sortable-row wiring, inline-rename idiom, modal chrome, import-preview
   dialog, and re-auth machine are each hand-copied 2–8 times, held in
   agreement only by comments.
3. **A parallel gear↔lists universe and a parallel desktop↔mobile universe.**
   `GearItemRow`↔`ItemRow`, `GearImportPreviewDialog`↔`ListImportPreviewDialog`,
   `lib/csv/gear.ts`↔`lib/csv/list.ts`, and `ListsPage`↔`DesktopListsPanel`
   carry large duplicated sections whose agreement nothing enforces.
4. **Constants and schema fragments copied instead of imported** — on the
   server (cap numbers hand-typed into error strings) and in `shared/`/
   `src/lib/caps.ts` (zod bounds re-inlined), violating the repo's own
   "a copied constant gets a test, not a comment" rule. One copy has already
   produced behavioral drift (food weight precision).

A fifth, pervasive tax: **comment culture has tipped from trap-warnings into
changelog.** 31–41% of lines in the biggest files are comments, many narrating
PR numbers, review rounds, and "this used to..." — which AGENTS.md explicitly
bans. Genuinely load-bearing warnings are buried in autobiography, and some
comments have begun to rot (duplicated blocks, citations of files that don't
exist).

True dead code is minor (~a dozen symbols). Over-exporting is widespread
(~80 exports/types used only in their own file), which advertises an API
surface that doesn't exist.

Severity scale: **High** = real maintenance hazard or active drift;
**Medium** = clear cleanup win; **Low** = nit.

---

## A. God components and oversized files

### A1. `ListDetailInner` is a 2,200-line God component — HIGH (readability)

**CLOSED (Phase 6 PR).** Tier 1: PackLocationControls moved to its own file;
the wrapper's lists query moved into ListDetailInner (A5). Tier 2, after
characterization tests and a Codex-reviewed interface design: the DnD +
placement orchestration (handlers, narration, reorder mutations, packing
derivations) moved to `use-list-dnd.ts`, and the recursive location-section
renderer to `PackingLocationTree.tsx`. The F3 dedups landed as separate
commits first. The page keeps its render, dialog orchestration and stable
handler layer - that remainder is the page's own business and is accepted;
the thin ConfirmDialog blocks were deliberately not extracted (indirection
without reduced coupling).

`src/lists/ListDetailPage.tsx:242-2467`. One component body owns: five query
subscriptions (417–528), DnD orchestration for four drag-id kinds (730–909),
click-to-place mode and its two lifecycle effects (662–728, 1082–1106),
screen-reader announcements, the dialog state machine (155–178, 2284–2455),
packing-location admin state (347–349), deliberately un-memoized packing
derivations (990–1059), a recursive section renderer
(`renderPackingLocationNode`, 1546–1614), and layout for all three view modes —
plus a second component (`PackLocationControls`, 2473–2581) in the same file.
`EMPTY_FOOD_ITEMS` is declared mid-import-block (62–67). The extracted hooks
(`use-list-item-actions` etc.) moved mutations out but left every handler,
derivation and render concern in one closure. *Codex correction:* the
`libraryPane`→`onAddNewItem` forward reference (~1269) is inside an event
callback, so it is not an initialization-order defect, and "nothing can be
tested in isolation" overstates it — the pure planners (e.g.
`list-reorder-plan.ts`) are extracted and tested. The large-component debt
stands; those two absolute claims do not.

### A2. `GearLibraryPage`'s 11-variant `DialogState` is three state machines in one file — HIGH (readability)

**CLOSED (Phase 6 PR; partly by Phases 4b/5).** The CSV import flow (explainer,
file input, preview, mutation, error dialog) moved to `use-gear-import-flow.tsx`
on the Phase 5 shared pieces, dropping its three union variants; the union's
anti-stacking coordination survives as onBeforeOpen, tested including the
late-rejection route. The add-category editor had already collapsed onto
InlineCreateCategory (Phase 4b) - its session coordination stays in the union
exactly as the caveat below requires. The save orchestration converged on
runGuardedSave (Phase 4b); what remains per dialog is its own strings.

`src/gear/GearLibraryPage.tsx:72-94` (11 variants; the review originally said
12) mixes true modals (`create-item`, `edit-item`, `delete-*`, `bulk-*`), an
inline header editor modeled as a dialog with its own session counter and
pending/error fields (`add-category`, 184–273, rendered 601–645), and a
three-stage CSV import flow (`import-explainer`/`import-preview`/
`import-error`, 275–327 plus three inline modals at 1004–1058). Seven dialog
instances render inline (839–1074), two as hand-rolled `<Modal>` bodies.
Adding a dialog variant means first understanding three unrelated guard
disciplines. Natural seams: the add-category editor (~130 lines), the import
flow (~150 lines), the save orchestration (~60 lines). *Codex caveat:* the
editor's inclusion in the one union is a documented concurrency decision
(lines 82–88: independent state plus effect-based departure detection lost
races against async dialog replacement) — any split must preserve that
coordination, not just relocate the code.

### A3. `CategoryGroup` serves six section flavors through ~35 props — MEDIUM (overbuilt/readability)

**CLOSED (Phase 6 PR; split declined with reason).** The six flavors share the
contracts that must never fork (column alignment, the memo contract, collapse
wiring, the share-path no-dnd-kit rule), so a split would re-spell those per
file without reducing the prop surface. The header now carries the flavor map,
the sentinel rules, and the bar for adding a flavor.

`src/lists/CategoryGroup.tsx:125-314` (859 lines total) covers share category,
edit category, pack location, pack container-header, the Worn pseudo-section
and the Food section via interacting sentinel rules:
`regionKey ?? categoryId ?? 'uncategorized'` (392), `categoryId === undefined`
meaning "location" (437–441), `containerItem` swapping the entire header
(548–594), a discriminated `children`/`packProgressItems` pair (304–313), and
two separate food channels (`foodRows` vs `packFoodRows`, 227–243). Each new
flavor adds an optional prop with its own sentinel semantics and memo contract.

### A4. `shared/lists.ts` is five modules in one 504-line file — MEDIUM (readability)

List CRUD DTOs (:44), list items + quick-add (:98), packing locations (:183),
the security-critical public share DTOs (:212), reorders incl. the pack-rank
union (:307), and the CSV import with a 50-line `superRefine` (:390). The
share DTO is the one surface AGENTS.md names as an invariant and sits in the
middle of request-validation plumbing. `shares.ts` and `list-import.ts` are
natural seams.

**CLOSED (Phase 3 PR).** Split into `shared/lists.ts` (CRUD, items,
packing locations, reorders), `shared/shares.ts` (the public share DTOs) and
`shared/list-import.ts`; import sites updated, no re-export shims.

### A5. `ListDetailPage` wrapper drills six lists-query props into Inner — LOW (readability)

**CLOSED (Phase 6 PR).** Inner owns the query; the wrapper only supplies
`key={routeId}`.

`src/lists/ListDetailPage.tsx:209-257`: the outer component exists to supply
`key={routeId}` but also owns the lists query and drills
`listsLoading/listsFetching/listsPaused/listsIsError/onRetryLists` into
`ListDetailInner` (recombined at 268). TanStack dedupes subscriptions —
`DesktopListsPanel` and `FoodView` already subscribe to the same keys — so
Inner could own its query and drop seven props.

---

## B. Duplicated UI shells (horizontal duplication)

### B1. One kebab/popover shell, hand-copied eight times — HIGH (DRY)

The same scaffold — `useAnchoredMenu({ variant: 'right-flush', menuWidth })`,
a `RowIconButton` trigger with stopPropagation/toggle, then
`createPortal(<div ref={menuRef} role="group" aria-label=... className={`fixed
z-50 w-48 py-1 ${POPOVER_SURFACE}`}>` with the `'left' in menuPos` narrowing —
appears in `src/gear/GearItemRow.tsx:240-296`, `src/gear/CategorySection.tsx:335-379`,
`src/lists/ItemRow.tsx:523-594`, `src/lists/ListsPage.tsx:563-660`,
`src/lists/DesktopListsPanel.tsx:195,514,592`,
`src/lists/SortablePackSection.tsx:178-200`, and
`src/lists/MoveToLocationMenu.tsx:109,242`. The hook centralizes dismissal but
every call site re-wires trigger toggling, portal, surface classes, and aria.
*Codex correction:* "only the menu items differ" is too strong — widths vary
per site and `MoveToLocationMenu.tsx:238` switches to a modal on mobile; a
shared shell must take those as part of its contract. The eight-fold scaffold
duplication itself is confirmed.

**CLOSED (Phase 4a PR).** `src/components/KebabMenu.tsx` is the one shell
(trigger, anchor, dismiss, aria, surface); width, the mobile-modal escape
hatch and a custom trigger component are props. All eight sites converted;
`GearOptionsButton` adopted it and gained flip/clamp (named change).

### B2. dnd-kit sortable-wrapper wiring re-spelled five-plus times — MEDIUM (DRY)

`useSortable` destructure → `{ transform: CSS.Transform.toString(transform),
transition, opacity: isDragging ? 0.4 : 1 }` → grip `RowIconButton
variant="dragHandle"` with the same `'opacity-0 group-hover:opacity-100
focus:opacity-100 transition-opacity'` string, in
`src/gear/GearItemRow.tsx:313-362` (`SortableGearItemRow`),
`src/gear/CategorySection.tsx:392-423` (`SortableCategorySection`),
`src/lists/SortableItemRow.tsx:43-120`, `src/lists/SortableFoodRow.tsx:47-89`,
`src/lists/SortablePackSection.tsx:36-72,98-160`, and
`src/lists/list-card-sortable.tsx:28-84`. `useListCardSortable` was extracted
so "a future density or grip change happens in one place" (its own words) —
but only for list cards. The click-to-place tint literal
(`#eff6ff` / `inset 3px 0 0 0 #60a5fa`) is pasted in two of them
(`SortableItemRow.tsx:76-78`, `SortableFoodRow.tsx:67-69`). *Codex caveat:*
not every wrapper repeats the same grip classes — `SortablePackSection.tsx:60`
differs — so "identical five times" overstates it; the core style/wiring
recipe duplication is confirmed.

**CLOSED (Phase 4a PR).** `src/lib/use-sortable-row.ts` owns the recipe
(typed id, outer style, spreadable handleProps); the placing tint is
`PLACING_ROW_STYLE`, the grip reveal is `ROW_HOVER_REVEAL`. The container
section stays raw on purpose (two drag identities).

### B3. The inline-rename/edit idiom is hand-rolled four-plus times beyond the Inline\* trio — MEDIUM (DRY)

`InlineText`/`InlineWeight`/`InlineQuantity` already each carry their own copy
of the editing/draft/prev-prop-sync/focus/commitOnce machine (their own
comments name "three copies of the same state machine" as how the weight
controls drifted). The raw idiom (autoFocus/select, Enter commits, Escape
cancels, blur commits, re-entrancy guard) is re-implemented at
`src/gear/CategorySection.tsx:82-97,156-171,272-295`,
`src/settings/PasskeySection.tsx:53-86` (with a *different* guard),
`src/lists/ListsPage.tsx:~593-608`, and
`src/lists/DesktopListsPanel.tsx:~536-549`. Escape-vs-blur semantics can
silently diverge per surface. *Codex caveat:* several of these sites already
share `useCommitOnce`, so "the entire re-entrancy mechanism hand-rolled" is
too strong; what repeats is the keyboard/blur/draft idiom around it.

**CLOSED (Phase 4a PR).** `src/components/InlineRenameInput.tsx` owns the
machine; all four raw sites converted. Converging the Inline* trio is
PARKED.md 2026-10-20 (non-mechanical diff).

### B4. Modal chrome re-typed per dialog; `title` is aria-only — MEDIUM-LOW (DRY/inconsistency)

Every dialog re-renders its own `<h2>` of the string it already passed as
`Modal title` (`src/gear/BulkMoveCategoryDialog.tsx:18-22`,
`CreateListFromSelectionDialog.tsx:40-43`, `GearImportPreviewDialog.tsx:30-36`,
`GearItemDialog.tsx:171-179`, `ConfirmDialog.tsx:22-23`, inline at
`GearLibraryPage.tsx:1005-1007,1034-1036`). The Cancel-button class string
`rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100` is
verbatim in 8 files. `MobileOptionsModal.tsx` shows the fix (shared header
chrome) applied to only one modal family. `GearLibraryPage`'s inline
import-error modal (1033–1049) is `ConfirmDialog` minus the cancel button.
*Codex caveat:* `Modal.title` being aria-only is the component's documented
API (`Modal.tsx:16`), not an accident — the finding is the re-typed chrome,
not a Modal bug.

**CLOSED (Phase 4a PR).** Modal gained the opt-in `header` (title + X,
preventDismiss-aware); `SECONDARY_BUTTON` replaced the 8 cancel strings;
`ConfirmDialog` gained the one-button variant and absorbed the inline
import-error modal. Headers that genuinely differ (scroll-pinned, subtitle,
the compact mobile family) deliberately keep their own.

### B5. The identity-guarded "attempt" save pattern is hand-copied four times — MEDIUM (DRY)

Capture the exact state object, apply results through
`setDialog(prev => prev === attempt ? ... : prev)`, clear `savingAttempt` the
same way: `src/gear/GearLibraryPage.tsx:861-900` (item save), `:982-998`
(create-list-from-selection), `src/lists/ListDetailPage.tsx:2314-2348`
(edit-gear save), plus the session-number variant
(`GearLibraryPage.tsx:219-273`). This is the subtlest concurrency code in the
client — the kind where a fifth copy forgets one functional update and
resurrects a dismissed dialog. *Codex corrections:* these are variations on
one guard pattern, not four identical lifecycles — `ListDetailPage.tsx:2314`
is an edit-gear operation (not the same create-list dialog), and
`GearLibraryPage.tsx:982` does not repeat the `savingAttempt` cleanup. The
shared-concurrency-pattern concern stands in weakened form.

**CLOSED (Phase 4b PR).** `src/lib/guarded-save.ts` (`runGuardedSave`) owns
the install/settle/clear skeleton; the three genuine sites adopted it. The
session-number variant was deleted by B7's remount-keyed editor. Mutation
sequencing, error copy and saving-slot presence stay per-site.

### B6. The re-auth machine is duplicated across two settings sections — MEDIUM (DRY)

The park-action/`'done' | 'reauth'` runner, replay-after-reauth,
`reauthWithPasskey`, a verbatim `reauthWithEmail`, `linkSent`, synchronous
`submitting` refs, and the "Use a passkey / Email me a link / link sent"
prompt JSX appear in both `src/settings/PasskeySection.tsx:132-244,379-428`
and `src/settings/DeleteAccountSection.tsx:80-170,215-246`. Genuine divergence
is small (error codes; the delete's user-id header). A fix to the replay logic
must currently be made twice in security-sensitive code.

**CLOSED (Phase 4b PR).** `src/auth/use-reauth.tsx` owns the machine
(`useReauth` + `ReauthPrompt`); both sections converted, keeping their own
runners (error codes, the delete's header decorator) and both section test
suites passing unchanged.

### B7. Two independent inline create-category implementations on one mutation — MEDIUM (DRY)

`GearLibraryPage.commitNewCategory` + `add-category` state
(`src/gear/GearLibraryPage.tsx:242-273,601-645`) and
`GearItemDialog.handleCreateCategory` + four `useState`s
(`src/components/gear/GearItemDialog.tsx:84-87,138-157,273-319`) both drive
`addCategory.mutateAsync`, both hand-roll pending/error state, and both carry
near-identical POST-retry-unsafe error copy. The shared-observer trap the page
documents at :252 exists *because* there are two UIs.

**CLOSED (Phase 4b PR).** `src/components/InlineCreateCategory.tsx` carries
the coordination guarantees (pending guard, error-in-place, late answers made
inert by the unmount guard) and the mutateAsync trap comment once; both
surfaces converted, with a direct component test for the unmount guarantee.

### B8. Field-scoped optimistic lifecycle hand-rolled five times — MEDIUM (DRY)

`src/lists/use-list-item-actions.ts:137-169` (`updateItem`), `:193-228`
(`moveItem`), `src/lists/use-list-food.ts:75-119` (`patchPackState`),
`:137-193` (`moveFood`), `src/lists/use-list-reset-actions.ts:35-90`
(`resetFlag`) all implement the identical cancel → find row → snapshot touched
fields → patch → rollback-only-those-fields → invalidate sequence. `moveItem`
and `moveFood` are line-for-line the same logic differing only in cache shape,
down to the same toast and comments. `src/lib/queries/optimistic.ts:234-237`
*documents* field-scoping as the rule for these caches — the helper it
describes doesn't exist, so every new patch mutation re-implements ~50 lines.

**CLOSED (Phase 4b PR).** `src/lib/queries/field-scoped.ts`
(`fieldScopedCache` + `CacheShape`) is the documented helper, with direct
contract tests; all five lifecycles converted one commit at a time, each
keeping its own invalidation policy, promise ownership and error reporting.
The resets stayed plain async functions on the primitive's lower level.

---

## C. Parallel universes: gear↔lists and desktop↔mobile

### C1. `ListsPage` and `DesktopListsPanel` substantially duplicate each other — HIGH (DRY)

Both declare the same `DialogState` union (`ListsPage.tsx:58-64`,
`DesktopListsPanel.tsx:87-92`), the same CSV-import wiring (`useCsvFileInput`
+ `ListImportPreviewDialog` + verbatim "Import error" modal — ListsPage:387-425
vs Panel:362-407; jscpd: 46-line clone), a component *named the same thing*
(`SortableListRow`, ListsPage:525-542 / Panel:475-491), identical rename-inline
rows (ListsPage:564-610 / Panel:515-551), the same Rename/Duplicate/Export/
Delete kebab (ListsPage:648-681 / Panel:592-642), the same `rowHandlers`
plumbing, and a `NewListInline`/`NewListInlineRow` twin pair (ListsPage:439-489
/ Panel:414-446). `ListsEmptyState.tsx:~141-178` adds a **third** copy of the
import-preview + import-error wiring. Panel:389's comment "intentionally
duplicated (it's four lines of JSX)" undersells triplicated ~20-line blocks
plus their state. `ListsPage` also duplicates its own `NewListInline` block
internally (187–197 vs 237–247). A rename-behavior or import-flow change now
has three sites to miss. *Codex corrections:* the "~60%" figure was an
unsubstantiated estimate and is withdrawn; the two `DialogState` unions are
similar but not identical (`ListsPage` has `share-list`, the panel does not),
and the kebab menus differ (the page has Share and different ordering). The
duplicated workflows (import wiring, rename row, new-list inline, sortable
row) are confirmed; the two files are overlapping variants, not exact twins.

**CLOSED (Phase 5 PR).** `src/lists/ListRow.tsx` (ListRow + SortableListRow +
NewListInline, variants as props) and `src/lists/use-list-import-flow.tsx`
own the shared pieces; all three surfaces converted, the triplicated import
wiring deleted, and the DragOverlay clones pass no handlers (the F3
presentation/behavior split).

### C2. `GearItemRow` re-builds `ItemRow`'s scaffolding verbatim — MEDIUM (DRY, cross-area)

The outer row class is the *same template literal* in both:
`` `group relative ${FLAT_TABLE_ROW} ${FLAT_TABLE_BODY_TEXT} ${mobileSwipe ? '' : 'gap-1.5 bg-white px-3 py-2 lg:py-0'}` ``
(`src/gear/GearItemRow.tsx:96-100` vs `src/lists/ItemRow.tsx:304-306`, down to
the same px-3 justification comment). Duplicated as well: the desktop
name/description cell (`GearItemRow.tsx:146-166` vs `ItemRow.tsx:349-374`),
the mobile tap-body (`GearItemRow.tsx:69-86` vs `ItemRow.tsx:469-516`), and
parallel `SwipeableRow` wrappers (`GearItemRow.tsx:122-133` vs
`ItemRow.tsx:315-329`). Trailing columns genuinely differ; the shared leading
scaffold and mobile body do not. A density fix to "the row" means editing two
files that must agree character-for-character.

**CLOSED (Phase 5 PR).** `itemRowShell` (flat-table-styles) owns the shell
recipe; `src/components/ItemRowScaffold.tsx` owns NameDescriptionCell and
MobileRowBody; both rows compose them.

### C3. `SortableFoodRow`/`FoodRow` are copy-synchronized clones of `ItemRow`'s two layouts — MEDIUM (DRY)

`src/lists/SortableFoodRow.tsx:72-155` repeats `src/lists/ItemRow.tsx:141-282`'s
pack-mode branch verbatim (same composed className, same two print-only
checkbox `<span>`s, same wrapping-label structure, same line-through and
w-6/w-10 column skeleton). `FoodRow.tsx:349-404`'s own comment says it
"Matches ItemRow's non-pack row exactly". The layout recipe is untokenized, so
any pack-row density or print change must be made twice and re-verified for
checkbox-column alignment — the drift class the token system exists to prevent.

**CLOSED (Phase 5 PR).** `src/lists/PackRowFrame.tsx` owns the pack-row
skeleton (dnd-free; the emitted share bundle verified clean); FoodRow
composes itemRowShell + the shared cells and the missed COL_* tokens.

### C4. `GearImportPreviewDialog` and `ListImportPreviewDialog` are the same dialog — MEDIUM (DRY)

`src/gear/GearImportPreviewDialog.tsx` vs `src/lists/ListImportPreviewDialog.tsx`
(jscpd: 25- and 11-line clones): identical header-with-X, identical amber
long-description warning (same sentence), identical sticky-header table with
Name/Weight/Category columns and cell classes, identical
Cancel/`Import N item(s)` footer. The list one adds a Flags column and two
captions — a `columns`/`notes` prop, not a second ~100-line file. Drift has
already started: the gear one lost the `ml-4` on its close button.

**CLOSED (Phase 5 PR).** `src/components/ImportPreviewDialog.tsx` owns the
dialog (titleSuffix/notes/extraColumn props); the gear copy is deleted and
the lost ml-4 restored.

### C5. Column alignment between headers and rows is a comment-enforced contract — MEDIUM-LOW (DRY)

`src/gear/CategorySection.tsx:246-254` renders `w-20/w-24/w-24/w-6` label
stubs that must mirror `src/gear/GearItemRow.tsx:168-185`'s cell widths
("widths and gap mirror GearItemRow's right-side columns"), with a
hand-maintained spacer for the uncategorized case; the lists side repeats the
pattern (`CategoryGroup` header stubs vs `ItemRow` cells).
`flat-table-styles.ts` exists precisely to own such recipes.

**CLOSED (Phase 4a PR).** `COL_*` width tokens (one per column); both
tables' headers and rows compose the same token. Documented in
`docs/ui-density.md` "Column widths".

### C6. `lib/csv/gear.ts` ↔ `lib/csv/list.ts` share a 30-line clone — MEDIUM (DRY)

`src/lib/csv/gear.ts:65-94` vs `src/lib/csv/list.ts:40-55` (jscpd). Also
in-file: `src/lib/csv/import-plan.ts:301-313` vs `:325-340`. Related hook
clone: `src/gear/use-gear-category-actions.ts:37-49` vs
`src/lists/use-list-gear-actions.ts:76-88`, and
`src/gear/GearOptionsButton.tsx:28-52` vs `src/lists/ListSettingsButton.tsx:16-40`
(25-line clone).

**CLOSED (Phase 5 PR).** `lib/csv/parse-common.ts` owns the shared parse
preamble + base fields; import-plan's twin cap blocks collapsed into
assertAccountCaps; `lib/add-category-mutation.ts` owns the one add-category
recipe (per-surface mutationKeys kept); ListSettingsButton went through the
shared KebabMenu shell like GearOptionsButton did in 4a.

### C7. Three list-creation code paths for one operation — MEDIUM (DRY)

`src/lists/use-current-list-actions.ts:87-114` (`submitCreateList`) exists to
be *the* create path (snapshot sortOrder, optimistic placeholder,
navigate-on-success); `ListsPage`/`DesktopListsPanel` use it — but
`src/lists/ListsEmptyState.tsx:~49-75` hand-rolls its own `createMut` under
the same `mutationKeys.createList()` key with a different variables shape
(`string` vs `{name, sortOrder}`), its own placeholder call and error copy.
Two implementations under one mutation key is also mildly hazardous for any
future prefix-matched `isMutating` gate or mutation default. *Codex
corrections:* "three code paths" counted UI entry points — there are two
implementations; and the divergence already has a user-visible consequence:
the two paths disagree on retry safety (see K2), so this is not merely a
hypothetical hazard.

**CLOSED (Phase 5 PR).** ListsEmptyState adopts submitCreateList; one
implementation, one variables shape, one CREATE_FAILED_COPY under the key.

---

## D. Server-side duplication and inconsistency

### D1. Cap numbers hardcoded in user-facing error strings while the owning constants exist — HIGH (DRY/drift)

**CLOSED (Phase 1 PR).**

`'Gear item limit reached (500 per user)'` is a literal at
`server/routes/gear-items.ts:107,171` and `server/routes/lists.ts:160,247`,
while the same message is correctly built from the constant at
`gear-items.ts:146` (`${GEAR_ITEM_CAP}`). Same for
`'List limit reached (100 per user)'` (4 literals: `lists.ts:192,221,258,269`;
`LIST_CAP` exists in `shared/lists.ts:17`), `'List item limit reached (300 per
list)'` (`lists.ts:162,250`), `'Food item limit reached (200 per list)'`
(`food.ts:61`), `'Packing location limit reached (30 per list)'`
(`packing-locations.ts:48`). Only `CATEGORY_CAP` is interpolated everywhere.
Changing a cap now silently makes several user-facing messages lie.
*Codex correction:* AGENTS.md's copied-constant rule literally covers
TS-to-SQL/shell copies, not these TS-to-TS literals, so this is not a rule
violation — the maintenance hazard stands on its own.

### D2. Request-body parse/validate boilerplate copy-pasted 25 times, already drifting — MEDIUM (DRY)

**CLOSED (Phase 2 PR).** parseBody owns the parse and the uniform 400;
food's wording drift ended (tests-first).

`const raw = await c.req.json().catch(() => null); const parsed =
schema.safeParse(raw); if (!parsed.success) return c.json({ error: 'Invalid
request body' }, 400)` — 25 occurrences across `server/routes/lists.ts`,
`gear-items.ts`, `categories.ts`, `food.ts`, `packing-locations.ts`. Drift:
`food.ts:41,55,81` say `'Invalid request'`; the other 22 say
`'Invalid request body'`. One `parseBody(c, schema)` helper deletes ~75 lines
and ends the wording drift.

### D3. `toEmbeddedGear` duplicates `toGearItemResponse` field-for-field — MEDIUM (DRY)

**CLOSED (Phase 2 PR).** One shared mapper in routes/gear-item-response.ts.

`server/routes/lists.ts:95-109` and `server/routes/gear-items.ts:49-63` are
byte-identical bodies (11 fields, `costCents/100`, `gearStatusSchema.parse`,
ISO conversions); the comment at `lists.ts:93` even says "Same dollars/ISO
conversions as the gear routes". A new gear column must be remembered in two
files; nothing enforces agreement. (jscpd: 17-line clone.)

### D4. A fresh `betterAuth()` instance is constructed on every request — MEDIUM (overbuilt/perf)

`server/middleware/session.ts:20` calls `createAuth(c.env)` per request;
`server/index.ts:85` again for `/api/auth/*`. `createAuth`
(`server/auth.ts:480`) rebuilds the drizzle adapter, email sender, and
magic-link + passkey plugin assembly each time. Next door,
`server/db/index.ts:45-54` caches the Drizzle instance in a `WeakMap` to avoid
exactly this shape, and `server/email/index.ts:30` *designs around* the cost
("authOptions runs ... for every requireSession check"). The `/auth/*` handler
needs a per-request `AuthIncident` holder; `requireSession` passes none and
could use a cached instance. *Codex caveats:* no measured performance penalty
was demonstrated, and the per-request incident holder has a real isolation
purpose (`server/auth.ts:100`) that any caching must preserve.

**CLOSED (Phase 2b PR):** `sessionAuth(env)` caches one holderless instance
per env object (WeakMap) for `requireSession`; `createAuth(env, incident)` now
requires the holder and stays per-request for `/api/auth/*`, so a
request-bound instance cannot enter the cache. `server/auth-cache.test.ts`
pins both sides.

### D5. `ownsList` implemented three times, identically — MEDIUM (DRY)

**CLOSED (Phase 2 PR).** One ownsList(tx, userId, listId) in repos/owns-list.ts.

`server/repos/list-items.ts:133-141`, `server/repos/food.ts:126-134`,
`server/repos/packing-locations.ts:64-72`: the same nine-line select
(list id + userId, limit 1, truthiness), differing only in `Boolean(row)` vs
`row !== undefined`, each re-explaining the same rationale in its own words.
This is the single most security-relevant predicate in the repo layer and it
has three definitions. (jscpd confirms the clones.)

### D6. The owned-set `reorder` method is copy-pasted five times — MEDIUM (DRY)

**CLOSED (Phase 2 PR).** reorderOwnedSet shared by all five; drizzle 0.45
types it cleanly, so the stated type-gymnastics reason had expired.

`server/repos/categories.ts:107-131`, `gear-items.ts:353-369`,
`lists.ts:276-292`, `list-items.ts:390-418`, `packing-locations.ts:286-322`:
read owned ids into a `Set`, `updates.every(owned.has)`, loop of per-row
`UPDATE sortOrder` in an immediate transaction. `gear-items.ts:350-352`
justifies duplicating *categories'* dozen lines ("drizzle type gymnastics");
at five sites that trade deserves re-examination, and the two list-scoped
variants quietly diverge from the three user-scoped ones. *Codex caveats:*
the five are similar, not identical (gear already delegates its owned-set
check, `gear-items.ts:358`), and the stated drizzle-generics reason is not
proven expired — a shared abstraction must demonstrate simpler types and
equally visible ownership checks before it wins.

### D7. Food write routes return raw repo rows; every sibling maps field-by-field — MEDIUM (inconsistency)

**CLOSED (Phase 2 PR).** Explicit toFoodItemResponse allowlist on both write paths.

`server/routes/food.ts:75` (`c.json(result.row, 201)`) and `food.ts:102` ship
`FoodItemRow` straight to the wire with no mapper and no
`satisfies FoodItemResponse` (the GET at `food.ts:35` has `satisfies`).
Lists/gear/categories/packing-locations/me all build explicit response
objects, and `server/repos/public-shares.ts:20-23` states the house philosophy
(visible response allowlists). *Codex correction:* the rows are already
explicit projections (`itemCols`, `server/repos/food.ts:76-87`), not raw DB
rows — a new database column does not automatically leak; someone must add it
to `itemCols`. The finding is the inconsistency with every sibling route and
the missing `satisfies` on the write paths, not an active exposure.

### D8. `isAnyUniqueViolation` is dead in production; its comment describes a caller that doesn't exist — MEDIUM (overbuilt)

**CLOSED (Phase 1 PR; folded into the K1 fix).**

`server/repos/db-errors.ts:56-63` is exported, documented as "used where a
repo prechecks a duplicate...", fully tested — and has zero non-test importers
repo-wide. Either a usage was lost in a refactor or never landed; the export
and tests are maintenance weight and the comment misleads.

### D9. Cap-failure mapping: shared switch for item writes, re-typed if-chains for list writes — LOW-MEDIUM (DRY)

**CLOSED (Phase 2 PR).** listWriteFailure and importGearFailure extend the exhaustive-switch pattern.

`server/routes/lists.ts:134-177` builds `listItemFailure` (exhaustive switch)
for item writes, but list writes next to it re-type near-identical if-chains
four times (create :192, from-selection :217-222, import :239-259, duplicate
:265-269); `gear-items.ts:161-172` repeats the dialect again. Same file, two
patterns for one job.

### D10. "Append at max+1" computed two different ways, SQL shape inlined ~9 times — LOW-MEDIUM (inconsistency/DRY)

**CLOSED (Phase 2 PR).** appendSortOrder owns the fragment; food's JS read-then-add converted.

`coalesce((select max(sortOrder)+1 ...), 0)` hand-inlined at
`lists.ts:191,432,451`, `gear-items.ts:155,233,251`, `categories.ts:53`,
`list-items.ts:144,310` — while `food.ts:340-344,358` solves the identical
problem with a JS read-then-add. Both safe inside the immediate transaction,
but a reader must work out why food is different (it isn't, meaningfully).

### D11. Small server items — LOW

**CLOSED (Phase 2 PR).** All five items landed.

- `catch { if (isListCapError) return cap_exceeded; throw }` around
  `withFreshSlug` appears 4× in `server/repos/lists.ts`
  (:245-248, :310-313, :482-493, :550-553).
- Suppression-announcement JSON built twice in
  `server/middleware/error-handler.ts` (:228-234, :279-287).
- `nextPackSortOrderInCohort` (`server/repos/list-items.ts:156-161`) is a
  one-line rename of `nextUnionPackRank` — the comment is valuable, the
  indirection isn't.
- `server/routes/packing-locations.ts:1-16` lacks the authz-matrix header and
  any visible session gate every sibling route file has (its 401 protection is
  only the hoisted gate in `server/index.ts:100`, invisible from the file).
- `GearWriteResult` includes `'cap_exceeded'` for `update()`, which can never
  produce it, so the PATCH else-branch at `server/routes/gear-items.ts:222`
  would mislabel a cap error as `Not found` (`RotateShareLinkResult` in
  `lists.ts:61-63` shows the narrower per-method pattern).
- `rowsPerStatement` (`server/repos/chunk-ids.ts:24`) exported with no
  importer anywhere, tests included; `isFoodItemCapError`
  (`server/repos/food.ts:70`) exported but only used in-module, unlike its
  siblings which are genuinely imported across files.

---

## E. Shared schema layer: copies instead of imports

### E1. `src/lib/caps.ts` hand-copies zod bounds with only comments keeping them honest — HIGH (DRY/drift risk)

**CLOSED (Phase 1 PR).**

`src/lib/caps.ts:39` (`MAX_NAME_LENGTH = 256`), `:43`
(`MAX_DESC_LENGTH = 2000`), `:46` (`MAX_CATEGORY_NAME = 128`), `:25`
(`MAX_ITEM_WEIGHT_GRAMS = 100000`) are hand-copied from zod literals in
`shared/gear.ts:31-34,40` and `shared/lists.ts:28,30`, guarded only by "keep
them in sync with it". The file itself documents the hazard:
`MAX_LIST_ITEM_QUANTITY` carries a "RE-EXPORTED, not redeclared" comment
explaining the same pattern already bit once. Only the weight copy has a pin
test (`src/lists/AddFoodForm.test.tsx:174-176`, and only against the *food*
schema). These are TS-to-TS copies — shared/ could export named constants and
caps.ts re-export them, as it already does for the five caps. (*Codex
correction:* as with D1, AGENTS.md's copied-constant rule literally targets
SQL/shell copies, so this is the spirit, not the letter, of that rule; the
drift risk is real either way and the file's own comments document a prior
incident.)

### E2. Food weight accepts unbounded decimals while gear weight caps at one — MEDIUM (inconsistency, behavioral drift)

`shared/food.ts:87` is `z.number().min(0).max(100000)`;
`shared/gear.ts:40` is `decimalNumber({ min: 0, max: 100000, decimals: 1 })`,
whose comment states the rationale (everything storable is displayable). An
API client can store `12.34567` g of food (the DB CHECK in
`migrations/0000_baseline.sql:180` is only a range check on a REAL column),
the UI renders tenths, and `shared/lists.ts:289` documents food weight as
"Fractional for the same reason gear weight is: one item carries tenths."
This is the one place the schema duplication has already produced a
behavioral inconsistency rather than just a hazard.

**CLOSED (Phase 3 PR).** `foodWeightSchema` is now
`decimalNumber({min: 0, max: 100000, decimals: 1})`; gates new writes only.
`shared/food-weight.test.ts` pins it.

### E3. `shared/lists.ts` re-inlines schema fragments two lines below a comment forbidding it — MEDIUM (DRY)

`lists.ts:416-418` says "costSchema is imported from ./gear rather than
redefined: a second copy would drift" — then the same object inlines
`name: z.string().trim().min(1).max(256)` (:422, duplicating `gearNameSchema`,
gear.ts:32) and `description: z.string().trim().min(1).max(2000)` (:423,
duplicating `descriptionSchema` defined at `lists.ts:30` *in the same file*).
Same pattern at `lists.ts:137` (quick-add name creates a gear item without
the gear name shape) and `lists.ts:402` (import category name re-inlines
`categoryNameSchema`).

**CLOSED (Phase 3 PR).** Quick-add and the list import now compose
`gearNameSchema`, `categoryNameSchema` and the shared `descriptionSchema`.

### E4. Five copies of the id/tempId guard, three of `uniqueIds` — MEDIUM (DRY)

`z.string().min(1).max(64)` appears as `idSchema` in `shared/gear.ts:41`,
`shared/lists.ts:31`, `shared/food.ts:5`, and as `tempIdSchema` in
`gear.ts:184` and `lists.ts:399`. `uniqueIds` is defined verbatim in
`gear.ts:138-140` and `lists.ts:40-42` and inlined a third time at
`food.ts:82`. Only food's copy states a reason ("no dependency on list DTOs")
— but the repo already has the leaf-module pattern for this
(`shared/decimal.ts`), and lists.ts imports from gear.ts anyway. No sync tests.

**CLOSED (Phase 3 PR).** `shared/schema-primitives.ts` (leaf) owns
`idSchema`, `tempIdSchema`, `uniqueIds`, `descriptionSchema`,
`sortOrderSchema` and the `nonEmptyPatch` refine.

### E5. The import relational-integrity check is factored in gear.ts, rewritten by hand in lists.ts — MEDIUM (DRY)

`shared/gear.ts:209-240` (`refineImportGearRelations`) implements
duplicate-tempId / unknown-ref / orphan checking; `shared/lists.ts:451-502`
reimplements the identical category half line-for-line (same sets, same
messages like `'unreferenced category tempId'`) plus a structurally identical
gear half. The worn/consumable refine repeats three times in lists.ts
(:151, :178, :439). ~70 collapsible lines, plus 400-message drift risk.

**CLOSED (Phase 3 PR).** `refineTempIdRelations(noun, declared, refs, ctx)`
in gear.ts serves the gear import and both list-import layers; messages
unchanged. `wornConsumableExclusive` wraps all three worn/consumable sites.

### E6. Empty-patch guard: two idioms, two messages — LOW (inconsistency)

`gear.ts:131` and `lists.ts:76,175` use `Object.values(v).some(f => f !==
undefined)` / `'empty patch'`; `food.ts:128` uses `Object.keys(patch).length >
0` / `'at least one field is required'`. A TS caller passing
`{name: undefined}` passes food's check and fails the others; inconsistent
400 copy leaks to clients.

**CLOSED (Phase 3 PR).** One `nonEmptyPatch` idiom (defined-field check,
message `'empty patch'`) on all four patch schemas; named behavior change -
food now rejects `{name: undefined}`. `shared/empty-patch.test.ts` pins it.

---

## F. Memoization architecture and render discipline

### F1. The memo-stability discipline is hand-maintained, and its payoff is admitted void for pack location sections — HIGH (overbuilt/readability)

**CLOSED (Phase 6 PR; profiled, outcome (b)).** Measured in jsdom at the
cap-level worst case (300 items / 30 locations): one isPacked tick commits in
~140ms jsdom (~15-45ms browser estimate), linear in row count - inside the
100ms interaction budget even at the extreme. The measurement also showed
stable menu callbacks alone cannot restore the memo hits (every list-items
write rebuilds packingTree, handing each section a fresh items array), so the
fix is strictly bigger than assumed. The pack-section defeat is accepted and
the numbers plus re-profile trigger live in the KNOWN TRADE comment; the
discipline stays where it pays (edit mode, the library panel). No callback
dependencies changed.

Six `eslint-disable-next-line react-hooks/exhaustive-deps` suppressions in
`src/lists/ListDetailPage.tsx` (1164, 1230, 1239, 1300, 1385) plus a
membership-signature hack (`gearIdsKey`, 938–946) guard `[]`-deps callbacks
whose stated justification is that TanStack's `.mutate` is referentially
stable; `useLatestRef` pairs (1154–1155) serve the same memo barrier. Then
`renderPackRowAction` (1397–1468) passes a fresh function to every pack
section, and its own KNOWN TRADE comment (~1402) concedes this "defeats
CategoryGroup's React.memo for pack sections, so a checkbox tick re-renders
every location section" — Pack being the view where you tick 300 checkboxes —
while noting (~1410) that profiling should precede choosing a replacement.
Meanwhile `ListsPage` builds fresh closures per row per render (267–284) with
no memo and is fine. The convention ("never put a mutation in deps") is
enforced only by comments; one naively-written handler captures stale state
silently. *Codex corrections:* this does not show the memoization has no
payoff elsewhere — only that the discipline's cost/benefit is unproven and
locally defeated; and the three-context placement system
(`placement-context.tsx:24`) has its own reasoned purpose and should not be
counted as pure memo overhead. The maintenance-hazard claim (comment-enforced
invariant, six suppressions) is confirmed.

### F2. The pack-filter visibility predicate is spelled in three places, with a note admitting it — MEDIUM (DRY)

`src/lists/CategoryGroup.tsx:443-453` (`visibleItems`/`visibleFood`),
`src/lists/list-reorder-plan.ts:27-42` (`deriveFilteredItemIds`),
`src/lists/ListDetailPage.tsx:1032-1040` (`packFilteredFoodIds`).
`list-reorder-plan.ts:25-27` says outright: "The expression is duplicated
there, not shared... keep them in step." This codebase already shipped a bug
from this exact pattern — the worn-row rule drifted between renderer and
planner until `section-rows.ts` centralized it (its header documents
"audit F1"). The same fix is available and unapplied for a rule equally
load-bearing for drag correctness.

**CLOSED (Phase 4b PR).** `passesPackFilters` joined `isOrdinarySectionRow`
in `section-rows.ts`; all three sites ask it, and the keep-them-in-step note
is gone.

### F3. In-page handler/announcement copies — LOW (DRY)

**CLOSED (Phase 6 PR + Phase 5 PR).** The narration trio has one owner
(`narrated`), the two move requests share `requestMoveRow` with ONE stated
rank source, and both moved into `use-list-dnd.ts`. The DragOverlay stub
handlers were closed by Phase 5's ListRow (actions optional; clones omit
them).

`src/lists/ListDetailPage.tsx:760-783` (`requestMove`) vs `:785-804`
(`requestMoveFood`) are identical modulo gear/food lookup; the
Moving/Moved/Could-not announcement trio repeats again at 714–726 and 874–884.
`:795` computes rank from `packFoodItems` where its twin at `:774` uses
`listFood.items` — equivalent in pack mode, but the reader must prove it.
Also: the DragOverlay clones must stub 11+ no-op handlers
(`ListsPage.tsx:314-331`, `DesktopListsPanel.tsx:330-345`) because row
presentation and behavior share one props type.

---

## G. Comment culture

### G1. History-narrating comments at scale, against the repo's own rule — HIGH (readability; AGENTS.md violation)

AGENTS.md Comments: "No history: no PR numbers, review rounds, or 'this used
to...'. Git has that." Yet, server side: `server/repos/db-errors.ts:8`
"(Codex finding, PR #14)", `server/middleware/security-headers.ts:15` "(Codex
review, PR #11)", `server/auth.ts:234` "replaces the bespoke fresh_auth table
+ POST /api/me/reauth from PR #43", `server/middleware/error-handler.ts:326`
"the bug PR 4.3 just fixed", `server/routes/shares.ts:79` "(review P2.13)",
`server/auth.ts:50` "Review P2.11", `server/middleware/rate-limit.ts:120,207`
"(Found by review, 2026-07-12)" / "(Found by review, not by me.)", plus a
production-incident anecdote at `rate-limit.ts:49-50`. Client side:
"TRANSPLANT NOTE" (`ListDetailPage.tsx:131-140`), "This comment used to say…"
(:1341-1349), "#110 … (2026-07-21)" (`SharePage.tsx:190-196`), "PR #200"
(`MoveToLocationMenu.tsx:66`), "an adversarial review caught it"
(`ItemRow.tsx:275-279`), "They used to fire it unawaited…"
(`optimistic.ts:110-137`), "round-5 finding 1" (`pack-rows.ts:85`), "round-6
finding 2" (`ListDetailPage.tsx:674`), "GATE 2 finding" (`FoodView.tsx:333`,
`AddFoodForm.tsx:110`). Volume: pure-comment lines are 31–41% of the big files
(ListDetailPage 795/2581, CategoryGroup 299/859, optimistic.ts 249/614;
`rate-limit.ts` and `error-handler.ts` roughly two-thirds prose — e.g. the
55-line passkey-budget narrative at `rate-limit.ts:34-86`). *Codex caveat:*
the density figures measure all comments, not history specifically — much of
the prose is load-bearing trap documentation (e.g. `Modal.tsx:26`,
`placement-context.tsx:24`) that AGENTS.md says to keep; the violation is the
historical framing, and cleanup must strip the narration while keeping each
current failure mechanism. (Original citation `AddFoodForm.tsx:515` was wrong
— the file is 166 lines; the reference is at :110.)

### G2. Comments that have begun to rot — LOW (but by repo rules, bugs)

**CLOSED (Phase 1 PR).**

- `src/gear/CategorySection.tsx:199-216`: a 9-line "Category drag handle.
  Deliberately a sibling BEFORE…" paragraph appears twice, back to back,
  verbatim.
- `src/gear/GearLibraryPage.tsx:456,460` cite "DECISIONS.md ADR 11" / "ADR 1"
  — no such file exists anywhere in the tree, and CLAUDE.md has no ADRs.
- `src/auth/auth-ui.tsx:3-4` still says "the real visual system arrives with
  the SPA transplant in phase 2" — the SPA shipped. Its `PRIMARY_BUTTON`/
  `FIELD` constants now form a second button/input recipe alongside
  `PrimaryButton`/`FORM_INPUT` (`rounded-md`/`font-semibold` vs
  `rounded-lg`/`font-medium`), and `SignInPage.tsx:133-138` adds a third
  inline secondary-button string.
- `src/lib/use-anchored-menu.ts` comment says the `right-anchored` variant is
  "Used by MobileMenu" — no such component exists.

---

## H. Overbuilt / dead / over-exported

### H1. `useAnchoredMenu`'s `right-anchored` variant is dead while the component that wants it bypasses the hook — MEDIUM (overbuilt + inconsistency)

**CLOSED (Phase 1 PR; the dead variant is deleted — if GearOptionsButton needs its geometry, Phase 4's KebabMenu re-adds a variant).**

`src/lib/use-anchored-menu.ts:5` defines `RightAnchored`; zero callers. Its
only effect is making `MenuPos` a union, forcing the `'left' in menuPos`
narrowing at all seven live call sites. Meanwhile
`src/gear/GearOptionsButton.tsx:31-46` — a right-edge-anchored popover —
hand-rolls its own `pos` state, `getBoundingClientRect` math and
`usePortalPopover` wiring, losing the hook's flip-up-near-viewport-bottom
logic (`use-anchored-menu.ts:50-57`). Both the speculative abstraction and
the duplication it was supposed to prevent.

### H2. Genuinely dead symbols — LOW (overbuilt)

**CLOSED (Phase 1 PR).**

Zero consumers repo-wide, tests included: `packRowLocationId` and
`packRowIsPacked` (`src/lists/pack-rows.ts:23-31`); the
`export { PackContainerSection, PackPlainSection }` statement
(`src/lists/PackLocationSection.tsx:219`); `rowsPerStatement`
(`server/repos/chunk-ids.ts:24`); `isAnyUniqueViolation` in production (D8).
Near-dead: `isLegacyListPath` (`src/lists/list-detail-mode.ts:424-426`) is a
one-line re-export of `isLegacyOrganizePath`, both exported;
`selectPackGrouping` (`src/lists/packing-grouping.ts:4`) has no production
caller outside its own file's wrapper.

### H3. Over-exporting: ~80 exports/types used only in their defining file — LOW (API hygiene)

**PARTIAL (Phase 1b PR):** the `scripts/` portion (`currentDefinitions`,
`FORBIDDEN`) is closed. **Phase 2 PR:** the server files it touched
(`copyName`, `remapPackingLocationId`, the in-file-only cap matchers). The
rest was handled on a touched-file basis in Phases 2–6; the residue left
after Phase 6 is accepted, per the remediation plan. **Phase 3 PR:** the `shared/` portion - in-file-only
schemas unexported, dead type aliases removed; request-contract types named
by `docs/authz-matrix.md` (e.g. `QuickAddListItemRequest`,
`ImportGearRequest`) stay exported because the binding matrix references
them.

knip flags 43 unused exports + 40 unused types; spot-checks show most are
"exported but only used in-file" rather than dead (e.g. `copyName`,
`remapPackingLocationId` in `server/repos/lists.ts`; the `public*Schema`
family in `shared/lists.ts`; `PRINT_*`/`MOBILE_*`/`DESKTOP_*` tokens in
`flat-table-styles.ts`; `foodNameSchema`, `foodQuantitySchema`,
`importListGearRefSchema`, `ImportCategoryRef`, `currentDefinitions` in
`scripts/schema-sql.ts`). Dead `export` keywords advertise an API that doesn't
exist and `noUnusedLocals` can't see them, so they rot silently.
(Known false positives, excluded: `server/auth-schema.config.ts` is a
documented CLI-only config; `fflate` loads via dynamic import in
`DownloadAllData.tsx:33`; server test fixture assets are read from disk.)

### H4. Options prop-bundle threaded in triplicate — LOW (readability)

**Verified still closed in Phase 6 (A2 split kept the single bundle).**

`src/gear/GearLibraryPage.tsx:691-700` and `:1081-1091` pass the identical
8-prop `onNewCategory/onImport/onExport/...` set to `GearOptionsButton` and
`MobileGearActionBar`, which forwards it again to `GearOptionsContent` —
three prop lists in lockstep. (jscpd flags the twin blocks.)

**CLOSED (Phase 5 PR).** GearOptionsContent exports GearOptionsHandlers;
the page builds one `gearOptions` object consumed by both surfaces.

---

## I. Minor bugs found along the way (quality review, not a bug hunt)

- **FoodView double-invalidates on create**: `src/lists/FoodView.tsx:116`
  (`onSuccess: invalidateFood`) plus a second `invalidateFood()` in the
  per-call `onSuccess` at `:235`. Harmless, wasteful.
  **CLOSED (Phase 5 PR):** the per-call copy is gone.
- **One `busy` boolean freezes all of FoodView**: `:198-205` ORs six mutations
  plus `checkingDays` and disables every control while any one write is in
  flight — serialize-everything UX at odds with the field-scoped concurrency
  the pack side implements.
  **PARKED (Phase 5 PR):** needs the food concurrency contract defined
  first — PARKED.md 2026-10-20, with the trigger.
- **`InlineText` cannot clear a value**: `src/components/InlineText.tsx:38-42`
  silently discards an emptied draft — right for names, wrong for the
  description call sites (`GearItemRow.tsx:159-165`, `ItemRow.tsx:363-369`),
  where the only way to remove a description is the full dialog.
- **GearItemRow select-mode description gate misaligns columns**:
  `src/gear/GearItemRow.tsx:157` — in select mode, rows without a description
  drop the `flex-[3]` column while rows with one keep the 2:3 split, so name
  cells stop lining up; meanwhile name/description stay editable in select
  mode while weight goes static and the kebab hides — three different answers
  to "is this row editable during selection".
  **CLOSED (Phase 5 PR):** named policy change — everything read-only during
  selection; the description column renders on every row.
- **Gear PATCH can mislabel a cap error as 404** (D11, unreachable today).

## J. Config/CI nits — LOW

**CLOSED (Phase 1b PR).** Rename, preview script, eslint ignore, yaml pin
and tsconfig flags all landed; the ci.yml↔image.yml verify duplication is
deliberately kept, with comments in both files saying the copies move
together.

- `vite.node.config.ts` builds the *client* (`package.json:8`); the `.node.`
  suffix is a vestige of the deleted Cloudflare config (commit `7a4c75e`).
- Orphan `preview` npm script (`package.json:21`): serves `dist/client` with
  no API, so every `/api/*` call 404s; referenced by no doc.
- `eslint.config.js:8` ignores `.superpowers`, which exists nowhere.
- `check:yaml` drift: CI inlines `pipx install yamllint==1.37.1 && yamllint …`
  instead of `npm run check:yaml`, so the version pin lives only in CI while
  docs point humans at the unpinned npm script.
- The verify block is duplicated between `ci.yml` and `image.yml:86-130`; a
  new gate added to ci.yml silently doesn't guard a publish (partially
  documented).
- tsconfig strictness asymmetry: `tsconfig.app.json` has `noUnusedLocals`,
  `noUnusedParameters`, `noImplicitReturns`; `tsconfig.node.json` (server/,
  scripts/) has none, with no comment stating the choice. `noImplicitReturns`
  has no lint equivalent here.

## K. Found by Codex validation (missed by the original pass)

### K1. Packing-location creation converts foreign-key defects into client errors — MEDIUM (bug / rule violation)

**CLOSED (Phase 1 PR).**

The operation checks parent ownership and source membership inside an
immediate transaction (`server/repos/packing-locations.ts:120`, ~188), yet
catches any foreign-key failure and returns `invalid_container_item` (~:203),
which the route answers with 400 (`server/routes/packing-locations.ts:55`).
This contradicts AGENTS.md's explicit rule that a foreign-key failure inside
an immediate transaction is a defect, not a race — "let it 500". It masks
server defects as bad user input, including failures on named-location
creation where no container item was even supplied. The food suite shows the
intended treatment (`server/repos/food-transactions.test.ts:199`). Not an
authorization bypass, but it disproves a blanket "error classification is
consistent" claim. Open question recorded for later: whether the same-list
trigger failure in the same catch should also be treated as an internal
defect rather than `invalid_container_item` — the planned fix deliberately
leaves it as a client error.

### K2. List creation recommends an unsafe retry after an ambiguous POST failure — MEDIUM (bug)

**CLOSED (Phase 1 PR; the implementations converge in Phase 5).**

`src/lists/use-current-list-actions.ts:90` says "Couldn't create the list.
Please try again." The server generates a fresh list id per create
(`server/repos/lists.ts:227`), so if the create commits but the response is
lost, following the copy creates a second list. This violates the repo's own
error-copy trap rule ("a rejected response does not prove that a
non-idempotent request did not commit"). `ListsEmptyState.tsx:21` — the
*other* implementation of the same create (C7) — already uses the correct
"Couldn't confirm… Refresh to check" wording, so the duplication has produced
a live safety divergence, not just drift risk.

### K3. The action-pin checker silently skips quoted `uses:` values — MEDIUM (enforcement gap)

**CLOSED (Phase 1 PR).**

The regex in `scripts/check-action-pins.mjs:42` excludes quotes and unmatched
lines are silently ignored (~:100): a probe confirms unquoted
`actions/checkout@v4` matches while single- and double-quoted equivalents do
not. The zero-pins guard (~:115) doesn't help when other actions remain
recognizable, so a quoted, tag-pinned action would pass CI unchecked. An
enforcement gap in the checker, not evidence any current pin is wrong — but
the "fail-closed" description of the script layer needs this qualification.

## Non-findings (suspects checked and cleared)

- The four AGENTS.md invariants hold everywhere checked: user scoping,
  ownership prechecks inside write transactions, the strict share DTO
  (asserted on raw JSON), CSRF-then-auth ordering.
- `shared/deep-strict.ts` is *not* reinventing zod: zod 4's `strictObject` is
  shallow, there is no recursive-strict API, and `deep-strict.test.ts` pins
  every response schema against it.
- All package.json dependencies are genuinely used (`fflate` via dynamic
  import); no unused deps.
- The small hooks in `src/lib` (`useCommitOnce`, `useToggleSet`,
  `useIsPrinting`, `use-breakpoint`, `usePortalPopover`, `useReorderable`)
  all have real callers and stated reasons — that layer is not overbuilt.
- `quantitySchema` vs `foodQuantitySchema` agreeing at 9999 is the documented
  "distinct contracts that happen to agree" pattern; both have DB-pin tests.
- The pure planners (`packing-dnd.ts`, `pack-rows.ts`, `placement-plan.ts`,
  `list-reorder-plan.ts`) and `src/lib/queries/` are well-factored and tested.
- Dockerfile, workflows, checker scripts: disciplined and reasoned (with the
  one quoting gap in the action-pin checker, K3).

## Mechanical evidence

- **jscpd** (`--min-tokens 70`, tests excluded): 23 exact clones, 1.01%
  duplicated lines / 1.48% duplicated tokens over 37k lines. Largest:
  `DesktopListsPanel.tsx:362-407` ↔ `ListsPage.tsx:382-425` (46 lines).
  Clusters: desktop↔mobile lists (4 clones), gear↔lists (6 clones), server
  repos ownership/column boilerplate (5 clones).
- **knip**: 3 unused files (1 real config false-positive + 2 fixture assets),
  43 unused exports, 40 unused types — mostly over-exporting, see H3.

## Validation record

Codex (read-only, source-level) adversarially validated this document on
2026-10-18 against the working tree at `3649bcf`:

- Spot-checked all eight HIGH findings and 21 MEDIUMs. Most duplication claims
  supported; corrections and caveats folded into the findings above (marked
  *Codex correction/caveat*). Citation errors fixed: `caps.ts` line numbers
  (E1), `AddFoodForm.tsx:515` → `:110` (G1), the A2 variant count (11, not
  12), the withdrawn "~60%" estimate (C1).
- Independently re-traced the four AGENTS.md invariants (user scoping, strict
  share DTO, ownership prechecks inside write transactions, CSRF-then-auth)
  and found them holding, as source conclusions — no cross-user access path,
  no share-DTO leak.
- Found three defects the original pass missed (section K).
- Flagged documented decisions any future remediation must protect: the
  unified `add-category` editor state and its `mutateAsync` choice
  (`GearLibraryPage.tsx:82,252` — races it provably fixes), `CategoryGroup`'s
  separate food channels (public/authenticated boundary, `:235`) and
  discriminated children/progress pair (`:300`), the reorder duplication's
  stated drizzle-generics reason (`gear-items.ts:350`), and the per-request
  `AuthIncident` isolation (`auth.ts:100`).
- VERDICT (verbatim): "Not accurate and complete enough unchanged; preserve it
  as an inventory, but correct the missed defects and documented-tradeoff
  mischaracterizations before prioritizing broad component or memoization
  refactors." — Those corrections are now incorporated in this version.
