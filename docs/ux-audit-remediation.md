# UX audit and remediation brief

- Status: ready for implementation planning
- Audit date: 2026-07-21
- Audited commit: `915ccfac0d254e320cbe4317b98171494661770e`

## Purpose

This document records the code and rendered-UI findings from a whole-product UX
audit. It is a handoff for a later implementation pass. The goal is to remove
the seams left by feature-by-feature development without redesigning the core
product.

The app has a strong visual foundation. Gear and list tables are compact and
readable, destructive actions generally explain their effects, empty states
teach the next action, and Organize provides good drag announcements and an
explicit move menu. The highest-value work is concentrated at the boundaries
between the global shell, route-level headings, mobile action bars, and the
partially migrated Food surfaces.

## Audit method and limitations

The audit included:

- Route, component, state, responsive, and accessibility review in `src/`.
- Comparison with the design rules in `docs/ui-density.md`.
- Rendered checks in headless Google Chrome at desktop, phone, and 800 px tablet
  widths.
- Desktop and mobile sign-in, desktop and mobile Gear, mobile Lists, mobile list
  detail, mobile Organize, tablet Food, mobile Settings, and the public-share
  not-found state.
- Browser-level fixture responses for authenticated screens. No real session,
  user data, passkey, or magic-link token was accessed.

The DevTools connector was configured for `/usr/bin/chromium`, which does not
exist on the audit host. The installed executable is
`/usr/bin/google-chrome-stable`. Chrome was driven directly instead. Temporary
screenshots were written only under `/tmp` and were not added to the repo.

## Scorecard

| Pillar | Score | Summary |
| --- | ---: | --- |
| Copywriting | 3/4 | Usually clear and contextual; takeout and deletion copy has drifted from the feature set. |
| Visual consistency | 3/4 | The rendered core is cohesive; inconsistencies cluster in Food and Settings. |
| Color and state language | 3/4 | Neutral, active, warning, and destructive states are generally understandable. |
| Typography and hierarchy | 2/4 | Route identity is missing on several pages, especially on mobile. |
| Spacing and responsiveness | 2/4 | Tablet navigation, touch targets, and a few transplanted spacings remain unfinished. |
| Experience design | 2/4 | Navigation contracts, placeholder actions, and inaccessible interactions create avoidable friction. |
| **Overall** | **15/24** | A cohesive product with several high-impact integration seams. |

## Priority order

Implement in this order so later work builds on a stable shell and interaction
contract:

1. Route identity and responsive navigation.
2. Accessible search, menus, and reorder controls.
3. Mobile action-bar cleanup and destination consistency.
4. Responsive touch-target and Food visual migration.
5. Empty, loading, Settings, and row-action polish.

Each logical change should have focused tests and an atomic commit. Follow the
verification gate in `AGENTS.md` before claiming completion.

## P1: route identity and responsive navigation

### UX-01: restore visible and semantic page identity

Problem:

The current `AppShell` does not render a route heading, but several pages still
contain comments and layout decisions that assume the removed `NavBar` does.
The live mobile list-detail render had no visible `h1` or `h2`, and no list name.
Entering Organize abruptly restored both an eyebrow and the list-name `h1`.

Affected code:

- `src/layout/AppShell.tsx`
- `src/gear/GearLibraryPage.tsx`
- `src/lists/ListsPage.tsx`
- `src/lists/CurrentListHeader.tsx`
- `src/lists/ListDocumentToolbar.tsx`
- `src/lists/ListDetailPage.tsx`
- `src/lists/OrganizePackPanel.tsx`
- `src/food/FoodLibraryPage.tsx`
- `src/food/FoodPlansPage.tsx`

Recommended change:

- Make each route own one visible `h1`; do not restore route-specific state to
  the global shell.
- Show the current list name in edit, Pack, and Organize at every viewport.
- Keep the list name and mode controls in one consistent document header so a
  mode switch changes tools, not page identity.
- Give Gear, Foods, Plans, and Lists a compact route heading. Counts remain
  metadata, not substitutes for the heading.
- Delete or update comments that still claim `NavBar` supplies a heading.

Acceptance criteria:

- Every primary route has exactly one visible `h1`.
- Mobile list edit, Pack, and Organize all show the same list name in the same
  hierarchy.
- Changing list mode does not add or remove the route identity region.
- Heading tests use the real page components at mobile and desktop widths.
- A grep for the stale `NavBar` heading assumptions returns no remaining sites.

### UX-02: remove duplicate tablet navigation

Problem:

At widths from 768 through 1023 px, both navigation systems render:

- `AppShell` shows its desktop links at `md`.
- `MobileBottomBar` remains visible until `lg`.

The live 800 px Food render showed Gear, Lists, and Food in both the top header
and the fixed bottom bar.

Affected code:

- `src/layout/AppShell.tsx`
- `src/components/MobileBottomBar.tsx`
- `docs/ui-density.md`

Recommended change:

Use the existing below-`lg` touch-layout contract consistently. Change the
desktop primary navigation handoff to `lg` so exactly one primary navigation is
visible at a time. Review the email display at tablet width independently; it is
account metadata, not primary navigation.

Acceptance criteria:

- At 767, 768, 1023, and 1024 px, exactly one primary navigation is visible.
- Page-specific header actions and bottom-bar actions hand off at the same
  breakpoint.
- No route gains duplicate Add, Options, Gear, Lists, or Food controls.

### UX-03: make the Lists destination contract viewport-independent

Problem:

The desktop Lists link resumes `readLastListPath()`, including Pack or Organize,
while the mobile Lists link always opens `/lists`. The same label has different
results based on viewport.

Affected code:

- `src/layout/AppShell.tsx`
- `src/layout/mobile-nav-destinations.tsx`
- `src/lib/last-list-path.ts`

Recommended change:

Choose one contract and use it everywhere. The clearer default is for the
primary `Lists` destination to open the collection index, with any resume-last-
list behavior exposed separately and explicitly. If resume is retained, apply
it to both desktop and mobile and preserve an obvious path to the index.

Acceptance criteria:

- Tapping or clicking Lists has the same result at every viewport.
- The behavior is covered with and without a stored last-list path.
- A user can always reach the Lists index in one obvious action.

## P1: accessibility and interaction semantics

### UX-04: give every search field an accessible name

Problem:

Search inputs currently rely on placeholder text. Placeholders are hints, not
durable accessible labels.

Known sites:

- `src/gear/GearLibraryPage.tsx`
- `src/food/FoodLibraryPage.tsx`
- `src/food/EntryDialog.tsx`
- `src/lists/LibraryPanel.tsx`
- `src/lists/FoodPlanPicker.tsx`

Recommended change:

Add a real label, usually an `sr-only` label paired with a stable `id`. Keep the
placeholder for examples or scope where it adds value.

Acceptance criteria:

- Every `input[type="search"]` has a non-placeholder accessible name.
- Tests query search controls by role and name.

### UX-05: make reorder controls keyboard-operable

Problem:

Gear items, list items, categories, and list cards configure a `KeyboardSensor`
but remove their dedicated drag handles from the tab order with
`tabIndex={-1}`. Mobile rows receive pointer listeners without the corresponding
keyboard attributes. Organize is better because its dedicated handles remain
focusable and each item also has an explicit move menu.

Affected code:

- `src/gear/GearItemRow.tsx`
- `src/gear/CategorySection.tsx`
- `src/lists/SortableItemRow.tsx`
- `src/lists/list-card-sortable.tsx`
- `src/lists/PackingItemRow.tsx` as the reference behavior

Recommended change:

- Keep dedicated drag handles focusable and attach the complete dnd-kit
  attributes/listeners set to the focusable activator.
- Provide clear accessible labels that include the row or section name.
- Preserve normal touch scrolling and the existing delayed touch activation.
- Where a mobile row has no visible handle, provide an explicit reorder or move
  alternative instead of relying only on long press.

Acceptance criteria:

- A keyboard user can initiate, move, cancel, and finish every supported reorder.
- Focus remains understandable after a completed or canceled reorder.
- Pointer and touch behavior remains unchanged.
- Tests exercise the production activator, not only the reorder helper.

### UX-06: stop claiming incomplete ARIA menu behavior

Problem:

Many popovers use `role="menu"` and `role="menuitem"`, but the shared popover
hooks implement only outside dismissal, scroll/resize dismissal, and Escape.
They do not focus the menu on open or implement Arrow Up, Arrow Down, Home, End,
and roving tab behavior.

Affected code:

- `src/lib/use-anchored-menu.ts`
- `src/lib/use-portal-popover.ts`
- `src/components/RowMenuItem.tsx`
- Kebab and options call sites under `src/gear`, `src/lists`, and `src/food`

Recommended change:

Pick one application-wide contract:

- Implement the complete ARIA menu keyboard pattern in the shared primitive; or
- Remove menu/menuitem roles and expose these as ordinary grouped buttons.

The second option is simpler and honest unless arrow-key menus are a deliberate
product requirement. Preserve Escape dismissal and focus return.

Acceptance criteria:

- The announced semantics match the implemented keyboard behavior.
- Opening a popover gives keyboard users a predictable next focus target.
- Escape closes the surface and returns focus to its trigger.
- All menu-role call sites use the shared contract; no one-off partial menus remain.

## P2: mobile action bars and responsive controls

### UX-07: remove disabled placeholder actions from the mobile bar

Problem:

The generic mobile bar renders disabled Add and Options controls on routes where
they do nothing. `MobilePlanActionBar` deliberately reserves a disabled Options
slot for a future feature. Organize falls back to the generic bar, so entering
that mode replaces meaningful list actions with gray placeholders. The live
Settings and Organize renders made these placeholders visually prominent.

Affected code:

- `src/layout/MobilePrimaryNav.tsx`
- `src/food/MobilePlanActionBar.tsx`
- `src/lists/MobileListActionBar.tsx`
- `src/lists/ListDetailPage.tsx`
- `src/lists/OrganizePackPanel.tsx`

Recommended change:

- Render only meaningful actions. Do not expose future slots to users.
- Keep Gear, Lists, and Food as stable destinations.
- Let page-specific bars append only actions that work on that page.
- Keep the bar anatomy stable across list modes where the same list-scoped
  actions remain relevant.

Acceptance criteria:

- No visible bottom-bar control has an accessible label containing "no action".
- Settings and other non-editing routes show only working destinations.
- Organize has a deliberate bar contract rather than an accidental fallback.
- The number and order of controls are tested per route and mode.

### UX-08: finish the documented touch-target migration

Problem:

`docs/ui-density.md` records several `NOT YET APPLIED` decisions. The live 800
px Food render confirmed the most visible result: a touch-layout bottom bar is
paired with a dense desktop table whose edit and delete controls use the 28 by
24 px `RowIconButton` target.

Known work:

- Change `FoodLibraryPage` from the `useIsMobile()` handoff to the below-`lg`
  touch-layout contract.
- Replace `RowIconButton` on surfaces that render below `lg` with a responsive
  touch-safe control.
- Normalize the remaining modal and drawer close targets.
- Resolve the documented mobile category-header indentation mismatch.

Affected sources are enumerated in `docs/ui-density.md`; verify each current
call site before editing because the migration is partially complete.

Acceptance criteria:

- Interactive touch targets are at least 40 px in the below-`lg` presentation.
- Food uses its touch presentation through 1023 px.
- The desktop table remains dense at `lg` and above.
- The `NOT YET APPLIED` notes that were completed are removed or rewritten as
  descriptions of current behavior.

## P2: route and state polish

### UX-09: add a true Gear search-empty state

Problem:

Gear search filters only items, while the grouping function intentionally keeps
empty categories. A query with no matches therefore renders every category with
"No items" instead of one clear no-results message. Food already uses the
expected pattern.

Affected code:

- `src/gear/GearLibraryPage.tsx`
- Gear page tests

Recommended change:

When a non-empty search has zero matching items, suppress the category sections
and show `No gear matches "...".` Keep empty categories visible when no search is
active because they remain valid organization and add-item targets.

Acceptance criteria:

- No-match search shows one clear message.
- Clearing search restores empty categories and their existing affordances.
- Search behavior is tested separately from the truly empty library state.

### UX-10: normalize collection-row action vocabulary

Problem:

Gear and Lists primarily use kebab menus. Food Plans permanently exposes Copy
and destructive Trash controls on every row, and the Food editor uses several
inline destructive icons. The live Food tablet render made the action rail feel
like a separate UI family and compounded the touch-target issue.

Affected code:

- `src/food/FoodPlansPage.tsx`
- `src/food/FoodPlanEditor.tsx`
- Shared row-menu primitives

Recommended change:

- Use a common collection-index rule: the row opens the resource and a kebab
  contains secondary actions.
- Keep direct destructive controls only inside a clearly scoped editor where
  the entity and consequence are obvious.
- Preserve confirmations and existing destructive copy.

Acceptance criteria:

- Collection indexes use the same open-row plus secondary-actions pattern.
- Destructive actions are not visually dominant during ordinary scanning.
- Touch targets and accessible labels meet the shared standards.

### UX-11: normalize Settings cards and update scope copy

Problem:

`PasskeySection` brings `mt-8` and its own small heading into an already padded
card. The live mobile render showed substantially more blank space above
Passkeys than in the other Settings cards. The Download all data subtitle says
the archive contains only gear and list CSVs, while the implementation also
exports food, plans, target defaults, packing locations, and packing data.
Delete-account examples similarly omit food data.

Affected code:

- `src/settings/SettingsPage.tsx`
- `src/settings/PasskeySection.tsx`
- `src/settings/DownloadAllData.tsx`
- `src/settings/DeleteAccountSection.tsx`

Recommended change:

- Make Passkeys use the standard Settings `Section` title/subtitle treatment.
- Remove `PasskeySection`'s page-level outer margin.
- Describe the takeout as a complete archive, with concise examples rather than
  an incomplete exhaustive claim.
- Update deletion copy to name food and plans where examples are used.

Acceptance criteria:

- Settings cards share heading size, icon alignment, padding, and top spacing.
- Download and deletion copy matches the data paths in the implementation.
- Passkey unsupported, empty, loading, and populated states keep the same card
  hierarchy.

### UX-12: replace blank cold-load frames with a stable loading surface

Problem:

The initial session gate, authenticated lazy boundary, public-share lazy
boundary, and root redirect can all render `null`. Direct headless capture
confirmed a blank initial frame before a lazy public route settled. The settled
sign-in and public error states are clean; the weakness is the unexplained gap
before them.

Affected code:

- `src/App.tsx`
- `src/layout/RootRedirect.tsx`
- Existing `ListDetailStatus` patterns as possible reference

Recommended change:

Use a stable, minimal loading landmark that does not change the final page's
geometry. A centered brand/loading line or shell-sized placeholder is preferable
to an animated layout. Keep the anonymous bundle and lazy-loading performance
goals intact.

Acceptance criteria:

- Slow session and lazy-module loads never show an entirely blank document.
- Loading UI has `aria-busy` or an appropriate live/status semantic.
- The change does not introduce measurable layout shift.
- Signed-out visitors still do not download the authenticated application chunk.

## Preserve these strengths

Do not flatten the product while fixing its seams. Preserve:

- Dense desktop Gear and list tables.
- Touch-oriented mobile cards and rows.
- Organize's Unassigned-first layout, explicit move menu, and live announcements.
- Mode-specific URLs and last-path restoration unless UX-03 deliberately changes
  the navigation contract.
- Contextual destructive confirmations and clear account-deletion safeguards.
- The distinction between mode toggles, settings switches, row flags, and the
  unit segmented control documented in `docs/ui-density.md`.
- The anonymous bundle boundary for the public share view.

## Suggested implementation slices

### Slice A: shell and identity

UX-01, UX-02, and the decision in UX-03. Verify every route at phone, tablet,
and desktop widths before moving on.

### Slice B: shared accessibility primitives

UX-04, UX-05, and UX-06. Fix shared primitives first, then grep and migrate
every caller. Include keyboard-driven component tests.

### Slice C: mobile actions and responsive migration

UX-07 and UX-08. Treat 768 through 1023 px as a first-class touch viewport in
tests rather than checking only phone and desktop.

### Slice D: polish and copy

UX-09 through UX-12. Keep behavior changes separate from purely visual or copy
commits where practical.

## Verification checklist

For each slice:

1. Write or update tests before implementation when behavior is changing.
2. Check 390, 767, 768, 800, 1023, 1024, and 1440 px layouts.
3. Exercise keyboard-only navigation, popovers, dialogs, and reorder paths.
4. Exercise touch scrolling near drag-enabled rows.
5. Inspect accessible names and the heading outline.
6. Grep for all migrated call sites and stale comments.
7. Run the exact project gates from `AGENTS.md`, including `npm run build` and
   `npm run test:unit`; use CI for API tests if the local environment cannot run
   them.
8. Review the complete diff for unintended density, navigation, or authorization
   changes before committing.
