# Organize Pack: design

Status: SHIPPED 2026-07-20 (rev 6 baseline). DATED RECORD - not binding.
Organize has since been ABSORBED INTO PACK; the peer view this describes no
longer exists (see src/lists/list-detail-mode.ts).

> **Post-launch route amendment (2026-07-20):** Organize is now a peer list
> mode at `/lists/:id/organize`, alongside List (`/lists/:id`) and Pack
> (`/lists/:id/pack`). ~~Pack and Organize are persistent pill toggles on the
> list page; clicking the active mode returns to List, and clicking the other
> switches directly.~~ The original `/pack/organize` route redirects to the
> canonical peer route, and last-list restoration persists `/organize`. This
> user-requested amendment supersedes only the route, entry-point, and
> persistence decisions below; it did not otherwise change the original
> packing-location contract. The later item-backed amendment below does.

> **List-view navigation amendment (2026-07-22):** The two toggles are
> superseded by three direct route links: List, Organize, and Pack. Every view
> is visible and one activation away; the active link uses `aria-current` and
> no longer doubles as a hidden "return to List" action. Browser titles include
> the active view while the visible heading remains the stable list name.

> **Item-backed container amendment (2026-07-21):** A packing location may
> optionally be backed by one membership row on the same list. Its displayed
> name follows that item's live gear name. The source remains a normal list
> item in storage and packing progress, but promotion transforms its UI: the
> item becomes the single visible container header instead of also appearing
> as a row in its parent. Its Ready/Packed controls remain on that header in
> Pack mode. Item-backed containers nest under the location containing their
> source item; self-links and nesting cycles are rejected. Removing the source
> or stopping its container role unassigns the contents without deleting them.
> Name-only locations remain supported for physical places that are not gear
> items.

> **Organize/Pack merge amendment (2026-07-29, PR #124):** Organize is no
> longer a mode. Pack is the single location-organized view: it both arranges
> and checks off, and it carries the section chrome Organize used to own.
> `/lists/:id/organize` and `/lists/:id/pack/organize` redirect to
> `/lists/:id/pack`, and a stored `/organize` path migrates on read.
> Consequently `OrganizePackPanel.tsx`, `LocationSection.tsx` and
> `PackingItemRow.tsx` **no longer exist**; every reference to them below is
> historical. Their replacements invert the rev-5 decision recorded at "rev 5:
> `LocationSection` renders its own header": a packing-location section IS a
> `CategoryGroup` now, and its drag/admin chrome arrives through the
> `headerLeading` / `headerAction` / `titleContent` / `renderRowAction`
> ReactNode seams, which is what keeps `@dnd-kit` and authenticated modules
> off the public share path. The chrome itself lives in
> `SortablePackSection.tsx` and `PackLocationSection.tsx`.

Five GATE 1 adversarial passes drove this from BLOCK to clean. The rev-5 review
confirmed **M5 fixed (all nine literal POST_CHECKS verified to pass against the
real harness and fixtures), the count seam fixed, and zero regressions across the
other eight findings**, leaving only two items, both now closed in rev 6:

- **`packing.json` fully self-contained (was B3):** rev 5's `gearItemId` still
  dangled (the gear CSV omits `GearItem.id`, `csv/gear.ts:46`). It now
  denormalizes identifying names — `list: {id,name}`, item `gearItem: {id,name}` —
  so every reference resolves inside the JSON (5).
- **File-inventory nit:** `CategoryGroup.tsx` needs no change; `regionKey` is
  caller-supplied by `ListDetailPage` (9).

All earlier corrections remain in force: parent-immutability trigger (2.3);
literal POST_CHECKS proving column/indexes/three triggers/cap (5); CSRF on writes
only, GET exempt (3, 6); worn always extracted into a trailing section (4.5);
conditional assignment gate allows unassign (3); last-success grouping switch
(4.4); `hasListItemEdits` learns the field (4.8); atomic delete `RETURNING` (2.4);
trigger tests bypass the repo gate (6); `LocationSection` owns Organize's header
(4.3, 4.6).

The two rev-6 fixes are mechanical (a JSON shape and a file-list line); they were
not re-run through GATE 1. GATE 2 (adversarial review of the actual diff) still
applies to every implementation phase.

Packing locations are a **per-list** organization layer for Pack Mode. Gear
categories say what a thing *is*; packing locations say where it *goes on this
trip*. The two never merge, and categories are not touched by this feature.

---

## 1. Current architecture (what this has to fit into)

**Pack Mode is a route, not a state.** `AuthenticatedApp.tsx:50-51` mounts
`ListDetailPage` at both `lists/:id` and `lists/:id/pack`;
`ListDetailPage.tsx:245-249` derives `Mode = 'edit' | 'pack'` from
`location.pathname`. Toggling is a `navigate()`.

**Grouping is client-side.** `GET /api/lists/:id/items` returns a flat array
(`repos/list-items.ts:128-133`). `useGroupedListItems` (`ListDetailPage.tsx:602`)
calls `groupListItemsByCategory` (`grouping.ts:142`).

**Ready / Packed are two boolean columns** on `list_items`
(`app-schema.ts:215-257`), toggled through `PATCH /api/lists/:id/items/:itemId`
with a **field-scoped** optimistic write (`use-list-item-actions.ts:104-141`)
that snapshots only the keys in the patch, so concurrent Packed+Ready patches
compose. Adding a third patchable field is the grain of this hook.

**Reorder has a house pattern.** `useReorderable` (`use-reorderable.ts:150`)
owns its own `useQuery`, because prop-drilling the sortable array splits the
drop transition and the cache write into two commits and the row visibly snaps
back (`use-reorderable.ts:22-43`). Sensors are always `MouseSensor +
TouchSensor + KeyboardSensor`, never `PointerSensor`.

**Ownership is structural.** `reposForUser` (`repos/index.ts`) is the only
constructor; every repo method closes over `userId`. Parent-child routes call
`ownsList()` (`repos/list-items.ts:98-105`). Bulk-id operations use owned-set
membership in JS, never an unbounded `inArray`, because of D1's 100-param cap.

### Five existing invariants this feature can break

1. **`listItemsArrayEqual` has an explicit field list** (`grouping.ts:100-121`).
   It backs `React.memo` reference reuse. A new rendered per-item field that is
   not added here produces a stale UI with green tests.

2. **`useGroupedListItems` is a *second*, independent stability mechanism**
   (`use-grouped-list-items.ts:20`) — it retains the prior result and feeds it
   back as `prior` on every render. **[rev 2]** Without an equivalent for
   location grouping, `prior` is never supplied, the comparator is never
   consulted, and every render mints new group arrays. Fixing the comparator
   alone is necessary but not sufficient.

3. **`share-path-imports.test.ts` fails the build if `@dnd-kit` appears in
   SharePage's import graph** — statically, via re-export, or via `lazy()`.

4. **`toSharedListResponse` (`routes/shares.ts:34-63`) is the runtime response
   allowlist**, guarded by `FORBIDDEN_KEYS` asserted absent at any depth.

5. **Worn items are extracted out of every group** into one trailing
   Worn section. Grouping runs first; ordinary category/location sections
   filter worn rows while the stable Worn selector collects them from the
   grouped result (4.5).

---

## 2. Data model

### 2.1 `packing_locations`

```sql
CREATE TABLE `packing_locations` (
  `id`         text PRIMARY KEY NOT NULL,
  `user_id`    text NOT NULL,
  `list_id`    text NOT NULL,
  `name`       text NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`list_id`,`user_id`) REFERENCES `lists`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT "packing_locations_name_length" CHECK(length("packing_locations"."name") between 1 and 60)
);
CREATE UNIQUE INDEX `packing_locations_id_user_unique` ON `packing_locations` (`id`,`user_id`);
CREATE UNIQUE INDEX `packing_locations_id_list_user_unique` ON `packing_locations` (`id`,`list_id`,`user_id`);
CREATE INDEX `packing_locations_list_sort_idx` ON `packing_locations` (`list_id`,`sort_order`);

CREATE TRIGGER `packing_locations_list_cap`
BEFORE INSERT ON `packing_locations`
WHEN (SELECT count(*) FROM `packing_locations` WHERE `list_id` = NEW.`list_id`) >= 30
BEGIN
  SELECT RAISE(ABORT, 'packing location cap exceeded (30 per list)');
END;
```

Cap enforced by trigger, matching the house pattern;
`isTriggerAbort(err, 'packing location cap exceeded')` maps it to 422. Keep the
message string in lockstep with the matcher.

**No unique-name constraint**, deliberately: `categories` has none either
(`0003_gear.sql` has only a length CHECK).

### 2.2 The assignment column

```sql
ALTER TABLE `list_items`
  ADD COLUMN `packing_location_id` text
  REFERENCES `packing_locations`(`id`) ON DELETE SET NULL;
CREATE INDEX `list_items_packing_location_idx` ON `list_items` (`packing_location_id`);
```

The assignment lives on `list_items`, not `gear_items` — the same tarp is in
the bear canister on one trip and the mesh pocket on another. Zero-or-one is a
nullable column; NULL *is* Unassigned.

**Why a single-column FK.** Two mechanical reasons:

- SQLite's `ALTER TABLE ADD COLUMN` cannot add a table-level (composite)
  constraint. A composite FK would require a full `list_items` rebuild, and
  `0013_gear-weight-real.sql` documents how that goes wrong: dropping the table
  cascades and wipes membership rows, the `(id, user_id)` unique index must
  exist before the restore or the FK errors "foreign key mismatch", and drizzle
  silently drops the cap triggers.
- SQLite's `ON DELETE SET NULL` nulls **every** column of the child key. With a
  composite `(packing_location_id, user_id)` child key and `user_id NOT NULL`,
  the parent delete fails outright. The composite form is not merely expensive
  here, it is wrong.

**Verified on SQLite 3.53.3, not reasoned about:**

| Probe | Result |
|---|---|
| Composite child key + `ON DELETE SET NULL`, `user_id NOT NULL`, delete parent | `Error: NOT NULL constraint failed: itm.user_id` — the delete **fails** |
| `ALTER TABLE ADD COLUMN ... REFERENCES ... ON DELETE SET NULL` | Accepted |
| Delete parent with `PRAGMA foreign_keys=ON` | Child nulled correctly |
| Same delete with `PRAGMA foreign_keys=OFF` | Child **keeps a dangling id**, silently |

### 2.3 Structural same-owner enforcement, without a rebuild **[rev 2]**

Rev 1 rested cross-list/cross-user safety entirely on an application-layer gate
in one route. That is weaker than every neighbouring relationship, which
enforces ownership structurally with composite keys (`app-schema.ts:241`). A
future repo method, a migration, or a duplication bug could write an item on
list A pointing at a location on list B.

The fix keeps the single-column FK (needed for `SET NULL`) and adds the
invariant back as **triggers**, which `ALTER TABLE` *can* deliver:

```sql
CREATE TRIGGER `list_items_location_same_list_insert`
BEFORE INSERT ON `list_items`
WHEN NEW.`packing_location_id` IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM `packing_locations`
                  WHERE `id` = NEW.`packing_location_id`
                    AND `list_id` = NEW.`list_id`
                    AND `user_id` = NEW.`user_id`)
BEGIN
  SELECT RAISE(ABORT, 'packing location does not belong to this list');
END;

CREATE TRIGGER `list_items_location_same_list_update`
BEFORE UPDATE OF `packing_location_id`, `list_id`, `user_id` ON `list_items`
WHEN NEW.`packing_location_id` IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM `packing_locations`
                  WHERE `id` = NEW.`packing_location_id`
                    AND `list_id` = NEW.`list_id`
                    AND `user_id` = NEW.`user_id`)
BEGIN
  SELECT RAISE(ABORT, 'packing location does not belong to this list');
END;

-- [rev 4] Parent side: a location's owning list and user are immutable.
CREATE TRIGGER `packing_locations_owner_immutable`
BEFORE UPDATE OF `list_id`, `user_id` ON `packing_locations`
WHEN NEW.`list_id` <> OLD.`list_id` OR NEW.`user_id` <> OLD.`user_id`
BEGIN
  SELECT RAISE(ABORT, 'packing location cannot change list or owner');
END;
```

**[rev 3] The `UPDATE OF` column list must include every column the child-side
invariant reads, not just `packing_location_id`.** SQLite decides whether a
`BEFORE UPDATE OF x` trigger fires purely from the columns named in the `SET`
clause. Rev 2 named only `packing_location_id`, so `UPDATE list_items SET list_id
= 'list-b' WHERE ...` — moving an *already-assigned* item to another of the same
user's lists — left the trigger dormant and produced a row `(list-b,
loc-on-list-a)`. Codex reproduced exactly that on SQLite 3.53.3. Naming all three
columns the `WHEN` subquery reads closes the hole while still skipping the common
`is_packed` / `is_ready` toggles. The `WHEN` short-circuits on
`packing_location_id IS NULL`, so an unassigned row never runs the subquery.

**[rev 4] The child triggers only guard mutations of the child row. The parent
side is a second hole.** Nothing above stops `UPDATE packing_locations SET
list_id = 'list-b'`: the item keeps pointing at the same still-valid id while the
location moves to another list or owner, and the child trigger never fires
(Codex reproduced `(item.list_id=A, location.list_id=B)`). Because a location has
**no product reason ever to change lists or owner** — the API exposes only rename
and reorder — the fix is to forbid re-parenting structurally with the
`packing_locations_owner_immutable` trigger above. This is stronger and simpler
than "reject a move that would orphan a row": ownership is now immutable by
construction. Tests drive direct SQL updates of `packing_locations.list_id` and
`.user_id` and assert the abort, plus the three child-column updates on an
assigned row.

Now "an item can only point at a location on its own list, owned by the same
user" is a database invariant from both sides, not a route-level promise. The API
gate in section 3 stays — it produces a clean 400 instead of a 500 — but it is no
longer the only thing standing between a bug and cross-list data.

### 2.4 Deleting a location unassigns; it never deletes gear

One `db.batch`, two statements, **both** scoped to the owned location
(**[rev 2]** — rev 1's UPDATE was not gated on the location belonging to the
requested list, so `DELETE /lists/A/packing-locations/<location-from-B>` could
mutate list A's rows and *then* 404, violating the zero-write cross-parent
invariant):

```sql
UPDATE list_items SET packing_location_id = NULL, updated_at = ?
 WHERE packing_location_id = ?loc AND list_id = ?list AND user_id = ?user
   AND EXISTS (SELECT 1 FROM packing_locations
                WHERE id = ?loc AND list_id = ?list AND user_id = ?user);

DELETE FROM packing_locations
 WHERE id = ?loc AND list_id = ?list AND user_id = ?user
 RETURNING id;
```

Explicit rather than relying on `ON DELETE SET NULL`, because the behavior is a
product guarantee and probe D above shows the declared cascade silently does
nothing when `foreign_keys` is off. This mirrors category delete, which
uncategorizes explicitly (`repos/categories.ts`).

**[rev 3] Success is read from the DELETE's `RETURNING`, never from the UPDATE's
row count.** Deleting an empty location legitimately unassigns zero items, so the
UPDATE count cannot distinguish "deleted an empty location" (204) from "wrong
parent / already gone" (404). The batch inspects the second statement's returned
rows: one row -> 204, empty -> 404. The UPDATE stays first for FK order.

`updated_at` **is** bumped: unlike a pure reorder, an unassign changes meaning.

### 2.5 "Organized" is derived, not stored

A list is organized when it has **at least one** packing location row — not
"some item is assigned", so an empty "Bear canister" the user just created does
not vanish. Deleting the last location reverts Pack Mode to category grouping.
No `is_organized` column to drift.

**[rev 2]** The client-side predicate is *not* `locations.length > 0`; see 4.4.

---

## 3. API

All routes sit under the existing list-scoped authz block: **session required on
every route** (401 without a session). **[rev 4] CSRF applies to writes only.**
The middleware bypasses the custom-header check for `GET`/`HEAD`/`OPTIONS`
(`server/middleware/csrf.ts:16`), and the client attaches the header only to
non-GET requests (`src/lib/api.ts:25`). So the authenticated `GET
packing-locations` must **succeed without** the header; POST/PATCH/PUT/DELETE
return **403 without** it. Rev 3 wrongly said "every route" needs the header.

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/lists/:id/packing-locations` | - | `[{ id, name, sortOrder }]` by `sortOrder` |
| POST | `/api/lists/:id/packing-locations` | `{ name }` | 201; `sortOrder = coalesce(max+1, 0)`; 422 on cap |
| PATCH | `/api/lists/:id/packing-locations/:locId` | `{ name }` | 200 |
| DELETE | `/api/lists/:id/packing-locations/:locId` | - | 204; batch of 2.4 |
| PUT | `/api/lists/:id/packing-locations/order` | `[{ id, sortOrder }]` | see below |

**[rev 2] `docs/authz-matrix.md` gains a row per route shape.** That file is
required before shipping (`authz-matrix.md:3`) and rev 1 omitted it entirely.
Rows must state actor, ownership rule, CSRF behavior, and the zero-write
guarantee on cross-parent access.

**Assignment reuses the existing item PATCH.** `updateListItemRequestSchema`
(`shared/lists.ts:197`) gains one field:

```ts
packingLocationId: z.string().uuid().nullable().optional()
```

`.nullable()` *is* "move back to Unassigned". Reusing this route means the
field-scoped optimistic hook, the `['update-list-item', listId]` invalidation
gate, and the existing failure map all apply unchanged — the DRY call.

**[rev 2] The gate must be hand-aliased raw SQL.** The repo already
hand-aliases correlated subqueries because interpolated drizzle columns can
render unqualified and silently change meaning (`repos/lists.ts:367`). So the
`EXISTS` fragment is written explicitly, all values bound, and asserted by a
real wire test rather than a unit test on the builder.

**[rev 3] The `EXISTS` predicate is conditional on a non-null assignment — three
patch shapes, not one.** Rev 2 wrote the `EXISTS` unconditionally, which is
wrong: for `packingLocationId: null` (the documented "move to Unassigned"),
`pl.id = NULL` is never true, so the update matched zero rows and the
disambiguation below reported a valid unassign as `invalid_location`. The write
branches on the patch:

```sql
-- (a) assign to a real location: prove the location belongs to the same list+user
UPDATE list_items SET packing_location_id = ?loc, updated_at = ?
 WHERE id = ? AND list_id = ? AND user_id = ?
   AND EXISTS (SELECT 1 FROM packing_locations pl
                WHERE pl.id = ?loc AND pl.list_id = ? AND pl.user_id = ?);

-- (b) unassign (packingLocationId === null): no EXISTS, just clear the column
UPDATE list_items SET packing_location_id = NULL, updated_at = ?
 WHERE id = ? AND list_id = ? AND user_id = ?;

-- (c) field absent from the patch: the column is not written at all
```

`.nullable().optional()` gives exactly these three: present-and-non-null,
present-and-null, absent. Each is a separate test.

**[rev 2] Zero updated rows is ambiguous and must be disambiguated — but only in
branch (a).** `listItems.update` currently maps an empty `returning()` to
`not_found` (`repos/list-items.ts:280`), which for branch (a) would report a
perfectly real item as 404 merely because the location was bad. On zero rows in
branch (a) the repo re-reads the item: item still present -> `invalid_location`
-> **400** (alongside `invalid_category`); item genuinely gone -> `not_found` ->
**404**. Branches (b) and (c) keep the existing `not_found`-on-zero-rows mapping,
because there is no location to be invalid.

**[rev 2] Reorder ownership is designed, not inherited.** `reorderSchema(30)`
validates shape, range and uniqueness only. Ownership uses the same owned-set
algorithm as item reorder (`repos/list-items.ts:318`): read this list's
locations (bounded at 30), check membership **in JavaScript**, reject
same-user cross-list ids, then batch per-row updates each carrying
`list_id` and `user_id` in its predicate. **Never an `inArray` over
client-supplied ids** — that is the D1 100-param trap.

**Sharing is unchanged.** No new field reaches `toSharedListResponse` (it maps
field-by-field and would have to be edited to leak). `FORBIDDEN_KEYS` gains
**[rev 2]** all four spellings: `packingLocationId`, `packing_location_id`,
`packingLocations`, `packing_locations`, and the raw-wire test populates a real
assignment so the assertion has something to catch.

---

## 4. Frontend

### 4.1 Mode becomes a three-way

```
lists/:id                 -> 'edit'
lists/:id/pack            -> 'pack'
lists/:id/pack/organize   -> 'organize'
```

**The derivation must be restructured, not extended.** It is an equality test
(`ListDetailPage.tsx:245-246`), so `/lists/X/pack/organize` currently resolves
to `'edit'` — the editing layout under the organize URL:

```ts
const base = `/lists/${listId}`
const mode: Mode =
  location.pathname === `${base}/pack/organize` ? 'organize'
  : location.pathname === `${base}/pack` || legacyPackMode ? 'pack'
  : 'edit'
```

Most specific first. The legacy `?mode=pack` fallback keeps its exact equality
check and is unaffected.

**[rev 2] Widening the union is the small part; auditing its readers is the
work.** Many sites branch on `mode !== 'pack'` and would silently treat
Organize as Edit — sidebar (`:852`), notes and weight summary (`:937`), the
food row, list settings, and row behavior. Every `mode === 'pack'` and
`mode !== 'pack'` site must be visited and given an explicit three-way answer,
and Organize renders through an **exclusive branch** rather than falling
through the edit layout. This audit ends with a grep proving no
`mode !== 'pack'` site was missed.

**[rev 2] Last-list persistence needs an explicit decision.** The effect at
`:369-374` stores `/pack` only for `mode === 'pack'`, and the validator regex
at `last-list-path.ts:25` ends `(\/pack)?$`, which **rejects**
`/pack/organize`. Decision: **persist `/pack`, not `/pack/organize`** —
Organize is a transient editing detour, not somewhere to reopen the app into.
The regex stays as-is and the effect maps `'organize' -> '/pack'`. Documented
here so it reads as a choice rather than an oversight, and pinned by a test.

**Organize renders in a lazy chunk.** `CategoryGroup` must not import it.
(Organize importing `CategoryGroup` is fine — the import-graph test follows
edges out of SharePage, and that is not a reverse edge.)

### 4.2 Grouping by location **[rev 2, materially revised]**

Rev 1 claimed the existing generic already groups by anything. **It does not.**
`groupByCategory` is generic only in its *item* type: it takes `Category[]`,
returns `{ category: Category | null }`, and keys stability on
`priorGroup.category === category` (`grouping.ts:14, 45`). A location DTO is
not a `Category` (which also carries `createdAt`).

So: **generalize the primitive over the group-definition type**, rather than
pretending or copy-pasting.

```ts
type Group<G, T> = { group: G | null; items: T[] }

function groupBy<G extends { id: string }, T>(
  items: T[],
  groups: G[],
  getGroupId: (item: T) => string | null,
  options: { keepEmpty: boolean; orphanPolicy: ...; stability?: ... },
): Group<G, T>[]
```

`groupByCategory` becomes a thin typed wrapper so no existing caller changes
shape, and `groupListItemsByLocation` is a second wrapper with
`keepEmpty: true` (an empty location must still render as a drop target).

**One unconditional stability hook, not two conditional ones.** The comparator
fix is necessary but insufficient (invariant 2). `useGroupedListItems` must be
generalized to stabilize *either* grouping kind and called **unconditionally** —
conditionally calling one of two hooks based on mode violates the rules of
hooks and would remount grouping state on every mode change. `packingLocationId`
is added to `listItemsArrayEqual`'s field list, with a red-green test.

### 4.3 Rendering

**[rev 5] This section is the CHECKLIST render path only** (Pack Mode after
organizing). Organize Mode does **not** reuse `CategoryGroup`; it has its own
`LocationSection` (4.6). Keeping them separate is what resolves the count-seam
problem below.

In the checklist, each location group renders through the existing
`CategoryGroup` with `name={location.name}`. Its per-section count is
`CategoryGroup`'s existing `packed / total`, shown only in `packMode`
(`CategoryGroup.tsx:311`) — which is exactly right here, because the checklist
*is* pack mode. **[rev 2] One adaptation rev 1 glossed:**

- **`regionKey` is mandatory.** Every category-less `CategoryGroup` defaults to
  the id `cat-region-uncategorized` (`CategoryGroup.tsx:214`), so N location
  sections would emit N duplicate DOM ids and break `aria-controls`. Pass
  `regionKey={location.id}`, and a distinct key for Unassigned.

No `CategoryGroup` component change is needed for the checklist path — only the
new `regionKey` prop value, which already exists (`CategoryGroup.tsx:95`).

### 4.4 Choosing the grouping **[rev 2]**

`locations.length > 0` is wrong, because a failed query commonly presents as
`[]` — a network error would silently render category grouping and tell the
user their organized pack has no locations.

**[rev 3] The switch keys on the last *successful* result, not on `isLoading` /
`isError`.** TanStack Query holds `data` and `error` simultaneously: a background
refetch can fail while usable cached location data is still present. A naive
"error -> category grouping" row would flip a known-organized pack back to
categories during a transient refresh blip. So the rule is:

- If there is a **last successful** location result, render **from it** (location
  grouping when non-empty, category grouping when it was a successful empty),
  and layer a small stale/error notice if the *latest* fetch errored. A refetch
  failure never changes the grouping.
- Fall back to category grouping **only when no successful location result exists
  yet** (first-ever load errored, or still loading with no cache).

| Situation (`status` + cache) | Pack Mode renders |
|---|---|
| loading, no prior success | skeleton / previous grouping, never a fallback claim |
| error, no prior success | category grouping **+ "couldn't load packing locations" notice** |
| success, empty | category grouping (genuinely not organized) |
| success, non-empty | location grouping |
| error/refetching, **prior success cached** | grouping from the cached result **+ a stale notice**; never a silent flip |

Only a *successful* empty response is allowed to mean "not organized". Tested:
first-load error, background-refetch error over non-empty cache, and cached
successful-empty.

**[rev 4] Concrete rule (Codex-confirmed expressible without `keepPreviousData`,
since the key is per-list and only refetched, not swapped):** `query.data`
selects the grouping whenever it is defined — non-empty -> location grouping,
empty -> category grouping; `query.isError` controls **only** the notice, never
the grouping. Category fallback happens exactly when `data === undefined`. This
mirrors the existing `isError && data === undefined` guard at
`ListDetailPage.tsx:424`.

### 4.5 Worn items are outside the location model **[rev 3, corrected]**

~~**Decision (SETTLED by Joe 2026-07-20): worn behavior does not change at all.**
Worn means on your body, not in the pack; a packing location answers "where in
my pack is this", which does not apply to a jacket you are wearing.~~

~~**[rev 3] Correcting rev 2's factual error about the code.** Rev 2 claimed "worn
extraction runs first." It does not. The real flow (verified):
`useGroupedListItems` groups **first** (`ListDetailPage.tsx:602`);
`useStableWornItems` then scans the *grouped* result and pulls out `isWorn` rows
**only when `groupWorn` is on** (`ListDetailPage.tsx:630-631`,
`use-stable-worn-items.ts:29,36-41`); the leaf `CategoryGroup` hides worn rows in
place via `hideWorn`, and the trailing Worn section exists **only when
`list.groupWorn` is true** (`ListDetailPage.tsx:1120`). So "worn extraction" is
not an unconditional first pass — it is entirely governed by the `groupWorn`
toggle. Rev 2's "exclude worn from every location and Unassigned regardless of
`groupWorn`" would have made worn gear **vanish** when `groupWorn` is false:
excluded from every location group *and* from Unassigned, with no Worn section to
land in, and `useStableWornItems` cannot recover them because it scans the
grouped rows it was never given.~~

~~**The correct design keeps worn exactly as it is today. Location grouping is a
drop-in replacement for category grouping, and nothing about worn changes:**~~

- ~~**`groupWorn` governs worn, in both layouts.** When it is **on**,
  `useStableWornItems` (generalized to the location-grouped shape — same
  `Group<T>[]`) extracts worn into the trailing Worn section and the leaf hides
  them, identical to category grouping today. When it is **off**, worn rows are
  *not* extracted; they render in place inside their assigned location group, or
  under Unassigned if unassigned — exactly as, today, a worn row renders in place
  inside its category. No worn row is ever silently dropped.~~
- ~~**Organize Pack filters out `isWorn` rows** and offers no `Move to…` for them,
  independent of `groupWorn`. Organize is "where does this go in my pack"; an
  on-body item is not in the pack. Its stored `packing_location_id` is left
  untouched (see the nuance below).~~
- ~~Because Organize never assigns worn items, the only way a worn row carries an
  assignment is the nuance below. One documented, accepted wrinkle: with
  `groupWorn` **off**, such a row is visible inside its location group in the
  checklist yet is not movable in Organize. Rare, coherent, and pinned by a test.~~

**SUPERSEDED 2026-07-21 (Joe): worn gear is always grouped.** The persisted
`group_worn` value no longer controls rendering. Edit, Pack, and the public
share view always remove worn rows from category or location sections and put
them in one trailing Worn section. Organize continues excluding worn rows from
the packing tree, but now also shows them in a trailing read-only Worn section
with no move action, drag handle, drop target, or reorder participation.
Location counts continue to include only non-worn assigned rows.

If a worn item backs a packing location, the location and its non-worn
contents remain visible under the stored fallback name, but the worn backing
item no longer supplies that location's checklist row or Organize move
controls. The location keeps only its location-reorder control and the option
to stop using the item as a container. Clearing Worn restores the item-backed
header and its stored nesting relationship.

The previously accepted assigned-then-worn wrinkle is now unreachable in the
UI: a worn row never renders inside its stored location, regardless of the
legacy flag. The assignment is still retained in the database so unmarking the
item restores its prior location. Pack and Organize both unconditionally omit
worn ids from their reorder slot pools, preventing either mode from moving a
worn row as a side effect of reordering visible gear.

**One stored-state nuance.** If an item is assigned and *then* marked worn, the
assignment is **kept in the database, not cleared**. Clearing on the worn toggle
would be lossy for a flag users flip while deciding what to wear. So
`packing_location_id` may be non-null on a worn row — a legal, deliberate state.
Because this is about what the *database column* holds, it is pinned by an
**API/repository** test (a unit test on the UI cannot prove the column stayed
non-null): assign via PATCH, mark worn via PATCH, re-read the row, assert the
column is still set; unmark, assert the item is back in its group.

### 4.6 Organize Pack UI

`OrganizePackPanel` owns its own `useQuery` for locations — the snap-back rule
(`use-reorderable.ts:22-43`), not a style preference.

- **[rev 5] `LocationSection` renders its own header**, not `CategoryGroup`.
  `CategoryGroup` shows a count only in `packMode`, and it is specifically
  `packed / total` (`CategoryGroup.tsx:311`); Organize is not a checklist, and
  passing `packMode` would also switch on pack-mode row behavior and controls, so
  it is not a usable seam. `LocationSection` owns the section chrome — name, a
  plain **item count**, kebab (Rename / Delete), drag handle — and its rows
  (Move-to + drag handle). This is why 4.3's `CategoryGroup` reuse is scoped to
  the checklist only.
  **The count is what Organize *shows* — non-worn assigned items.** Organize hides
  worn rows (4.5), so an assigned-then-worn item is excluded from both the list
  and the count; a location never says "1 item" while displaying none.
  `PackingProgress` takes global list totals from `ListDetailPage`, not
  per-location counts.
- **Item-backed locations are container nodes, not duplicate rows.** Their
  backing item supplies the Organize header and its move action. A container
  assigned to another item-backed location renders recursively inside that
  parent; its source never also appears in Unassigned or the parent's ordinary
  rows. Newly promoted top-level containers are inserted immediately after
  Unassigned, ahead of older locations. Their headers expose separate drag
  controls: the leading grip reorders sibling locations, while the package
  control moves/nests the backing gear item in another container. The worn
  exception is documented in 4.5: the location remains, but the backing item
  moves exclusively to Worn and its item-specific controls disappear.
- **Unassigned** always renders in Organize, pinned first, even when empty.
- **`Move to…`** on every row via `RowMenuItem` (desktop) and
  `MobileOptionsModal` (mobile). The primary path: accessible, mobile-friendly,
  one-handed. Not a fallback.
- **Drag** layered on top: `MouseSensor + TouchSensor + KeyboardSensor`,
  matching `ListDetailPage.tsx:509-512`. `SwipeableRow` coexistence is already
  solved (`SwipeableRow.tsx:3-19`).
- **A row drop has one meaning based on its target.** Dropping on a sibling row
  in the same location reorders those rows through the existing list-item order
  endpoint. Dropping on another location assigns the item there. Each path is
  still one drop and one write; `Move to...` remains the accessible move path.

### 4.7 Pack Mode after organization

Unchanged behavior, new grouping: Ready/Packed checkboxes, per-section
`packed / total`, collapse, "Show unpacked only" all already live in
`CategoryGroup` + `PackingProgress`. An item-backed location moves the source
item's Ready/Packed controls into the location header and nests the section
under its parent location, so the source remains checkable without rendering
twice.
Drag stays disabled (`SortableItemRow.tsx:40`). An "Organize" button in the
pack toolbar navigates to Organize Mode.

### 4.8 The removal-confirm dirty-state predicate **[rev 3]**

`hasListItemEdits` (`ListDetailPage.tsx:164`) is the *intentionally exhaustive*
list of membership state whose loss on remove warrants a confirm — its own test
warns in a comment that new membership fields must be added
(`remove-list-item-confirm.test.ts:15`). An assignment is membership state: it is
lost when the row is removed. Widening `ListItemWithGear` without touching this
predicate would let an assigned-but-otherwise-pristine item be removed with **no
confirm**, silently discarding the assignment.

So `packingLocationId !== null` counts as dirty in `hasListItemEdits`, every
fixture in that suite gains the field, and a red-green test pins it: an item
dirty *only* by its assignment must require confirmation. This predicate and its
test are in Phase 1's scope (they ship with the field), not deferred to the UI.

---

## 5. Migration and backward compatibility

`0014_packing-locations.sql`: `CREATE TABLE` + three indexes + cap trigger +
**three** integrity triggers (2.3 — insert, child update, parent immutability) +
`ALTER TABLE ADD COLUMN` + one index on the new column.
**[rev 2]** Plus the generated `0014_snapshot.json` and the `_journal.json`
entry — omitting them leaves future drizzle generation on stale state. The
hand-written triggers stay outside the snapshot, as with 0004.

**Purely additive**, so no `EXPECTED_CHANGES` / `EXPECTED_TYPE_CHANGES` entry.
Every existing list has zero locations and keeps today's Pack Mode exactly.

**[rev 2] But the safety gate is not a no-op — and [rev 3] rev 2 described it
wrongly.** Two distinct mechanisms, and only one of them the fixture satisfies:

- **The new-table check** (`check-migration-safety.mjs:1032-1041`) fails on any
  post-migration table not named in `FIXTURES`. So `packing_locations` **must**
  get a `FIXTURES` entry (ordered after `lists` for FK validity) or
  `npm run test:migrations` fails. This part rev 2 had right.
- **But the fixture proves nothing about the new schema this run.** `seed()`
  skips any table absent from the *pre*-migration snapshot
  (`check-migration-safety.mjs:750-752`), so the `packing_locations` row is never
  inserted during 0014; and a `packing_location_id` key added to `list_items`
  fixtures is filtered out because the column did not exist pre-migration
  (`check-migration-safety.mjs:763`). The schema diff only flags objects present
  before and *missing* after (`:806`, `:995`) — it never asserts a new column,
  index, or trigger exists. Rev 2's "the fixture covers it" was wrong.

**[rev 3/4] The new objects are proven by `POST_CHECKS`** (`check-migration-safety.mjs:548`,
each entry a **single** statement with `expectRows` **or** `expectErrorMatch`,
`:628`/`:642`). Two facts about the harness make a full proof possible, both
verified: entries run **in array order** (`:1010`), and each is a separate
`wrangler d1 execute --local` against the **same persisted DB** (`:618`), so an
early entry's `INSERT ... RETURNING` **persists as setup** for a later entry.
They run *after* seeding, so the seeded rows are present. **[rev 4] Codex
confirmed the existing fixtures already suffice** — `u-seed` owns both
`list-seed` and `list-seed-3` (`check-migration-safety.mjs:219,262`), and
`li-seed` / `gear-seed` exist (`:315,171`); **no new fixture is needed.** The
literal entries (all `migration: '0014_packing-locations.sql'`), in order, using
the four index names defined in 2.1/2.2 — `packing_locations_id_user_unique`,
`packing_locations_id_list_user_unique`, `packing_locations_list_sort_idx`,
`list_items_packing_location_idx`:

```js
// 1. new column exists and is TEXT
{ description: 'list_items.packing_location_id is TEXT',
  sql: "select upper(type) as type from pragma_table_info('list_items') where name='packing_location_id'",
  expectRows: [{ type: 'TEXT' }] },
// 2. all four new indexes exist (deterministic order)
{ description: 'packing-location indexes exist',
  sql: "select name from sqlite_master where type='index' and name in ('list_items_packing_location_idx','packing_locations_id_list_user_unique','packing_locations_id_user_unique','packing_locations_list_sort_idx') order by name",
  expectRows: [ { name: 'list_items_packing_location_idx' }, { name: 'packing_locations_id_list_user_unique' },
                { name: 'packing_locations_id_user_unique' }, { name: 'packing_locations_list_sort_idx' } ] },
// 3. INSERT trigger fires on a bogus location (no setup needed)
{ description: 'insert with unknown location aborts',
  sql: "insert into list_items (id,user_id,list_id,gear_item_id,quantity,is_worn,is_consumable,is_packed,is_ready,sort_order,created_at,updated_at,packing_location_id) values ('li-chk-ins','u-seed','list-seed','gear-seed',1,0,0,0,0,90,0,0,'nonexistent')",
  expectErrorMatch: /does not belong to this list/ },
// 4. SETUP: create a valid location on list-seed
{ description: 'setup: valid location',
  sql: "insert into packing_locations (id,user_id,list_id,name,sort_order,created_at,updated_at) values ('pl-chk','u-seed','list-seed','Chk',0,0,0) returning id",
  expectRows: [{ id: 'pl-chk' }] },
// 5. a legitimate assignment is ALLOWED (trigger must not over-fire)
{ description: 'setup: valid assignment allowed',
  sql: "insert into list_items (id,user_id,list_id,gear_item_id,quantity,is_worn,is_consumable,is_packed,is_ready,sort_order,created_at,updated_at,packing_location_id) values ('li-chk','u-seed','list-seed','gear-seed',1,0,0,0,0,91,0,0,'pl-chk') returning id",
  expectRows: [{ id: 'li-chk' }] },
// 6. child list_id-only update fires (the rev-2 hole): pl-chk is on list-seed
{ description: 'child list_id move aborts while assigned',
  sql: "update list_items set list_id='list-seed-3' where id='li-chk'",
  expectErrorMatch: /does not belong to this list/ },
// 7. child packing_location_id update to a bogus id fires
{ description: 'child assignment to unknown location aborts',
  sql: "update list_items set packing_location_id='nonexistent' where id='li-chk'",
  expectErrorMatch: /does not belong to this list/ },
// 8. parent immutability fires (the rev-3 hole)
{ description: 'moving a location to another list aborts',
  sql: "update packing_locations set list_id='list-seed-3' where id='pl-chk'",
  expectErrorMatch: /cannot change list or owner/ },
// 9. cap fires: pl-chk is 1; a recursive insert of 30 more makes the 31st abort
{ description: 'packing-location cap enforced',
  sql: "insert into packing_locations (id,user_id,list_id,name,sort_order,created_at,updated_at) with recursive c(x) as (select 1 union all select x+1 from c where x<30) select 'cap-'||x,'u-seed','list-seed','Cap'||x,x,0,0 from c",
  expectErrorMatch: /packing location cap exceeded/ },
```

The `FIXTURES` `packing_locations` entry still ships (future-run hygiene); these
`POST_CHECKS` are what gate this migration. The messages match the trigger DDL
and, for the cap, `isTriggerAbort(..., 'packing location cap exceeded')`
(`db-errors.ts:20`). Deep already-assigned-row paths are *also* covered in the
API suite, which builds rows through the repo.

**Duplication** (`repos/lists.ts:499-624`) must copy locations and remap
assignments, or duplicating an organized list silently flattens it.

- **[rev 2] Read items and locations in ONE batch snapshot.** Rev 1 read them
  separately, which can straddle a concurrent location delete and yield an
  assigned item whose location is absent from the map. Even with one snapshot,
  define the policy explicitly: **a missing map entry copies as `NULL`
  (Unassigned)**, never as a dangling id — and test it.
- **Generate new ids and build the old->new map *inside* the
  `SLUG_ATTEMPTS` loop**, alongside `newId` (lines 543-544). Location rows
  carry `listId: newId`, which is minted per attempt; hoisting the map out
  would, on a retry, insert locations pointing at the discarded list id.
  (Reusing the *location* UUIDs across attempts is harmless — a failed
  `db.batch` rolls back atomically.)
- **Insert location statements between `insertList` and `insertItems`** — FK
  order, and it leaves the `results[... planStatements.length]` index math at
  lines 608-610 correct, because that index points at `insertList`, which does
  not move. (Verified against the batch construction at lines 593-605.)
- **[rev 2] Chunk math corrected:** seven-column location rows chunk at
  `floor(90/7) = 12`, so 30 locations is **three** statements, not "one or two".

Packed/Ready state is already copied, so a duplicated organized list arrives
coherent.

**[rev 4] Export: the human CSV stays lossy; the takeout gets a lossless
`packing.json`.** Two surfaces, two answers, because they make different
promises:

- **Per-list CSV is a human/spreadsheet format and stays unchanged.** It is one
  row per item (`csv/list.ts:127`), cannot represent an empty location, and drops
  ids by design (`csv/list.ts:104`). That is fine for what CSV is; it never
  claimed completeness.
- **"Download all data" (`SettingsPage.tsx:56`, `DownloadAllData.tsx:38,59`)
  *does* promise completeness, so descoping was wrong** (rev 3's blind spot):
  omitting organization from an "all data" archive silently loses durable state,
  and the existing takeout test just asserts the CSV is unchanged
  (`takeout-files.test.ts:150`), so it would pass while the archive quietly
  became incomplete.

The takeout already carries a **versioned structured JSON** (`food-data.json` v4,
`export/food-data-json.ts:4`). Mirror it with a new **`packing.json` v1**.

**[rev 5/6] It must be self-contained, including human identity.** Rev 4 keyed
assignments on a bare `listItemId`; rev 5 added `gearItemId` — but Codex showed
**both dangle**: the gear CSV export emits names/weights but **not** `GearItem.id`
(`csv/gear.ts:46`), and the per-list CSV filename carries no list id, so nothing
in the archive resolves those ids. Fix: `packing.json` **denormalizes the
identifying names** so every record is legible on its own, no join required:

```jsonc
{ "version": 1,
  "lists": [ {
    "list": { "id": "…", "name": "…" },                         // trip is named, not just an id
    "locations": [ { "id": "…", "name": "…", "sortOrder": 0 } ], // empty locations included
    "items": [ { "listItemId": "…",                             // stable key, disambiguates duplicates
                 "gearItem": { "id": "…", "name": "…" },         // legible without the gear export
                 "packingLocationId": "…"                        // null when Unassigned
               } ] } ] }
```

Now the file resolves entirely within itself: the trip is named; every location
(including empty ones, keyed by `id`, duplicate names fine) is present; every
organized item names its gear and its assignment. The ids remain for exactness;
the names make it legible. `DownloadAllData` already fetches list items (which
carry `gearItemId`) and gear items (which carry `name`), so the denormalized name
is a local lookup, not a new fetch. "Lossless" means the organization layer is
fully captured and legible within the archive; it is **not** a re-import format
(the takeout has no re-import path — nothing consumes it back).

**[rev 5] The implementation path, corrected.** Rev 4 wrongly claimed the takeout
already fetches everything: `DownloadAllData` fetches list items but **not**
locations (`DownloadAllData.tsx:43,59`). So it must add **one session-scoped
locations fetch per list** (reusing the GET route). `list_items` already carry
`gearItemId` and, once the column ships, `packingLocationId`, so the `items`
array needs no extra fetch. Tests to update, concretely: `takeout-files.test.ts`
file-key assertions (`:91`, `:166`) gain `packing.json`; `DownloadAllData.test.tsx`
(`:151`) gains the new locations-query mock and call assertion; plus the
lossless-shape test (empty location + duplicate-named location + an Unassigned
item round-trip). Bounded piece of Phase 2, not a separate export project.

---

## 6. Testing strategy

Gate is `npm run build` + `npm run test:unit` + `npm run test:migrations`; API
tests run on real workerd in CI (`npm run test:api` cannot bind a port or read
`.dev.vars` in this sandbox — an environment limit, not a failure).

**API:**

- CRUD + reorder round-trip; ordering by `sortOrder`.
- **Delete unassigns, never deletes gear**: assign 3, delete location -> 3
  items remain, all `packingLocationId === null`.
- **Delete of an EMPTY location -> 204** (separate from the wrong-parent case, so
  the `RETURNING`-based success check is proven not to lean on the unassign
  count — M9).
- **Delete via wrong parent** (`/lists/A/...` naming B's location) -> 404 **and
  zero writes to list A** (assert row values unchanged, not just the status).
- Cap: 31st location -> 422 with the mapped message.
- Cross-list assignment -> 400 `invalid_location`, zero rows.
- Cross-user assignment and cross-user CRUD -> 404/400, zero rows.
- **Trigger-level (must bypass the repo gate).** The repo's branch-(a) `EXISTS`
  makes a cross-list assignment match zero rows, so a write *through the repo*
  would never reach the trigger. Using **direct Drizzle writes** that skip the
  gate, assert `SQLITE_CONSTRAINT_TRIGGER` on: (i) an **INSERT** of a list item
  with a cross-list `packing_location_id`; (ii) an **UPDATE** of an assigned row
  changing each of `packing_location_id`, `list_id`, `user_id` to a cross-list /
  cross-user value (the rev-2 `UPDATE OF` hole — 2.3); (iii) a **parent-side**
  `UPDATE packing_locations SET list_id/user_id` (the rev-3 parent hole — 2.3,
  `packing_locations_owner_immutable`). A valid assignment must NOT abort.
- **Assignment, three branches (3):** (a) assign to a valid location -> 200, row
  set; assign to a bad location on a live item -> 400 `invalid_location`, zero
  rows; deleted item -> 404. (b) `packingLocationId: null` unassigns -> 200,
  column cleared. (c) a patch omitting the field never touches the column.
- Reorder with a same-user cross-list id -> rejected, zero writes.
- Empty patch `{}` still rejected once the field is optional.
- **Worn nuance (4.5), at the DB:** assign via PATCH, mark worn via PATCH,
  re-read -> `packing_location_id` still set; unmark -> still set. A unit test
  cannot prove this; it lives here.
- List delete cascades locations.
- Duplication: locations copied with new ids, assignments remapped to the
  *copy's* locations; missing-map-entry policy yields NULL.
- **Anon / CSRF (N1, [rev 4]):** every route 401 without a session; the
  **write** routes (POST/PATCH/PUT/DELETE) 403 without the custom header; the
  **GET** route **succeeds without the header** (it is CSRF-exempt —
  `csrf.ts:16`). Asserting 403 on the GET would be wrong.
- Share: raw-wire test on an organized shared list with a real assignment
  contains none of the four forbidden spellings at any depth.
- **Takeout `packing.json` (5):** an organized list with an empty location, a
  duplicate-named location, and an Unassigned item serializes self-containedly.
  Assert **every reference resolves inside the JSON** (not merely that keys
  exist): the trip has `list.name`, both same-named locations are distinct by
  `id`, and each item names its `gearItem` and its `packingLocationId` (null when
  Unassigned). Plus `DownloadAllData.test.tsx`: the new per-list locations fetch
  is mocked and asserted called; the file-key set includes `packing.json`.

**Unit:**

- Generalized `groupBy` + `groupListItemsByLocation`: ordering, empty locations
  retained, Unassigned tail, reference stability.
- **`listItemsArrayEqual` red-green**: a fixture differing *only* in
  `packingLocationId` must compare unequal. Watch it fail first; without the
  red step the test proves nothing.
- Stability hook returns identical references across a no-op render for both
  grouping kinds.
- Grouping switch across the query states (4.4): first-load error -> notice +
  category fallback; **background-refetch error over a non-empty cache -> keeps
  location grouping + stale notice, never a silent flip**; successful empty ->
  category grouping.
- ~~**Worn, `groupWorn` on (4.5)**: worn items go to the trailing Worn section
  and appear in no location group.~~
- ~~**Worn, `groupWorn` off (4.5)**: worn items render inside their assigned
  location or under Unassigned.~~
- **Worn in every view (4.5):** Edit, Pack, Organize, and public share render
  every worn item in one trailing Worn section regardless of the stored legacy
  flag. Ordinary category and location sections render no worn rows. Organize's
  section is read-only and outside all drag-and-drop contexts.
- **`hasListItemEdits` red-green (4.8)**: add the non-null `packingLocationId`
  case to the **exhaustive dirty-field table** (`remove-list-item-confirm.test.ts`,
  the table around `:64`), not a separate ad hoc assertion, and give every
  fixture the field (`:20`) so `undefined !== null` never misfires as dirty.
  Watch it fail before the predicate learns the field.
- `regionKey` uniqueness: N locations produce N distinct region ids.
- Mode derivation: all three routes, plus legacy `?mode=pack`.
- `writeLastListPath` stores `/pack` (not `/pack/organize`) from Organize.
- `share-path-imports.test.ts` continues to pass.

---

## 7. Phases

**Phase 1 — data + API.** Migration (incl. integrity triggers, snapshot,
journal), schema, repo, routes, validation, duplication copy,
`docs/authz-matrix.md` rows, `FORBIDDEN_KEYS`, migration-safety fixtures **and
0014 POST_CHECKS** (section 5), the `hasListItemEdits` field (4.8), full API
matrix. **No UI.**

**Phase 2 — Organize Pack, no drag.** The `/pack/organize` route, the mode
audit, generalized grouping + stability hook, create/rename/delete/reorder,
`Move to…`, Unassigned, the grouping-state switch (4.4), the worn handling
(4.5), and the lossless takeout `packing.json` (section 5). The entry-point
button lands last so the halves can merge separately. This is the shippable
feature. The per-list CSV is deliberately left lossy (section 5).

**Phase 3 — drag and drop.** dnd-kit between locations, keyboard sensor,
`DragOverlay`, aria-live. Purely additive; `Move to…` stays the accessible path.

**Phase 4 — polish.** Per-location progress affordances, collapse persistence,
first-run empty state.

Phase 2 is large. If it needs splitting, the seam is 2a (grouping + pack-mode
read path) / 2b (organize screen), still gated by the deferred entry point.

---

## 8. Risks, edge cases, unresolved decisions

**Risks**

- *Stale UI via the two stability mechanisms.* Highest-probability defect;
  fails silently with green tests. Mitigated by the red-green test.
- *The mode audit.* Widening the union is trivial; the risk is a missed
  `mode !== 'pack'` site rendering Organize as Edit. Ends with a grep.
- *Drag on mobile.* Genuinely unreliable; hence `Move to…` primary, drag in
  phase 3.
- *`ListDetailPage.tsx` is already 1355 lines.* Organize gets its own tree.

**Edge cases**

| Case | Behavior |
|---|---|
| Gear added after organizing | Defaults NULL -> Unassigned |
| Gear removed from list | Row deleted; assignment goes with it |
| Location deleted | Items unassigned, never removed (2.4) |
| Last location deleted | Reverts to category grouping (2.5) |
| Empty location | Retained (`keepEmpty: true`) |
| Unassigned empty | Hidden in Pack Mode, shown in Organize |
| Locations fail to load | Notice + category grouping, never a silent claim (4.4) |
| Worn item, any stored legacy flag | Trailing Worn section only; never in a category or location group (4.5) |
| Item assigned, then marked worn | Worn section; assignment kept in DB, restored on unmark (4.5) |
| Remove an assigned-but-pristine item | Confirm still fires — assignment is dirty state (4.8) |
| List duplicated | Locations copied, assignments remapped (section 5) |
| Concurrent delete + assign | Gate fails -> 400, zero rows, client refetches |
| Shared list | No location data in the DTO |

**Unresolved product decisions** (recommendation given, all reversible)

1. **Duplicate location names** — allow, matching categories.
2. ~~**Within-location ordering** — defer.~~ **SETTLED 2026-07-21 (Joe):** row
   drops within one location reorder the existing global list-item `sortOrder`
   slots; cross-location drops continue to assign instead.
3. **Cap of 30** — a guess; it is a trigger, so a one-line migration to change.
4. **Organize entry point placement** — pack toolbar. Needs a browser, not
   paper.
5. **Weights in Organize** — hide, matching Pack Mode. A bear canister has a
   volume limit, not a weight limit.
6. ~~`groupWorn` precedence — **SETTLED 2026-07-20 (Joe): worn stays exactly
   as it is; worn items are outside the location model entirely. See 4.5.**~~
   **SUPERSEDED 2026-07-21 (Joe): worn is always grouped in every view; the
   persisted flag no longer controls rendering. See 4.5.**

**Future compatibility (explicitly not built)**

- *Food in a bear canister.* Food is never a `list_items` row (food design
  section 4), so the column cannot carry it — by construction, not oversight.
  Food gets a side table
  `food_packing_assignments (list_id, food_item_id, packing_location_id)`
  mirroring `food_pack_state`. Nothing here blocks it.
- *A location that is also a weighed gear item* (a bear canister is both).
  Later: a nullable `packing_locations.gear_item_id`. Additive. Kept out of v1
  because it raises "does the canister's weight count once or twice", a real
  modelling question deserving its own design.
- Nested locations, multi-location items, quantity splitting: out. One level
  deep.

---

## 9. Files likely to change

**New**

```
migrations/0014_packing-locations.sql
migrations/0014_snapshot.json            (generated)
server/repos/packing-locations.ts
server/routes/packing-locations.ts       (or a block in routes/lists.ts)
src/lists/OrganizePackPanel.tsx
src/lists/LocationSection.tsx
src/lists/MoveToLocationMenu.tsx
src/lib/queries/packing-locations.ts
+ test siblings for each
```

**Modified**

```
migrations/meta/_journal.json            generated entry
server/db/app-schema.ts                  table + list_items column
shared/lists.ts                          location schemas; packingLocationId on
                                         update request + item response
server/repos/list-items.ts               gated assignment write; invalid_location
                                         vs not_found disambiguation
server/repos/lists.ts                    duplicate(): one-batch snapshot, copy,
                                         remap, in-loop id map
server/repos/index.ts                    register the repo
server/routes/lists.ts                   listItemFailure: invalid_location -> 400
server/routes/shares.test.ts             FORBIDDEN_KEYS x4 spellings + real
                                         assignment in the raw-wire fixture
scripts/check-migration-safety.mjs       packing_locations FIXTURES entry;
                                         list_items fixture column; 0014
                                         POST_CHECKS (column, triggers, indexes)
docs/authz-matrix.md                     one row per new route shape
src/lib/grouping.ts                      generalized groupBy; location wrapper;
                                         listItemsArrayEqual field (load-bearing)
src/lib/use-grouped-list-items.ts        generalized, called unconditionally
src/lib/queries/keys.ts                  queryKeys.packingLocations(listId)
src/lib/last-list-path.ts                test pinning organize -> /pack
src/AuthenticatedApp.tsx                 the /pack/organize route
src/lists/ListDetailPage.tsx             three-way mode + full audit of every
                                         mode === 'pack' / !== 'pack' site;
                                         passes regionKey={location.id} per
                                         checklist section (4.3); hasListItemEdits
                                         gains packingLocationId (4.8)
src/lists/remove-list-item-confirm.test.ts  assigned-only item is dirty (4.8)
src/lists/SharePage.tsx                  adapter supplies packingLocationId: null
src/lists/use-list-item-actions.ts       packingLocationId in the patch type
src/lib/types.ts                         PackingLocation re-export
src/lib/export/packing-json.ts           NEW: self-contained packing.json v1 (5)
src/settings/DownloadAllData.tsx         one locations fetch per list; add
                                         packing.json to the takeout (5)
src/lib/export/takeout-files.test.ts     packing.json file-key (:91,:166) + shape
src/settings/DownloadAllData.test.tsx    locations-query mock + call (:151)
```

(Per-list CSV modules are deliberately untouched — CSV stays lossy, section 5.)
