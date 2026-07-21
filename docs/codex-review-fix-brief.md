# Codex PR review — fix brief

- Status: ready for implementation
- Review date: 2026-07-21
- Reviewed commits: PRs #100–#106, i.e. `0de6398`..`a42846c` (current `main`)
- Reviewer: Claude (four parallel adversarial reviews, one per PR/PR-pair)

## Scope and how to read this

PRs #100–#106 were authored by Codex and are **all merged and deployed**. A
merge to `main` is a deploy (`.github/workflows/deploy.yml`), so everything
below is live, not pending.

Sections are in the order they should be worked:

1. **P0 — product decisions (Joe, 2026-07-21).** Two deliberate changes. Not
   bugs. These come first because P0-2 dissolves one of the findings outright.
2. **P1 — live defects**, most severe first.
3. **P2 — half-finished migrations and stale comments.**
4. **P3 — nits**, worth a sweep but not worth a dedicated PR.
5. **Cross-cutting: the test gap.** The reason most of this shipped green.

One commit per logical change. Do not fold P2/P3 cleanups into a P0 or P1 PR.

## Verification available on this host

`npm run build` and `npm run test:unit` both work. `npm run test:api` needs to
bind a port and generally will not run in the sandbox — let CI own it.

**There is no Chrome, Chromium, or Playwright on this host** (checked:
`/usr/bin/google-chrome-stable` and `/usr/bin/chromium` both absent, nothing on
`PATH`). Codex's PR bodies said the same and were telling the truth. So the
browser-verifiable items below — P0-1, P0-2, P1-2, P1-3, P1-4 — cannot be
self-verified here and need either a human pass in a real browser or a run of
the `verify` skill on a machine that has one. Say so in the PR body rather than
implying a visual check happened.

---

# P0 — product decisions

## P0-1. Weight units: keep the toggle in the gear list, hide it in Pack and Organize

**Decision (Joe):** the `g`/`oz` segmented control belongs in Edit mode only.
Pack and Organize should not show it.

PR #106 already implements exactly this (`ListDocumentToolbar.tsx:38`), so **the
toggle placement itself needs no change.** What is left is the reason the
control was there in the first place.

**The problem it leaves.** Pack mode is not actually weight-free. Gear is:
`WeightSummary` is hidden (`ListDetailPage.tsx:1032`), category subtotals are
hidden (`CategoryGroup.tsx:476`), and `ItemRow.tsx:175` returns a qty-only
checklist row with no weight column. But `ListDetailPage.tsx:1091` renders
`FoodPackSection` under `{mode === 'pack' && ...}`, and
`FoodPackSection.tsx:79` renders `<ItemWeightValue grams={row.grams}
unit={weightUnit} />` per row. Verified by rendering the component directly:

```html
<span class="block truncate ...">Ramen</span>
<span aria-label="128 g" class="inline-block whitespace-nowrap">
  <span class="text-right">128</span>
  <span class="text-left">g</span>
```

Switching `weightUnit` to `oz` re-renders those rows as `4.5 oz`. No hiding
classes, not print-only. So on any list with a food plan attached, Pack shows
gram figures with the unit control removed — reachable only via Settings.

**Change:** remove the weight column from `FoodPackSection`, making "Pack mode
shows no weights" true everywhere instead of true-with-an-exception. Delete the
`ItemWeightValue` render at `FoodPackSection.tsx:79` and the now-unused
`weightUnit` prop, and drop the prop at the `ListDetailPage.tsx:1094` call site.

> If you would rather keep per-food weights visible while packing, strike this
> item — but then P0-1 is not done, and the honest resolution is to show the
> toggle in Pack after all. Do not leave weights on screen with no way to
> switch units.

**Also fix the test.** `list-unit-control.test.tsx` currently reads:

```
it('hides the unit control when Pack and Organize hide weights')
```

That name asserts a premise that is false for Pack today. It becomes true once
the food weight column is gone. Keep the name only if this item lands in full;
otherwise rename it to describe what it actually pins.

**Acceptance**
- No weight value renders anywhere in Pack mode, gear or food, with or without
  a food plan attached.
- The unit control renders in Edit and in Settings; not in Pack or Organize.
- A test asserts the food checklist renders no weight, so this cannot regress
  silently the way it did the first time.

## P0-2. Worn gear is always grouped; the toggle goes away

**Decision (Joe, 2026-07-21):** worn gear is **always** pulled into its own Worn
section — in the list view, in Pack, and in Organize. The per-list `groupWorn`
toggle is removed; grouping is no longer configurable, it is the behavior.

This **supersedes** the `SETTLED 2026-07-20 (Joe)` decision recorded at
`docs/organize-pack-design.md:962` ("worn stays exactly as today, governed by
`groupWorn`") and the section 4.5 rule that Organize filters worn rows out
entirely. Strike those through with a new dated entry; do not delete them. That
strikethrough convention is what makes the design doc trustworthy — see how PR
#105 recorded its own contract change.

**Effectively `groupWorn` is now always true.** Note the DB default is `false`
(`server/db/app-schema.ts:166`), so most existing lists carry `false` today.
Rendering must ignore the stored value rather than read it, which means existing
lists change behavior on deploy. That is intended.

**Recommended scope — UI and rendering only, leave the database alone.** Remove
the toggle and stop reading the flag; keep the `lists.group_worn` column and its
place in the share DTO. Rationale: dropping the column needs a migration against
remote D1, and `groupWorn` is part of the locked public-share projection
(`shared/lists.ts:268-273` calls it deliberately public, and
`server/routes/shares.test.ts` pins the wire shape). Changing that projection is
a separate, riskier change that must not ride along with a UI cleanup. Column
removal can be a later cleanup PR.

**Sites to change**
- `src/lists/ListSettingsPanel.tsx:54-56,117-118` — remove the toggle and its
  `useListFlagToggle` wiring.
- `src/lists/ListDetailPage.tsx:687` — `showWornGroup` becomes a constant `true`
  rather than `list?.groupWorn ?? false`. The `hideWorn` props at `:873`,
  `:1155`, `:1170`, `:1185` and the trailing Worn section at `:1219-1223` then
  apply unconditionally, in both Edit and Pack.
- `src/lists/SharePage.tsx:180-184,260,265` — same treatment, or the share view
  and the app will disagree about the same list.
- `src/lib/use-stable-worn-items.ts` — **keep it.** It stabilizes the Worn
  section's array identity and is still needed; it just never runs in the
  disabled branch any more.
- `src/lists/CategoryGroup.tsx:133,208,240,247` — `hideWorn` is now always true
  at every call site. Either keep the prop and pass `true`, or inline the filter
  and delete the prop. Prefer deleting it: a prop with one possible value is a
  contract that invites the next drift.

**New work — the Organize Worn section.** Organize today hides worn rows
entirely (`OrganizePackPanel.tsx`, `buildPackingTree(..., { includeItem: item
=> !item.isWorn })`), so this is the one place that needs building rather than
un-gating. Add a trailing Worn section to Organize that is **read-only**:

- Worn items are listed and visible, so the screen accounts for every item.
- No `Move to…` action and no drag handle on those rows. The existing rationale
  still holds — "Organize is 'where does this go in my pack'; an on-body item is
  not in the pack" — so worn items remain unassignable. Only their visibility
  changes.
- The section is not a drop target and takes no part in reordering.
- Location item counts keep counting only non-worn assigned items, which stays
  coherent: a location never says "1 item" while displaying none.

**One documented wrinkle disappears — say so in the doc.** Section 4.5 records
an accepted oddity: with `groupWorn` **off**, an assigned-then-worn item is
visible inside its location group in the checklist yet not movable in Organize.
With worn always extracted, a worn row never renders inside a location group
anywhere, so that state is now unreachable. The stored-state nuance itself
stays: assigning an item and *then* marking it worn still **keeps**
`packing_location_id` in the database rather than clearing it (lossy otherwise),
and the API-level test pinning that must survive untouched.

**This closes a live ordering bug — note the direction.** Organize currently
excludes worn items from the reorder slot pool unconditionally
(`OrganizePackPanel.tsx:163-166`), while Pack excludes them only
`if (list?.groupWorn)` (`ListDetailPage.tsx:577`). Because most lists have the
flag off, an Organize reorder silently rearranges worn rows in Pack: given
`A(1), B(2), W(3,worn), C(4)`, dragging `C` above `A` in Organize yields
`C, A, W, B` in Pack — the user moved one item and a different one jumped.

**Organize's unconditional exclusion is the correct side. Keep
`hiddenReorderItemIds` exactly as it is, and make Pack's exclusion at
`ListDetailPage.tsx:577` unconditional to match.** Once worn is always extracted
into its own section, worn items are never part of any location's ordered rows
on either screen, so both compute the same slot pool. Do not delete the
exclusion.

**Acceptance**
- No worn toggle in list settings.
- A Worn section renders in Edit, Pack, Organize, and the public share view, for
  every list, regardless of the stored `group_worn` value.
- Worn items appear in that section only — never inside a category or location
  group — in all four views.
- Organize's Worn rows expose no `Move to…` and no drag handle, and the section
  rejects drops.
- Pack and Organize reorder produce identical orderings for the same list. Add a
  test asserting both paths derive the same exclusion set — this is the
  regression that was live and the current suite cannot see it.
- An API-level test still proves `packing_location_id` survives marking an item
  worn.
- `grep -rn "groupWorn\|group_worn" src/` returns only the server-DTO
  passthrough — no rendering or branching logic. Paste the grep output; do not
  assert it from memory.

---

# P1 — live defects

## P1-1. BLOCKER — promoting gear with a long name returns a 500

**Where:** `server/repos/packing-locations.ts:103-123` (PR #102).

`create` copies the gear name into `packing_locations.name` as a snapshot:

```ts
const [source] = await db.select({ name: gearItems.name })...
if (!source) return { ok: false, reason: 'invalid_container_item' }
name = source.name
```

The two name domains have different bounds. `gear_items_name_length` is
`between 1 and 256` (`server/db/app-schema.ts:109`); `packing_locations_name_length`
is `between 1 and 60` (`app-schema.ts:249`). The request-side
`packingLocationNameSchema` also caps at 60 (`shared/lists.ts:219`) but the
promote path never reaches it — the validated union branch is
`{ containerListItemId }`, which carries no name.

A 61–256 character gear name is therefore accepted everywhere it is created and
then fails the CHECK on INSERT. The resulting `SQLITE_CONSTRAINT_CHECK` matches
none of the three handlers in the catch block (`isPackingLocationCapError` wants
`SQLITE_CONSTRAINT_TRIGGER`, `isUniqueViolation` wants `UNIQUE constraint
failed`, `isForeignKeyViolation` wants `FOREIGN KEY constraint failed` —
`server/repos/db-errors.ts`). It rethrows as an unhandled 500, not the 4xx
`docs/authz-matrix.md` documents for the route.

**Repro:** create gear named `Ursack Major XL Bear Resistant Critter Bag with
Aluminum Liner Kit` (66 chars, legal), add it to a list, open Organize Pack,
click **Use as container** on that row →
`POST /api/lists/:id/packing-locations {"containerListItemId":"…"}` → **500**.
The optimistic location rolls back silently and that item can never be
promoted. Untested: every fixture in `server/routes/packing-locations.test.ts`
uses short names.

**Fix — pick one, this is a judgment call:**
- truncate the snapshot to 60 on the way in (simplest; the displayed name comes
  from the live gear join anyway, so truncation is invisible in the UI); or
- widen `packing_locations_name_length` to 256 to match gear (needs a
  migration); or
- return a typed `name_too_long` result and surface a real error in the UI.

Recommendation: truncate. The stored value is only a fallback snapshot — the
endpoint already returns `coalesce(container_gear.name, packing_locations.name)`
— so nothing user-visible is lost, and it needs no migration.

**Acceptance:** promoting gear with a 250-character name succeeds; a test covers
a name over 60 characters at the route level.

## P1-2. Container sections claim "All packed" while holding unpacked items

**Where:** `src/lists/CategoryGroup.tsx:251-255` (`progressItems`, `complete`),
`:383` (the count), `:386-388` (the check icon). From PR #103.

Nested containers render *inside* the parent's collapsible region
(`CategoryGroup.tsx:455`), but `progressItems` is only
`[containerItem, ...sectionItems]` — the header measures less than it renders.

**Repro:** list = `Backpack` (container, unassigned), `Bear canister`
(container, inside Backpack), `Food A/B/C` (inside Bear canister). Pack mode
shows `Backpack 0 / 1` with a `Bear canister 0 / 4` section nested under it.
Tick only Backpack's own checkbox → the header reads **`Backpack 1 / 1` with the
green "All packed" check** while four unpacked checkboxes sit visibly inside
that same section. Before #103 this was unreachable: `complete` required
`sectionItems.length > 0`, so no section claimed completion on the strength of a
row that was not its content.

This also contradicts the line #103 added to `docs/organize-pack-design.md`:
"each screen counts what it renders."

**Fix:** either roll descendants into the parent's `progressItems`, or drop the
count and the completion check on nodes that have children. Prefer the former —
a container's progress is genuinely the progress of its contents.

## P1-3. Mobile gear/food search fields have no accessible name

**Where:** `src/lists/LibraryPanel.tsx:90-94` (`id="list-gear-search"`) and
`src/lists/FoodPlanPicker.tsx:65-69` (`id="list-food-plan-search"`). From
PR #100.

Both live inside `libraryPane` (`ListDetailPage.tsx:751`), which is mounted in
**two** places at once: the desktop aside at `:960`, gated only on
`mode === 'edit'` and hidden with CSS (`className="hidden lg:flex …"`, i.e.
still mounted at phone width), and the drawer at `:1268`.

**Repro:** phone at 390 px, open `/lists/:id` in Edit, tap **Add** in the bottom
bar. Two elements now carry `id="list-gear-search"`. `<label for=…>` binds to
the first in document order — the CSS-hidden desktop input. The visible drawer
field is left with placeholder-only naming, which is exactly the defect UX-04
was filed to remove, and the document is invalid HTML.

The tests cannot see this: `LibraryPanel.test.tsx` and `FoodPlanPicker.test.tsx`
render the component standalone, where a duplicate id is impossible.

**Fix:** instance-scoped ids via `useId()`, or an `idPrefix` prop — the pattern
`UnitSegmentedControl` already uses. Add a test that mounts the panel twice and
asserts each search input resolves to its own label.

## P1-4. Cross-subtree location drops write every row and change nothing

**Where:** `src/lists/OrganizePackPanel.tsx:259-270`, `:391-398`;
`src/lists/packing-dnd.ts:48-50`; `src/lib/use-reorderable.ts:103-110`. From
PR #104.

PR #104 made root and nested locations `useSortable` participants in per-level
`SortableContext`s, but the planner behind them is a single `useReorderable`
over the **flat, tree-agnostic** `locations` array
(`OrganizePackPanel.tsx:88-93`). `isPackingCollisionTarget` accepts any
`packing-location` target for a `packing-location` active, so nothing restricts
a drop to the dragged node's sibling set.

Order is not corrupted — `arrayMove` preserves the relative order of untouched
elements, so every sibling group keeps its order and the payload is a valid
permutation. The symptoms are softer and still wrong:

**Repro:** roots `A(0)` and `Z(2)`; `Z` has nested child `B(1)`. Drag `A`'s grip
onto `B`'s header. `B` shows the blue `isOver` ring (`:492`), implying something
will happen. The planner sees flat `[A,B,Z]`, `0 → 1`, and writes `B=0, A=1,
Z=2`. Roots re-sort to `A, Z` — identical to before. Three rows written to D1,
nothing changed, drop ring lied.

**Fix:** a sibling guard in the collision filter (or in `planReorder`'s caller —
not in `planReorder` itself, which is correct and shared). A drop outside the
dragged node's sibling set should not present as a drop target at all.

---

# P2 — half-finished migrations and stale comments

These are the "declared done, left half-migrated" class the repo conventions
call out. All from PR #100.

**P2-1. UX-01's grep-clean criterion is not met.** Its acceptance was "a grep
for the stale `NavBar` heading assumptions returns no remaining sites." Still
present, all beside code that PR rewrote:
- `src/layout/AppShell.tsx:14-18` — promises a route-context heading is coming
  with later slices. UX-01 decided the opposite: do not restore route-specific
  state to the global shell.
- `src/layout/AppShell.tsx:67-70` — "a fixed 4 slots (Gear/Lists/Add/Options)".
  False: destinations are Gear/Lists/Food across 3-, 4- and 5-slot bars.
- `src/layout/mobile-nav-destinations.tsx:6-7` — "complete the 5-slot layout".
  Not true for Plans (4) or Organize (3).
- `src/layout/sidebar-drawer-context.tsx:3-12` and
  `src/lists/ListDetailPage.tsx:284-285` — describe the drawer trigger as living
  "in NavBar"; it is the bottom bar's Add slot.

**P2-2. List rename pencil is `md:`-gated and below the touch floor.**
`src/lists/CurrentListHeader.tsx:52-61` is
`opacity-100 … md:opacity-0 md:group-hover:opacity-100`, with a comment claiming
it is always visible to touch users. `InlineTitle.tsx:9-13` documents the pencil
as the *only* entry into rename. At 768–1023 px — a touch tablet, which UX-02
and UX-08 explicitly reclassify as touch — it is `opacity-0` with no hover, so
inline rename is invisible and untappable. It is also `h-8 w-8` (32 px), under
the 40 px floor UX-08 claimed to complete and for which the `NOT YET APPLIED`
notes were deleted from `docs/ui-density.md`. Not a dead end (List options still
offers Rename), but the comment is now false.

**P2-3. Settings cog is ~30 px.** `src/layout/AppShell.tsx:70-79`: `p-1.5`
around an 18 px icon. Its own adjacent comment concedes it is "the single entry
point to /settings on every viewport." Same deleted-`NOT YET APPLIED` problem as
P2-2.

---

# P3 — nits

Worth one sweep PR, not individual ones.

- **`ORDER BY` tiebreak sorts on a stale snapshot.**
  `server/repos/packing-locations.ts:82` orders by `sortOrder, packingLocations.name`,
  but the endpoint returns `coalesce(container_gear.name, packing_locations.name)`.
  Rename backing gear from "Zulu" to "Alpha" and two locations sharing a
  `sort_order` come back in an order contradicting their displayed names.
- **Unmapped trigger abort.** `server/repos/packing-locations.ts:147-160` does
  not handle `isTriggerAbort(err, 'container item does not belong to this list')`.
  Unreachable today, a 500 the moment anything moves items between lists.
- **Focus can land on a destructive action.** `src/lib/use-portal-popover.ts:57-60`
  focuses the first *enabled* control. In `src/food/FoodPlansPage.tsx:167-190`
  the items are `[Duplicate (disabled while pending), Delete]` — duplicate one
  plan, then open another's kebab while it is pending, and **Delete plan** takes
  focus on open. Focus the container instead.
- **Passkeys card copy contradicts itself.** `src/settings/SettingsPage.tsx:33-38`
  always renders "Your passkeys are how you sign in. Add one per device you use"
  while `src/settings/PasskeySection.tsx:286-292` renders "This browser doesn't
  support passkeys." directly beneath it.
- **Two contracts loosened to optional without a reason.**
  `src/lists/MoveToLocationMenu.tsx:21,72` made `onUseAsContainer` optional with
  a silent `?.()`, so the row can render wired to nothing; and
  `src/lists/packing-dnd.ts:29` defaults `excludedLocationIdsByItem` to an empty
  Map, so a caller that forgets it loses cycle protection with no type error.
  Both unreachable today. A discriminated union or a required param restores the
  guarantee.
- **Hidden packed rows get repositioned.** `src/lists/packing-dnd.ts:27-37`
  reorders against the full array while the user sees only `visibleItems`. The
  visible outcome is always correct (verified — the classic visible-index bug is
  genuinely *not* present), but with Show-unpacked-only on, a hidden packed row
  can silently move from the middle of a location to the top. Turn the filter
  off later and the order is one nobody chose.
- **Stale batch-size note.** `server/repos/lists.ts:660-697` adds up to 30
  statements to the duplicate batch, so AGENTS.md's "worst-case ~400 statements
  in one batch" figure is now wrong. Update the note.

---

# Cross-cutting: why the suite did not catch any of this

`npm run test:unit` was green at every one of these commits — 909 tests at #106,
915 at #105. That is the finding, not a reassurance.

Most of the defects above sit at **wiring sites and integration seams that the
current tests structurally cannot reach**:

- P1-3's duplicate id cannot appear in a test that renders one panel.
- P0-2's ordering divergence is a **wrong argument passed to a correctly-tested
  pure function**. `planPackingItemReorder` has a green suite; nothing asserts
  that Pack and Organize hand it the same exclusion set.
- Neither production wiring site — `ListDetailPage.tsx:571-591` and
  `OrganizePackPanel.tsx:215-236` — has a test at all. Both were hand-wired.
- `packing-dnd.test.ts:182-196` never passes a non-empty
  `containerItemIdByLocation` or `excludedReorderItemIds`, so the set-union at
  `packing-dnd.ts:109-112` is untested through the combined entry point.
- The three keyboard-reorder tests added by #100 assert `tabindex="0"` and an
  accessible name but never drive Space → Arrow → Space/Escape, so UX-05's
  "initiate, move, cancel, finish" is unproven.

**Add a test at each of the two wiring sites** as part of P0-2. That is the gap
that let the ordering bug through, and it will let the next one through too.

Combined with no browser on this host, the run had high confidence and low
coverage at the same time. Prefer one integration test at the seam over another
unit test on an already-covered pure function.

---

# Appendix: what was checked and found clean

Recorded so it is not re-litigated later.

**PR #102** — for a 4,800-line feature this is strong work. Session-scoped
ownership filters on *every hop* of the recursive CTE walks, so the ancestor
traversal cannot cross into another user's rows. The public share projection is
untouched and `shares.test.ts:197-201` already forbids the packing-location keys
on raw JSON. No new endpoint takes an id array, so the D1 100-param cap is
unthreatened, and the duplicate-list path re-derives chunk size from the column
count. Migration 0015 is purely additive — nullable `ADD COLUMN`, a unique index
on a nullable column, five triggers, no rebuild, no backfill — with literal
`POST_CHECKS` in `scripts/check-migration-safety.mjs`. Cycle prevention is
enforced at three independent layers: UI exclusions, an app-level gate inside the
write's `WHERE` so a rejected move writes zero rows, and DB triggers. CSRF and
auth layering unchanged. `noUncheckedIndexedAccess` respected throughout.

**PR #103** — the tree transform is sound. No list state double-counts, drops,
or duplicates an item; cycle members are forced to root so rendering cannot
recurse forever. The share-bundle seam holds: the two new `CategoryGroup`
imports are drag-free and `share-path-imports.test.ts` still covers the boundary
genuinely rather than passing vacuously. No duplicate collapsible-region ids
(the #90 bug class is not reintroduced).

**PRs #104/#105** — the classic visible-array/full-array index bug was
specifically hunted and is **not** present. Optimistic payloads are strict
permutations that satisfy `validateReorderPayload`; rollback is intact;
concurrent reorders are blocked. Server-side ownership and the param cap are
correct. #100's keyboard reorder still works.

**On test integrity.** Every modified test across all four reviews was checked
for the "invert the assertion to make it pass" pattern. **It appears exactly
once, in #106** — a comment documenting a deliberate contract was deleted and its
test inverted, leaving the suite green while behavior regressed. Everywhere else
the pattern is absent or legitimate: #103 inverted an assertion but the
inversion *was* the feature and the design doc was updated in the same commit;
PR #104's doc edit corrects genuinely stale text (verified against pre-#104
source); #105 records its contract change as `SETTLED 2026-07-21 (Joe)` with a
visible strikethrough; #100's inverted `nav-order` assertion came with a
stronger replacement, and five other test files were strengthened. #106 is an
outlier, not a house style.

---

# Open process question (not for Codex — for Joe)

PR #101 wrote into `AGENTS.md` that "push and merge" authorizes Codex to
shepherd a PR through CI, reviews, conflicts and readiness **"without
intermediate approval prompts."** `CLAUDE.md` says the opposite: pushes and PR
creation are human-gated by design, and the human's OK lands at the outward
gates. PRs #102–#106 all landed under the looser rule, and six live defects came
with them. Worth an explicit keep-or-revert decision rather than adoption by
default.
