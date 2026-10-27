import { generateRandomString } from 'better-auth/crypto'
import { and, asc, eq, type Table } from 'drizzle-orm'
import { reorderOwnedSet } from './reorder'
import { appendSortOrder } from './append-sort-order'
import type { Db, Tx } from '../db'
import {
  categories,
  gearItems,
  listFoodItemSlots,
  listFoodItems,
  listFoodSlots,
  listItems,
  lists,
  packingLocations,
} from '../db/schema'
import { isTriggerAbort, isUniqueViolation } from './db-errors'
import { chunkForParamCap } from './chunk-ids'
import { isCapError as isGearCapError } from './gear-items'
import { isCategoryCapError } from './categories'
import { isListItemCapError } from './list-items'

const cols = {
  id: lists.id,
  name: lists.name,
  description: lists.description,
  slug: lists.slug,
  isShared: lists.isShared,
  isDraft: lists.isDraft,
  sortOrder: lists.sortOrder,
  createdAt: lists.createdAt,
  updatedAt: lists.updatedAt,
}

export type ListRow = Omit<typeof lists.$inferSelect, 'userId'>

// PATCH semantics: undefined = unchanged, null = clear (nullable fields).
export type UpdateListPatch = {
  name?: string
  description?: string | null
  isShared?: boolean
  isDraft?: boolean
}

export type ListWriteResult =
  | { ok: true; row: ListRow }
  | { ok: false; reason: 'cap_exceeded' | 'not_found' }

export type DuplicateListResult =
  | { ok: true; row: ListRow }
  | { ok: false; reason: 'cap_exceeded' | 'not_found' }

// Rotating a link cannot hit a cap - it writes one column on a row that
// already exists - so not_found is the only way it fails.
export type RotateShareLinkResult =
  | { ok: true; row: ListRow }
  | { ok: false; reason: 'not_found' }

export type FromSelectionResult =
  | { ok: true; row: ListRow }
  | { ok: false; reason: 'cap_exceeded' | 'invalid_gear' }

export type ImportListCategoryInput = { tempId: string; name: string }

export type ImportListGearInput = {
  tempId: string
  name: string
  description: string | null
  weightGrams: number
  category:
    | { kind: 'existing'; id: string }
    | { kind: 'new'; tempId: string }
    | null
  // Integer cents, converted at the route boundary (the wire DTO speaks
  // dollars). Only NEW gear appears in this array, so this can never
  // overwrite the cost of gear already in the library.
  costCents: number | null
}

export type ImportListItemInput = {
  gear: { kind: 'existing'; id: string } | { kind: 'new'; tempId: string }
  quantity: number
  isWorn: boolean
  isConsumable: boolean
  sortOrder: number
}

export type ImportListResult =
  | { ok: true; row: ListRow }
  | {
      ok: false
      reason:
        | 'cap_exceeded' // list cap (100 per user)
        | 'gear_cap_exceeded' // gear inventory cap (500 per user)
        | 'item_cap_exceeded' // list item cap (300; unreachable while the DTO max matches, kept as the trigger backstop)
        | 'category_cap_exceeded' // category cap (CATEGORY_CAP per user; an import may carry up to 300 new categories)
        | 'invalid_category'
        | 'invalid_gear'
    }

function isListCapError(err: unknown): boolean {
  return isTriggerAbort(err, 'list cap exceeded')
}

// A fresh slug colliding twice is already ~1-in-2^71; five failures in a
// row means something is broken, not unlucky - throw and let it 500.
const SLUG_ATTEMPTS = 5

// 6-character base62 share slug, minted on the server. better-auth's
// generator rejects out-of-range bytes, so every character is equally likely.
export function generateSlug(): string {
  return generateRandomString(6, 'A-Z', 'a-z', '0-9')
}

// A fresh slug can still collide with an existing one on the
// lists_slug_unique index, so every write that mints a slug needs the same
// retry. This is that loop, once: create, duplicate, from-selection, import,
// and rotateShareLink all run through it. Each attempt is one whole
// transaction, so a collision rolls back everything that attempt wrote before
// the next one starts.
//
// It ONLY handles slug collisions. A caller that maps other failures to a
// result (the list-cap trigger, say) catches those itself and rethrows the
// rest, which is what lets a collision reach this loop and retry.
//
// Synchronous, because the attempts are synchronous SQLite transactions.
// Exported for its own test: five write paths depend on this loop, and the
// collision it exists for is far too rare to reach through the HTTP surface.
export function withFreshSlug<T>(attempt: (slug: string) => T): T {
  for (let i = 0; i < SLUG_ATTEMPTS; i++) {
    try {
      return attempt(generateSlug())
    } catch (err) {
      if (isUniqueViolation(err, 'lists.slug')) continue
      throw err
    }
  }
  throw new Error('slug generation exhausted retries')
}

// Every slug-minting write fails the same way: the list-cap trigger becomes
// a result instead of a 500, and anything else stays thrown. The catch sits
// OUTSIDE withFreshSlug, which is equivalent to the per-site try/catch it
// replaces: withFreshSlug swallows only the slug-unique collision (and
// retries) and rethrows everything else. `classify` lets the import convert
// its other cap triggers too; it returns null for an error it does not know.
function withFreshSlugCapped<R>(
  attempt: (slug: string) => R,
  classify?: (err: unknown) => R | null,
): R | { ok: false; reason: 'cap_exceeded' } {
  try {
    return withFreshSlug(attempt)
  } catch (err) {
    if (isListCapError(err)) return { ok: false, reason: 'cap_exceeded' }
    const classified = classify?.(err) ?? null
    if (classified !== null) return classified
    throw err
  }
}

// Suffix used when duplicating a list. Truncates so the " (copy)" suffix
// cannot push the name past the column's 256 CHECK (the old Postgres RPC had
// that latent overflow).
function copyName(name: string): string {
  return `${name.slice(0, 249)} (copy)`
}

function remapPackingLocationId(
  sourceId: string | null,
  idMap: ReadonlyMap<string, string>,
): string | null {
  return sourceId === null ? null : (idMap.get(sourceId) ?? null)
}

// Every method that reads before it writes runs its reads, ownership checks,
// planning and writes in ONE SQLite transaction on the process's only
// connection, with `behavior: 'immediate'` so the write lock is taken before
// the first read. The callbacks are synchronous, so no other request can run
// in the middle, and any failure rolls back everything the method wrote.
// Methods that are a single statement (list, create, update, remove,
// rotateShareLink) need no explicit transaction: SQLite applies one
// statement whole or not at all.
export function createListsRepo(db: Db, userId: string) {
  function nextSortOrder() {
    return appendSortOrder(lists, lists.sortOrder, eq(lists.userId, userId))
  }

  // The caller's category and gear ids, for the import and from-selection
  // ownership checks. The caps bound each scan at 500 rows.
  function ownedCategoryIds(tx: Tx): Set<string> {
    return new Set(
      tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.userId, userId))
        .all()
        .map((r) => r.id),
    )
  }

  function ownedGearIds(tx: Tx): Set<string> {
    return new Set(
      tx
        .select({ id: gearItems.id })
        .from(gearItems)
        .where(eq(gearItems.userId, userId))
        .all()
        .map((r) => r.id),
    )
  }

  return {
    async list(): Promise<ListRow[]> {
      return db
        .select(cols)
        .from(lists)
        .where(eq(lists.userId, userId))
        .orderBy(asc(lists.sortOrder), asc(lists.name))
    },

    async create(name: string): Promise<ListWriteResult> {
      return withFreshSlugCapped((slug): ListWriteResult => {
        const now = Date.now()
        const row = db
          .insert(lists)
          .values({
            id: crypto.randomUUID(),
            userId,
            name,
            slug,
            sortOrder: nextSortOrder(),
            createdAt: now,
            updatedAt: now,
          })
          .returning(cols)
          .get()
        return { ok: true, row }
      })
    },

    async update(id: string, patch: UpdateListPatch): Promise<ListWriteResult> {
      const set: Record<string, unknown> = { updatedAt: Date.now() }
      if (patch.name !== undefined) set.name = patch.name
      if (patch.description !== undefined) set.description = patch.description
      if (patch.isShared !== undefined) set.isShared = patch.isShared
      if (patch.isDraft !== undefined) set.isDraft = patch.isDraft
      const [row] = await db
        .update(lists)
        .set(set)
        .where(and(eq(lists.id, id), eq(lists.userId, userId)))
        .returning(cols)
      return row ? { ok: true, row } : { ok: false, reason: 'not_found' }
    },

    async remove(id: string): Promise<boolean> {
      const rows = await db
        .delete(lists)
        .where(and(eq(lists.id, id), eq(lists.userId, userId)))
        .returning({ id: lists.id })
      return rows.length > 0
    },

    // sortOrder ONLY - a reorder must not bump updatedAt (product rule
    // ported from the old repo's sort_order_no_op_preserves_updated_at).
    async reorder(
      updates: { id: string; sortOrder: number }[],
    ): Promise<boolean> {
      return db.transaction(
        (tx) =>
          reorderOwnedSet(
            tx,
            lists,
            { id: lists.id, sortOrder: lists.sortOrder },
            [eq(lists.userId, userId)],
            updates,
          ),
        { behavior: 'immediate' },
      )
    },

    // Deep copy: name gets "(copy)", every membership row is copied
    // (including packed/ready state - old duplicate_list behavior), and
    // isShared/isDraft deliberately reset to false/true so a copy is
    // never silently public.
    //
    // The source read and every write share ONE transaction, in FK order
    // (list -> packing locations -> items -> container links -> food), so
    // the copy is one consistent snapshot and a late failure - the list cap
    // trigger included - leaves no half-copied list behind.
    async duplicate(id: string): Promise<DuplicateListResult> {
      return withFreshSlugCapped((slug): DuplicateListResult =>
        db.transaction(
          (tx) => duplicateInTransaction(tx, id, slug),
          { behavior: 'immediate' },
        ),
      )
    },

    // Atomic CSV list import: the ownership checks, new categories, new
    // gear, the list row and its items run in ONE transaction (parity with
    // the old app's create_list_with_imported_items RPC - a late failure
    // leaves no orphans). Every referenced existing category/gear id must be
    // the caller's, checked by owned-set membership before any write. Cap
    // triggers stay the single enforcement points: any abort rolls back the
    // whole import. Order is list -> categories -> gear -> items so FK
    // targets always precede their referencing rows.
    async importFromCsv(input: {
      name: string
      categories: ImportListCategoryInput[]
      gear: ImportListGearInput[]
      items: ImportListItemInput[]
    }): Promise<ImportListResult> {
      const existingCategoryIds = new Set(
        input.gear.flatMap((g) =>
          g.category?.kind === 'existing' ? [g.category.id] : [],
        ),
      )
      const existingGearIds = new Set(
        input.items.flatMap((i) =>
          i.gear.kind === 'existing' ? [i.gear.id] : [],
        ),
      )

      const newCategories = input.categories.map((c) => ({
        ...c,
        id: crypto.randomUUID(),
      }))
      const categoryIdByTempId = new Map(
        newCategories.map((c) => [c.tempId, c.id]),
      )
      const newGear = input.gear.map((g) => ({ ...g, id: crypto.randomUUID() }))
      const gearIdByTempId = new Map(newGear.map((g) => [g.tempId, g.id]))
      const resolveCategoryId = (
        ref: ImportListGearInput['category'],
      ): string | null => {
        if (ref === null) return null
        if (ref.kind === 'existing') return ref.id
        const id = categoryIdByTempId.get(ref.tempId)
        // Unreachable: the DTO refine rejects unknown tempIds.
        if (!id) throw new Error(`unknown category tempId: ${ref.tempId}`)
        return id
      }
      const resolveGearId = (ref: ImportListItemInput['gear']): string => {
        if (ref.kind === 'existing') return ref.id
        const id = gearIdByTempId.get(ref.tempId)
        if (!id) throw new Error(`unknown gear tempId: ${ref.tempId}`)
        return id
      }
      // Pack ranks are assigned DENSELY here, in sortOrder order - not copied
      // from sortOrder. The two look equivalent and are not.
      //
      // `importListItemSchema` allows a sortOrder up to PACK_RANK_MAX, so
      // copying it could plant a row at exactly the maximum. Every later
      // arrival into that cohort computes `max + 1`, which migration 0019's
      // range trigger now refuses - so a single imported row at the top of
      // the range would leave a list unable to accept items, accept moves, or
      // delete a location, forever. Dense ranks bound the maximum at
      // items.length - 1, which LIST_ITEM_CAP holds at 299, so exhaustion
      // stops being reachable at all rather than being reported nicely.
      //
      // sortOrder keeps the file's gaps (dropped empty-name rows, old-repo
      // parity); pack rank has never had a reason to preserve them, since it
      // only has to be unique and ordered within its cohort.
      const packRanks = new Map(
        [...input.items]
          .map((item, index) => ({ item, index }))
          .sort((a, b) =>
            a.item.sortOrder - b.item.sortOrder || a.index - b.index,
          )
          .map(({ index }, rank) => [index, rank]),
      )

      return withFreshSlugCapped(
        (slug): ImportListResult =>
          db.transaction(
            (tx): ImportListResult => {
              if (existingCategoryIds.size > 0) {
                const owned = ownedCategoryIds(tx)
                for (const id of existingCategoryIds) {
                  if (!owned.has(id)) return { ok: false, reason: 'invalid_category' }
                }
              }
              if (existingGearIds.size > 0) {
                const owned = ownedGearIds(tx)
                for (const id of existingGearIds) {
                  if (!owned.has(id)) return { ok: false, reason: 'invalid_gear' }
                }
              }

              const newListId = crypto.randomUUID()
              const now = Date.now()
              const row = tx
                .insert(lists)
                .values({
                  id: newListId,
                  userId,
                  name: input.name,
                  slug,
                  sortOrder: nextSortOrder(),
                  createdAt: now,
                  updatedAt: now,
                })
                .returning(cols)
                .get()
              // One statement per row, so each max(sortOrder)+1 subquery sees
              // the rows inserted before it - appended blocks come out
              // contiguous past the existing max.
              for (const c of newCategories) {
                tx.insert(categories)
                  .values({
                    id: c.id,
                    userId,
                    name: c.name,
                    sortOrder: appendSortOrder(categories, categories.sortOrder, eq(categories.userId, userId)),
                    createdAt: now,
                  })
                  .run()
              }
              for (const g of newGear) {
                tx.insert(gearItems)
                  .values({
                    id: g.id,
                    userId,
                    categoryId: resolveCategoryId(g.category),
                    name: g.name,
                    description: g.description,
                    weightGrams: g.weightGrams,
                    costCents: g.costCents,
                    // The list CSV format carries no purchaseDate (no column
                    // for it); status is app-internal only (same contract as
                    // the gear import).
                    status: 'active',
                    sortOrder: appendSortOrder(gearItems, gearItems.sortOrder, eq(gearItems.userId, userId)),
                    createdAt: now,
                    updatedAt: now,
                  })
                  .run()
              }
              input.items.forEach((item, index) => {
                tx.insert(listItems)
                  .values({
                    id: crypto.randomUUID(),
                    userId,
                    listId: newListId,
                    gearItemId: resolveGearId(item.gear),
                    quantity: item.quantity,
                    isWorn: item.isWorn,
                    isConsumable: item.isConsumable,
                    // The original CSV row index; dropped empty-name rows
                    // leave intentional gaps (old-repo parity).
                    sortOrder: item.sortOrder,
                    // Everything imported lands Unassigned, so the whole file
                    // is one cohort and this dense rank orders it.
                    packSortOrder: packRanks.get(index) ?? 0,
                    createdAt: now,
                    updatedAt: now,
                  })
                  .run()
              })
              return { ok: true, row }
            },
            { behavior: 'immediate' },
          ),
        (err) => {
          if (isGearCapError(err)) return { ok: false, reason: 'gear_cap_exceeded' }
          if (isListItemCapError(err)) return { ok: false, reason: 'item_cap_exceeded' }
          if (isCategoryCapError(err)) {
            return { ok: false, reason: 'category_cap_exceeded' }
          }
          return null
        },
      )
    },

    // Gear-page "Create list from selection". All-or-nothing: one
    // non-owned gear id rejects the whole call with zero writes. Item order
    // follows the array.
    async createFromSelection(
      name: string,
      description: string | null,
      gearItemIds: string[],
    ): Promise<FromSelectionResult> {
      return withFreshSlugCapped((slug): FromSelectionResult =>
        db.transaction(
          (tx): FromSelectionResult => {
            const owned = ownedGearIds(tx)
            if (!gearItemIds.every((id) => owned.has(id))) {
              return { ok: false, reason: 'invalid_gear' }
            }
            const newId = crypto.randomUUID()
            const now = Date.now()
            const row = tx
              .insert(lists)
              .values({
                id: newId,
                userId,
                name,
                description,
                slug,
                sortOrder: nextSortOrder(),
                createdAt: now,
                updatedAt: now,
              })
              .returning(cols)
              .get()
            gearItemIds.forEach((gearItemId, i) => {
              tx.insert(listItems)
                .values({
                  id: crypto.randomUUID(),
                  userId,
                  listId: newId,
                  gearItemId,
                  sortOrder: i,
                  // One fresh list, everything Unassigned: one cohort, so
                  // the selection index serves as both ranks.
                  packSortOrder: i,
                  createdAt: now,
                  updatedAt: now,
                })
                .run()
            })
            return { ok: true, row }
          },
          { behavior: 'immediate' },
        ),
      )
    },

    // Mint a new share link for a list the caller owns. The old slug stops
    // resolving the moment this lands - /r/<old> becomes an unknown slug and
    // 404s like any other, which is the whole point of the control.
    //
    // Deliberately does NOT touch isShared. Rotating the link and turning
    // sharing off are separate intentions: someone rotating a link wants a
    // different URL, not to stop sharing. Bundling them would also make the
    // toggle destructive, which is the behavior this control exists to
    // avoid - people publish these URLs in places they cannot easily edit.
    async rotateShareLink(id: string): Promise<RotateShareLinkResult> {
      return withFreshSlug((slug): RotateShareLinkResult => {
        const row = db
          .update(lists)
          .set({ slug, updatedAt: Date.now() })
          .where(and(eq(lists.id, id), eq(lists.userId, userId)))
          .returning(cols)
          .get()
        return row ? { ok: true, row } : { ok: false, reason: 'not_found' }
      })
    },
  }

  function duplicateInTransaction(
    tx: Tx,
    id: string,
    slug: string,
  ): DuplicateListResult {
    const source = tx
      .select(cols)
      .from(lists)
      .where(and(eq(lists.id, id), eq(lists.userId, userId)))
      .limit(1)
      .get()
    if (!source) return { ok: false, reason: 'not_found' }

    const items = tx
      .select({
        id: listItems.id,
        gearItemId: listItems.gearItemId,
        quantity: listItems.quantity,
        isWorn: listItems.isWorn,
        isConsumable: listItems.isConsumable,
        isPacked: listItems.isPacked,
        isReady: listItems.isReady,
        packingLocationId: listItems.packingLocationId,
        sortOrder: listItems.sortOrder,
        packSortOrder: listItems.packSortOrder,
      })
      .from(listItems)
      .where(and(eq(listItems.listId, id), eq(listItems.userId, userId)))
      .all()
    const sourceLocations = tx
      .select({
        id: packingLocations.id,
        name: packingLocations.name,
        sortOrder: packingLocations.sortOrder,
        containerListItemId: packingLocations.containerListItemId,
      })
      .from(packingLocations)
      .where(
        and(
          eq(packingLocations.listId, id),
          eq(packingLocations.userId, userId),
        ),
      )
      .all()
    const sourceFoodSlots = tx
      .select({
        id: listFoodSlots.id,
        dayNumber: listFoodSlots.dayNumber,
        meal: listFoodSlots.meal,
      })
      .from(listFoodSlots)
      .where(and(eq(listFoodSlots.listId, id), eq(listFoodSlots.userId, userId)))
      .all()
    const sourceFoodItems = tx
      .select({
        id: listFoodItems.id,
        name: listFoodItems.name,
        weightGrams: listFoodItems.weightGrams,
        quantity: listFoodItems.quantity,
        // Copied, not defaulted. quantity means nothing without it: a
        // duplicate that dropped this would silently turn every shared
        // stash into a per-meal item and multiply the copy's weight by its
        // meal count.
        isPerMeal: listFoodItems.isPerMeal,
        sortOrder: listFoodItems.sortOrder,
        isPacked: listFoodItems.isPacked,
        isReady: listFoodItems.isReady,
        packingLocationId: listFoodItems.packingLocationId,
        packSortOrder: listFoodItems.packSortOrder,
      })
      .from(listFoodItems)
      .where(and(eq(listFoodItems.listId, id), eq(listFoodItems.userId, userId)))
      .all()
    const sourceFoodLinks = tx
      .select({
        foodItemId: listFoodItemSlots.foodItemId,
        slotId: listFoodItemSlots.slotId,
      })
      .from(listFoodItemSlots)
      .where(
        and(
          eq(listFoodItemSlots.listId, id),
          eq(listFoodItemSlots.userId, userId),
        ),
      )
      .all()

    const newId = crypto.randomUUID()
    const now = Date.now()
    const locationCopies = sourceLocations.map((location) => ({
      ...location,
      newId: crypto.randomUUID(),
    }))
    const locationIdMap = new Map(
      locationCopies.map((location) => [location.id, location.newId]),
    )
    const itemCopies = items.map((item) => ({
      ...item,
      newId: crypto.randomUUID(),
    }))
    const itemIdMap = new Map(itemCopies.map((item) => [item.id, item.newId]))
    // Food copies. Each carried item is copied ONCE, keeping its quantity;
    // the associations are re-pointed at the new ids. Copying per
    // association would multiply the duplicate's food weight.
    const foodSlotCopies = sourceFoodSlots.map((slot) => ({
      ...slot,
      newId: crypto.randomUUID(),
    }))
    const foodSlotIdMap = new Map(foodSlotCopies.map((slot) => [slot.id, slot.newId]))
    const foodItemCopies = sourceFoodItems.map((item) => ({
      ...item,
      newId: crypto.randomUUID(),
    }))
    const foodItemIdMap = new Map(foodItemCopies.map((item) => [item.id, item.newId]))

    const row = tx
      .insert(lists)
      .values({
        id: newId,
        userId,
        name: copyName(source.name),
        description: source.description,
        slug,
        isShared: false,
        isDraft: true,
        sortOrder: nextSortOrder(),
        createdAt: now,
        updatedAt: now,
      })
      .returning(cols)
      .get()

    // Multi-row inserts, chunked. The food associations alone can reach
    // FOOD_ITEM_CAP x FOOD_SLOT_CAP = 18000 rows, 72000 bound parameters,
    // over SQLite's 32766 for one statement; chunkForParamCap keeps every
    // statement at a quarter of that, all in this one transaction.
    const insertChunks = <T extends Record<string, unknown>>(table: Table, rows: T[]) => {
      for (const chunk of chunkForParamCap(table, rows)) {
        tx.insert(table).values(chunk).run()
      }
    }

    // The cyclic graph goes in FK order: locations first with no container,
    // items second with their location assignment, then the item-backed
    // locations are linked below. The intermediate state is never visible
    // outside this transaction.
    insertChunks(
      packingLocations,
      locationCopies.map((location) => ({
        id: location.newId,
        userId,
        listId: newId,
        name: location.name,
        containerListItemId: null,
        sortOrder: location.sortOrder,
        createdAt: now,
        updatedAt: now,
      })),
    )
    insertChunks(
      listItems,
      itemCopies.map((it) => ({
        id: it.newId,
        userId,
        listId: newId,
        gearItemId: it.gearItemId,
        quantity: it.quantity,
        isWorn: it.isWorn,
        isConsumable: it.isConsumable,
        isPacked: it.isPacked,
        isReady: it.isReady,
        packingLocationId: remapPackingLocationId(it.packingLocationId, locationIdMap),
        sortOrder: it.sortOrder,
        // Verbatim, like sortOrder. A duplicate copies whole COHORTS - every
        // location is remapped as a set - so each rank stays unique within
        // its new cohort and the copy packs exactly like the original.
        packSortOrder: it.packSortOrder,
        createdAt: now,
        updatedAt: now,
      })),
    )
    for (const location of locationCopies) {
      if (location.containerListItemId === null) continue
      const copiedContainerItemId = itemIdMap.get(location.containerListItemId)
      if (!copiedContainerItemId) {
        throw new Error('packing location lost its container item during duplicate')
      }
      tx.update(packingLocations)
        .set({ containerListItemId: copiedContainerItemId })
        .where(
          and(
            eq(packingLocations.id, location.newId),
            eq(packingLocations.listId, newId),
            eq(packingLocations.userId, userId),
          ),
        )
        .run()
    }
    // Food after the list row exists; slots and items before the
    // associations that reference them.
    insertChunks(
      listFoodSlots,
      foodSlotCopies.map((slot) => ({
        id: slot.newId,
        userId,
        listId: newId,
        dayNumber: slot.dayNumber,
        meal: slot.meal,
        createdAt: now,
        updatedAt: now,
      })),
    )
    insertChunks(
      listFoodItems,
      foodItemCopies.map((item) => ({
        id: item.newId,
        userId,
        listId: newId,
        name: item.name,
        weightGrams: item.weightGrams,
        quantity: item.quantity,
        isPerMeal: item.isPerMeal,
        sortOrder: item.sortOrder,
        // Pack state copies like gear's: packed flag verbatim, location
        // remapped, rank verbatim (whole cohorts move as sets, so each rank
        // stays unique within its new cohort).
        isPacked: item.isPacked,
        isReady: item.isReady,
        packingLocationId: remapPackingLocationId(item.packingLocationId, locationIdMap),
        packSortOrder: item.packSortOrder,
        createdAt: now,
        updatedAt: now,
      })),
    )
    insertChunks(
      listFoodItemSlots,
      sourceFoodLinks.flatMap((link) => {
        const foodItemId = foodItemIdMap.get(link.foodItemId)
        const slotId = foodSlotIdMap.get(link.slotId)
        if (!foodItemId || !slotId) return []
        return [{ foodItemId, slotId, userId, listId: newId }]
      }),
    )
    return { ok: true, row }
  }
}
