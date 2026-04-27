# grampacker code standards

Reference doc for what good code looks like in this app. Opinionated. Concrete.
This is descriptive of what we already do well plus a few aspirations clearly
labelled. It is not a generic style guide.

Stack: React 19 + TypeScript + Vite (Rolldown) + Tailwind v4 + Supabase
(`@supabase/supabase-js` 2.x, RLS as the security boundary) + TanStack Query 5,
deployed as a static SPA / future PWA on Cloudflare Pages.

---

## 1. Component patterns

### When to extract a component

Extract when one of these is true:

- The JSX block has its own non-trivial state or effects (e.g. `InlineText`,
  `PrivacyButton`, `ListsBoxRow`).
- The block is reused in more than one place (e.g. `TypedConfirmDialog`,
  `PanelCard`).
- The block is a clear noun in the domain (e.g. `WeightTable`, `LibraryPanel`,
  `ListItemRow`).

Inline a sub-element when it's only used once and has no state — small JSX
helpers that just rearrange props (e.g. `Stat`, `MenuItem`, `TabBtn`) live
inside the same file.

### Composition over configuration

When a component's variants would be expressed as more than ~3 boolean props,
reach for `children` or render-prop-style slots instead. Examples we already do
well:

- `PanelCard({ title, children })` — header strip + body slot. Used by Notes
  editor and WeightTable.
- `ListCategoryGroup({ ..., dragHandle? })` — caller passes a pre-bound DnD
  handle; group doesn't need to know about `useSortable`. Sortable and
  non-sortable variants share the same body.

Avoid prop explosions like `showEditButton`, `showDeleteButton`,
`showCheckmark`. Switch to slots or two siblings sharing an inner.

### Dialogs

- Render from state, never imperatively. The parent owns
  `dialog: DialogState | null` (a discriminated union) and the dialog component
  is a regular React component conditioned on that state.
- Always include `onClose` and `onConfirm` (or `onSubmit`) callbacks. The dialog
  manages its own draft state (`useState`); the parent owns the persisted
  state.
- Confirmation flows for destructive actions go through `ConfirmDialog` (simple
  yes/no) or `TypedConfirmDialog` (must type a phrase). Pick the second when the
  action is non-recoverable (delete account, delete gear item).

### List rows

Every list-row component (gear row, list-item row, library panel row,
ListsBoxRow) follows the same shape:

- A flex container with `gap-1.5` between cells.
- A `flex-1 min-w-0` left region for name + description.
- Right-aligned, fixed-width cells for numerical columns (`w-7`, `w-12`, `w-16`)
  using `tabular-nums` so they line up vertically across rows.
- Row-level actions that are destructive or always-on go in the flow.
  Hover-only actions overlay via `absolute` + `pointer-events-none` on a
  wrapper, with a gradient fade matching the row's hover background so text
  doesn't bleed through.

If a row needs to align with a header / footer (column labels, totals),
duplicate the same fixed-width spacer cells in the header / footer. Do not
rely on flex auto-sizing — it drifts as content varies.

### Forms

- Inline single-field edits use [`InlineText`](src/components/InlineText.tsx).
  Click → input, Enter saves, blur saves, Escape cancels.
- Multi-field forms render in a card or modal. Each field is a label + input
  pair, with `maxLength` mirroring the database `check (char_length …)`.
- Forms submit via `<form onSubmit={...}>` even inside modals — gives Enter +
  HTML validation behavior for free.

---

## 2. TypeScript usage

### `type` vs `interface`

Default to `type` for everything. Use `interface` only when (a) you literally
need declaration merging for a third-party library or (b) you are building a
public class-based API (we don't).

Reasons:

- Discriminated unions and conditional types only work with `type`. Several of
  ours (`DialogState`, `Mode`, `WeightUnit`) rely on this.
- `type` prevents accidental same-name merging across files.
- One mental model. We picked it; stick to it.

### Discriminated unions for state with variants

Anywhere a piece of state has variants where each variant has different
associated data, use a discriminated union with a `type` discriminant:

```ts
type DialogState =
  | { type: 'create-item'; categoryId?: string | null }
  | { type: 'edit-item'; item: GearItem }
  | { type: 'delete-category'; category: Category }
  | { type: 'bulk-move' }
```

Never use `{ kind?: 'create' | 'edit'; item?: ...; category?: ... }`. That's the
"optional fields that only make sense in some states" anti-pattern.

When narrowing, check the discriminant on the original object before
destructuring; destructuring before the check loses the narrowed type:

```ts
// good
if (dialog?.type === 'edit-item') {
  const { item } = dialog
  ...
}
```

### Supabase types

We hand-type the database shape in [`src/lib/types.ts`](src/lib/types.ts).
Authoritative. The types must mirror the migrations exactly:

- Nullability matches the column.
- IDs are `string` (uuid).
- Timestamps are `string` (ISO from Postgres).

When a migration changes a column, update `lib/types.ts` in the same commit.
This is a known maintenance cost we accept for now.

**Aspirational**: switch to `supabase gen types typescript` and import the
`Database` type. That eliminates drift but adds a build step and friction
during early-stage schema churn. Defer until the schema is stable.

### `any` and `unknown`

`any` is never acceptable in our code. Use `unknown` and narrow.
Two limited exceptions:

1. Casts at the dnd-kit boundary where the upstream types are awkward
   (`setActivatorNodeRef as unknown as (node: HTMLButtonElement | null) => void`).
   Comment why.
2. Deserialized `JSON.parse` results — type as `unknown`, then validate.

### Function param shapes

When a function takes more than two scalar args, group them into an object.
Mutations especially:

```ts
// good
mutationFn: ({ id, patch }: { id: string; patch: ... }) => updateGearItem(id, patch)
```

---

## 3. State management

### Server state goes through TanStack Query

If it lives in Postgres, it goes through `useQuery` / `useMutation`. No
ad-hoc `useEffect` + `setState` fetch chains. No `useState` initialized from
a fetch.

### Cache keys

Keys are tuples in `queryKeys` (see [`src/lib/queries.ts`](src/lib/queries.ts)):

```ts
export const queryKeys = {
  categories: () => ['categories'] as const,
  gearItems: () => ['gear-items'] as const,
  lists: () => ['lists'] as const,
  listItems: (listId: string) => ['list-items', listId] as const,
}
```

Rules:

- Always use the helpers — never hand-write a tuple at a call site.
- The first segment is the table or domain noun.
- Subsequent segments are scope (the listId for `list-items`).
- This lets `invalidateQueries({ queryKey: ['list-items'] })` invalidate every
  list's items at once (we use this when a gear item changes name and may
  appear in many lists).

### Invalidation pattern

After a mutation, invalidate every cache that could include the mutated row.
Concretely:

- `updateGearItem` → invalidate `gear-items` AND `['list-items']` prefix
  (list items embed gear via join).
- `deleteGearItem` → same.
- `addGearItemToList` / `deleteListItem` → invalidate the active
  `listItems(listId)` only.
- Anything that creates a new list row → invalidate `lists`, and if you
  navigate to it, the destination's `listItems(id)` too.

### Optimistic updates

Use sparingly — only for actions where the perceived latency matters and
correctness can be reconciled by a refetch. Currently:

- DnD reorder (categories, lists, list items): set `queryData` immediately
  with the new order, then mutate.
- Privacy / mode / unit toggles: don't bother; the round-trip is fast enough.

When you do optimistic updates, follow the canonical pattern:

1. `cancelQueries` so an in-flight refetch can't overwrite us.
2. `setQueryData` with the new shape.
3. Snapshot the old data and return it as context for rollback.
4. `onError` rolls back from context.
5. `onSettled` invalidates so the server is the source of truth.

We currently skip 1 / 3 / 4 in some places; if we add a flaky network or a
slow mutation, add them.

### Error handling on mutations

Every `useMutation` should have a story for failure. Today's options:

- Silent failure with `console.error` is acceptable for low-stakes background
  ops (e.g. reorder).
- For user-initiated actions where the user expects a result, render a visible
  error. We don't yet have a toast system; until we do, in-dialog `text-red-600`
  inline messages are acceptable. `window.alert` is duct tape — don't use it
  in committed code.

### Client state

- Local component state is the default. `useState` first.
- Lift state up only when two siblings need it. The first place that owns
  both is the right home.
- `useContext` is reserved for genuinely app-wide concerns (`AuthProvider`).
  Don't reach for context to "avoid prop drilling" two levels.

### Persisted client preferences

`localStorage` is fine for genuinely user-machine-local preferences:

- `weightUnit` ([`lib/weight.ts`](src/lib/weight.ts))
- last-viewed list id ([`lists/ListDetailPage.tsx`](src/lists/ListDetailPage.tsx))

Namespace keys with `grampacker:` to avoid collisions if we ever add a
sibling app. Read once at mount, write on change.

---

## 4. Supabase patterns

### RLS is the security boundary

We never filter by `user_id` in client queries. RLS does that. If a query is
returning the wrong rows, the bug is in the policy, not the SELECT.

- Every table that holds user data has RLS enabled.
- Every table has at minimum an `owner_all` policy:
  `using (auth.uid() = user_id) with check (auth.uid() = user_id)`.
- Public read paths (the share page) are explicit `_public_select_*` policies
  with their own predicate (`is_shared = true`, or chained joins to a shared
  list). Never `for select using (true)`.
- Indexes on every column referenced by an RLS policy. Missing indexes are
  the most common Supabase performance footgun.

### Multi-table operations

Supabase doesn't expose client-side transactions. For operations that touch
multiple tables atomically, two patterns:

1. **Sequential awaits with FK cascade as the consistency net.** OK when a
   partial failure leaves a recoverable state. Example:
   `createListFromSelection` inserts the list first, then list_items;
   if list_items fails the user gets an empty list, not a corrupt one.
2. **RPC functions (`security definer`) for true atomicity or privileged
   operations.** Used for `delete_account`. Use this when (a) the operation
   crosses ownership boundaries or (b) an intermediate failure would corrupt.
   Always `revoke from public, anon` and `grant execute to authenticated`.

### Foreign key semantics matter

Choose `on delete cascade` when downstream rows are meaningless without the
parent (gear_item → list_items: a list line item is meaningless without the
gear it references). Choose `on delete set null` only if you have a UI story
for the orphaned row. We learned this the hard way — see the audit for
`list_items.gear_item_id`.

### Migrations

- One file per logical change in `supabase/migrations/`. Filename prefix is
  `YYYYMMDDHHMMSS_description.sql`.
- Never edit a previously-applied migration. Add a new one that adjusts.
- Test the migration in the Supabase SQL editor before committing — but the
  migration file itself is the source of truth, not whatever you typed
  ad-hoc.
- When a migration alters the schema, update `src/lib/types.ts` and any
  affected query / insert in the same commit.

### Embedded selects

Prefer the embedded-select join for related rows that always render together:

```ts
.select('*, gear_item:gear_items(id, name, description, weight_grams, category_id)')
```

This collapses two round-trips to one and the related data lives on the
parent's React Query cache entry. Define the joined shape on the type
(`ListItemWithGear`) so consumers don't need to widen.

---

## 5. Performance

### React Compiler / memoization

We are on React 19. The Compiler covers most "should I memoize?" cases at
build time. **Default to writing readable, dependency-honest code** and
trust the compiler. Reach for `useMemo` / `useCallback` only when:

- A third-party API depends on referential stability (e.g. dnd-kit
  `useSortable` with derived `items`, or `effect` deps with non-trivial
  shape).
- You've measured a real render hot spot.

Premature memoization is the bigger problem in this codebase right now, not
missing memoization.

### Avoid render-time computation that should be cached

Things like `[...categories].sort(...)` inside the render body of a parent
that re-renders every keystroke are fine for our list sizes (≤300). They
become a smell when:

- The computation is O(n²) or hits a network.
- The result is used as a dependency for something else (changing identity
  → cascading re-runs).

When in doubt, profile. Don't pre-emptively wrap things.

### List rendering

- Always provide a stable `key`. Database `id` is the right key.
  Index-as-key is wrong unless the list is static and has no items being
  added / removed / reordered.
- We don't currently virtualize. With our 300-item-per-list cap and
  ~hundreds of gear items, we don't need to. If a user hits 500+ items in
  one rendered list, revisit with `@tanstack/react-virtual`.

### Query batching

`useQueries` exists but we haven't needed it. If you find yourself calling
two queries that always render together and have the same lifetime, prefer
either an embedded join (one round-trip) or `useQueries` (parallel) over
two `useQuery` hooks that gate each other via `enabled`.

---

## 6. File and folder organization

We organize by feature, with a small set of cross-cutting layers:

```
src/
  auth/        AuthProvider, login & signup pages
  gear/        Gear library page + its row / category / dialog components
  lists/       Lists, list detail, packing, share page, library panel/sheet
  settings/    Settings page (account, data, danger zone)
  components/  Cross-feature reusable UI (InlineText, ConfirmDialog,
               TypedConfirmDialog)
  layout/      AppShell, NavBar
  lib/         Pure modules: types, queries, supabase client, csv, weight,
               share-token
```

Rules:

- A component lives in the **feature folder it primarily serves**. If it
  starts being imported from a different feature, move it to `components/`.
- `lib/` is for pure or mostly-pure modules. Anything that imports React
  doesn't belong here. (Exception today: `queries.ts` is pure of React but
  imports the Supabase client; that's acceptable because it's the
  data-access layer.)
- Hooks go next to the component that owns them, or in `lib/` if shared.
  We don't have a `hooks/` folder yet; create one when we have ≥2 shared
  hooks.

Naming:

- Components: `PascalCase.tsx`, default export named the same as the file.
- Modules in `lib/`: `kebab-case.ts` (`share-token.ts`) for multi-word,
  single-word otherwise (`weight.ts`, `csv.ts`).
- Migration files: `YYYYMMDDHHMMSS_lowercase_with_underscores.sql`.
- LocalStorage keys: `grampacker:<scope>`.

---

## 7. Error handling

### Categories

- **Query errors.** TanStack Query exposes `error` from `useQuery`. For most
  reads we don't render anything special — the data either arrived or the
  user sees a loading state. If a query is critical to the page, render
  inline error UI from `error`.
- **Mutation errors.** Show inline. Disable the offending button while the
  mutation is `isPending`. Don't navigate or close a dialog until
  `onSuccess`.
- **Validation errors.** Catch on the form before submitting, render
  inline next to the field.

### Where to render

- Inline (next to the field or button) for actionable errors.
- A modal banner / inline card for blocking errors (e.g. cap exceeded).
- Toast for non-blocking confirmations and reversible failures —
  **aspirational**: we don't have a toast system yet; introduce when needed.

### Error boundaries

We don't have one. Add a top-level error boundary in `AppShell` when we
have a real story for "the app blew up, here's a reset button." For now,
unhandled render errors fall through to React's default behavior, which is
acceptable for early-stage development.

### Anti-patterns

- `window.alert` for diagnostic / production errors.
- Swallowing errors silently with no logging.
- `try { ... } catch {}` with an empty catch.

---

## 8. Accessibility baseline

### Keyboard

- Every interactive element is a `<button>` or `<a>`, never a clickable
  `<div>`. Where a row IS the click target (e.g. library panel rows), it
  should also be reachable by keyboard — currently a known gap; flag
  during audit.
- Tab order follows visual order. Don't reorder with `tabIndex` unless
  necessary; if you do, document why.
- `Escape` closes dialogs. `Enter` commits inline edits. Forms submit on
  Enter via `<form onSubmit>`.

### Focus management

- Open a modal → focus the first interactive element (input for forms,
  Cancel for destructive confirms).
- Close a modal → return focus to the element that opened it (we don't do
  this consistently; flag during audit).
- Inline edit on click → focus and `select()` the input.

### ARIA

- Use the role implicit in semantic HTML. `<button>`, `<dialog>`,
  `<input type="...">` already carry the right roles.
- For dialogs, prefer the native `<dialog>` element going forward — focus
  trap, top-layer rendering, scroll lock are built in. We currently use a
  custom `fixed inset-0` overlay; that's fine but has gaps (no focus trap,
  no `aria-modal`).
- When an icon button has no visible label, give it a `title` and
  `aria-label`.

### Color and contrast

- Tailwind `gray-400` text on `gray-50` backgrounds is borderline; for
  dim-but-readable use `gray-500` minimum on white.
- Destructive actions: `red-600` text or background, never lighter than
  `red-500`.
- Active selection / hover states must remain distinguishable with
  Windows high-contrast mode (we haven't tested; flag).

---

## 9. Tailwind / styling

- Tailwind v4 with the CSS-native `@import "tailwindcss"` config in
  `src/index.css`. No `tailwind.config.js`.
- Row spacing and column widths are part of the data model — see the list
  view's `gap-1.5` + `w-7 / w-12 / w-16` cell widths shared across row,
  header, and footer. Treat these as constants; if you change one, change
  every site that aligns with it.
- Avoid arbitrary values (`text-[10px]`, `w-[180px]`) when a token works.
  When a one-off is needed, leave a comment.
- Conditional classes: prefer template strings with ternaries over
  `clsx` / `cn` until we have ≥3 conditions to combine. Then introduce a
  helper.

---

## 10. PWA / Cloudflare Pages

We're an SPA today. The PWA story is minimal and mostly aspirational:

- Cloudflare Pages serves a static build. SPA fallback to `index.html`.
- A future service worker should use `vite-plugin-pwa` with Workbox. Use
  `stale-while-revalidate` for app shell, `network-only` for Supabase API
  calls, and `cache-first` for hashed assets.
- Service-worker scope must be set so the registration script is itself
  served with no-cache headers, otherwise a stuck SW will pin an old
  version.

Defer SW work until offline support is a real product requirement. A broken
SW is worse than no SW.

---

## 11. Anti-patterns to flag in audit

This is the "duct tape and bubble gum" list for our stack. If you see any
of these, file it as a finding:

1. `useEffect` to derive state from props or other state. Compute it during
   render; if it's expensive, `useMemo`.
2. `useEffect` chains where one effect's output becomes another's input.
3. `useState` initialized from `localStorage` outside a lazy initializer
   (causes flash on every mount).
4. Ad-hoc `fetch` calls bypassing TanStack Query.
5. Mutating state directly: `array.push(...)` then `setState(array)`.
6. Filtering or sorting an entire query result inside an event handler
   instead of a derived value.
7. `.filter(Boolean)` typed as `T[]` when it should be the narrowed
   non-null type — TS sometimes can't narrow this; use a proper type
   predicate.
8. `setTimeout` with magic numbers to "wait for state to settle." Almost
   always a bug or a missing dependency.
9. Inserting into a Supabase table without `select().single()` when you
   need the inserted row's id (you'll silently get nothing back and
   downstream code breaks).
10. Forgetting `with check` on RLS INSERT / UPDATE policies (allows users
    to write rows they can't read back).
11. Treating two columns as the source of truth for the same data
    (we did this with `list_items.weight_grams` mirroring `gear_items.weight_grams`,
    creating "out of sync" bugs — single source of truth wins).
12. Snapshot fields that aren't actually required for history. If the join
    gives you what you need, drop the snapshot.
13. Hand-rolled icon buttons without `title` / `aria-label`.
14. Disabled buttons without a tooltip explaining why.
15. Render-time computation that touches the date/time (`new Date()`)
    used as a key — causes infinite re-renders.
16. `console.log` left in committed code. `console.error` for genuine
    failures only.
17. Empty `catch` blocks.
18. `window.alert` / `confirm` / `prompt` in committed code.
19. Inline styles when a Tailwind utility would do.
20. Multi-screen-tall components. If a component is over ~400 lines,
    look for a sub-component begging to come out.

---

## Tensions between this doc and current state

The audit will surface where reality diverges. Known up front:

- `ListDetailPage.tsx` is well over 400 lines. It's the orchestration root
  for the entire list-detail experience and pulling pieces out has been
  done iteratively (PanelCard, NotesEditor, AddItemRow, PrivacyButton,
  ListCategoryGroup). Further extraction is welcome but isn't urgent.
- We hand-type Supabase rows instead of generating. Documented above.
- No toast system. Some places use `window.alert` (now removed). Some use
  inline error boxes. Both are acceptable bridges; pick one and add a
  proper toast when we have time.
- No focus restore on dialog close. Documented above.
- No service worker / offline support. Documented above.
- No error boundary. Documented above.

These are not violations to fix in the audit. They are conscious gaps that
would each be their own project.

---

Sources consulted while writing this doc:

- [TanStack Query v5 — Optimistic Updates](https://tanstack.com/query/v5/docs/react/guides/optimistic-updates)
- [TanStack Query v5 — Query Invalidation](https://tanstack.com/query/v5/docs/react/guides/query-invalidation)
- [React 19 release notes](https://react.dev/blog/2024/12/05/react-19)
- [React Compiler introduction](https://react.dev/learn/react-compiler/introduction)
- [Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase RLS production patterns (Makerkit)](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)
- [TypeScript handbook — discriminated unions](https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html)
- [Accessible modal dialogs (UXPin, 2026)](https://www.uxpin.com/studio/blog/how-to-build-accessible-modals-with-focus-traps/)
- [Vite PWA plugin guide](https://vite-pwa-org.netlify.app/guide/service-worker-precache)
