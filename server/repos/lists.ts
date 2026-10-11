import { and, asc, eq, sql } from 'drizzle-orm'
import { runBatch, type Db } from '../db'
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
import {
  isForeignKeyViolation,
  isTriggerAbort,
  isUniqueViolation,
} from './db-errors'
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

export type ListRow = {
  id: string
  name: string
  description: string | null
  slug: string
  isShared: boolean
  isDraft: boolean
  sortOrder: number
  createdAt: number // epoch ms
  updatedAt: number // epoch ms
}

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

export function isListCapError(err: unknown): boolean {
  return isTriggerAbort(err, 'list cap exceeded')
}

const SLUG_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
// A fresh slug colliding twice is already ~1-in-2^71; five failures in a
// row means something is broken, not unlucky - throw and let it 500.
const SLUG_ATTEMPTS = 5

// 6-char base62 share slug, minted server-side (the old repo generated
// client-side and retried on 23505; server-side removes that trust).
// b % 62 carries a tiny modulo bias (256 = 4*62 + 8); acceptable for a
// share URL - effective entropy stays ~35.7 of 35.8 bits.
export function generateSlug(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => SLUG_ALPHABET[b % 62]).join('')
}

// Every write that mints a slug races the lists_slug_unique index, so all of
// them need the same retry. This is that loop, once: create, duplicate,
// from-selection, import, and rotateShareLink all run through it.
//
// It ONLY handles slug collisions. A caller that maps other failures to a
// result (the list-cap trigger, say) catches those itself and rethrows the
// rest, which is what lets a collision reach this loop and retry.
//
// Exported for its own test: five write paths now depend on this loop, and the
// collision it exists for is far too rare to reach through the HTTP surface.
export async function withFreshSlug<T>(
  attempt: (slug: string) => Promise<T>,
): Promise<T> {
  for (let i = 0; i < SLUG_ATTEMPTS; i++) {
    try {
      return await attempt(generateSlug())
    } catch (err) {
      if (isUniqueViolation(err, 'lists.slug')) continue
      throw err
    }
  }
  throw new Error('slug generation exhausted retries')
}

// Suffix used when duplicating a list. Truncates so the " (copy)" suffix
// cannot push the name past the column's 256 CHECK (the old Postgres RPC had
// that latent overflow).
export function copyName(name: string): string {
  return `${name.slice(0, 249)} (copy)`
}

export function remapPackingLocationId(
  sourceId: string | null,
  idMap: ReadonlyMap<string, string>,
): string | null {
  return sourceId === null ? null : (idMap.get(sourceId) ?? null)
}

export function createListsRepo(db: Db, userId: string) {
  // Owned-set membership, not inArray over the input: D1 caps bound
  // parameters at 100 per query and the reorder DTO allows LIST_CAP (100)
  // ids - which with userId is already 101 params (see chunk-ids.ts). The
  // list cap bounds the scan at 100 rows.
  async function ownsAllListIds(ids: string[]): Promise<boolean> {
    const ownedRows = await db
      .select({ id: lists.id })
      .from(lists)
      .where(eq(lists.userId, userId))
    const owned = new Set(ownedRows.map((r) => r.id))
    return ids.every((id) => owned.has(id))
  }

  function nextSortOrder() {
    return sql`coalesce((select max(${lists.sortOrder}) + 1 from ${lists} where ${lists.userId} = ${userId}), 0)`
  }

  // Builders for the import precheck's owned-set reads, shared with its
  // FK-recovery path so the two run the same queries: the precheck awaits
  // them one by one, recovery batches both into one consistent snapshot.
  function ownedCategoryIdsProbe() {
    return db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.userId, userId))
  }

  function ownedGearIdsProbe() {
    return db
      .select({ id: gearItems.id })
      .from(gearItems)
      .where(eq(gearItems.userId, userId))
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
      return withFreshSlug(async (slug) => {
        const now = Date.now()
        try {
          const [row] = await db
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
          if (!row) throw new Error('list insert returned no row')
          return { ok: true, row }
        } catch (err) {
          if (isListCapError(err)) return { ok: false, reason: 'cap_exceeded' }
          throw err
        }
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
      if (!(await ownsAllListIds(updates.map((u) => u.id)))) return false
      const [first, ...rest] = updates.map((u) =>
        db
          .update(lists)
          .set({ sortOrder: u.sortOrder })
          .where(and(eq(lists.id, u.id), eq(lists.userId, userId))),
      )
      if (!first) return true // unreachable: DTO enforces min(1)
      await runBatch(db, [first, ...rest])
      return true
    },

    // Deep copy: name gets "(copy)", every membership row is copied
    // (including packed/ready state - old duplicate_list behavior), and
    // isShared/isDraft deliberately reset to false/true so a copy is
    // never silently public.
    //
    // Everything lands in ONE db.batch in FK order (list -> packing locations
    // -> items -> container links), so a late failure - the list cap trigger
    // included - leaves no half-copied list behind.
    async duplicate(id: string): Promise<DuplicateListResult> {
      const [source] = await db
        .select(cols)
        .from(lists)
        .where(and(eq(lists.id, id), eq(lists.userId, userId)))
        .limit(1)
      if (!source) return { ok: false, reason: 'not_found' }
      // Items and locations are one D1 batch snapshot so a concurrent delete
      // cannot split the organization graph across two moments.
      const [items, sourceLocations, sourceFoodSlots, sourceFoodItems, sourceFoodLinks] =
        await runBatch(db, [
        db
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
          .where(
            and(eq(listItems.listId, id), eq(listItems.userId, userId)),
          ),
        db
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
          ),
        // Food rides in the SAME snapshot batch as items and locations, so a
        // duplicate cannot capture a half-edited trip.
        db
          .select({
            id: listFoodSlots.id,
            dayNumber: listFoodSlots.dayNumber,
            meal: listFoodSlots.meal,
          })
          .from(listFoodSlots)
          .where(
            and(eq(listFoodSlots.listId, id), eq(listFoodSlots.userId, userId)),
          ),
        db
          .select({
            id: listFoodItems.id,
            name: listFoodItems.name,
            weightGrams: listFoodItems.weightGrams,
            quantity: listFoodItems.quantity,
            // Copied, not defaulted. quantity means nothing without it: a
            // duplicate that dropped this would silently turn every shared
            // stash into a per-meal item and multiply the copy's weight by
            // its meal count.
            isPerMeal: listFoodItems.isPerMeal,
            sortOrder: listFoodItems.sortOrder,
            isPacked: listFoodItems.isPacked,
            isReady: listFoodItems.isReady,
            packingLocationId: listFoodItems.packingLocationId,
            packSortOrder: listFoodItems.packSortOrder,
          })
          .from(listFoodItems)
          .where(
            and(eq(listFoodItems.listId, id), eq(listFoodItems.userId, userId)),
          ),
        db
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
          ),
      ])

      return withFreshSlug(async (slug) => {
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
        // Food copies. Each carried item is copied ONCE, keeping its quantity;
        // the associations are re-pointed at the new ids. Copying per
        // association would multiply the duplicate's food weight.
        const foodSlotCopies = sourceFoodSlots.map((slot) => ({
          ...slot,
          newId: crypto.randomUUID(),
        }))
        const foodSlotIdMap = new Map(
          foodSlotCopies.map((slot) => [slot.id, slot.newId]),
        )
        const foodItemCopies = sourceFoodItems.map((item) => ({
          ...item,
          newId: crypto.randomUUID(),
        }))
        const foodItemIdMap = new Map(
          foodItemCopies.map((item) => [item.id, item.newId]),
        )
        const itemIdMap = new Map(
          itemCopies.map((item) => [item.id, item.newId]),
        )
        const insertList = db
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
        const locationRows = locationCopies.map((location) => ({
          id: location.newId,
          userId,
          listId: newId,
          name: location.name,
          // Insert the two halves of the cyclic graph in FK order: locations
          // first with no source, items second with their location assignment,
          // then link item-backed locations below. The whole db.batch is one
          // transaction, so the nullable intermediate state is never visible.
          containerListItemId: null,
          sortOrder: location.sortOrder,
          createdAt: now,
          updatedAt: now,
        }))
        const insertLocations = chunkForParamCap(packingLocations, locationRows).map((rows) =>
          db.insert(packingLocations).values(rows),
        )
        const itemRows = itemCopies.map((it) => ({
          id: it.newId,
          userId,
          listId: newId,
          gearItemId: it.gearItemId,
          quantity: it.quantity,
          isWorn: it.isWorn,
          isConsumable: it.isConsumable,
          isPacked: it.isPacked,
          isReady: it.isReady,
          packingLocationId: remapPackingLocationId(
            it.packingLocationId,
            locationIdMap,
          ),
          sortOrder: it.sortOrder,
          // Verbatim, like sortOrder. A duplicate copies whole COHORTS - every
          // location is remapped as a set - so each rank stays unique within
          // its new cohort and the copy packs exactly like the original.
          packSortOrder: it.packSortOrder,
          createdAt: now,
          updatedAt: now,
        }))
        // Multi-row inserts (floor(90/columns) rows each) rather than one
        // statement per item: with the assignment column, 300 items is 50
        // statements instead of 300,
        // which matters because the whole batch can already carry up to 371
        // plan-copy statements ahead of it.
        const insertItems = chunkForParamCap(listItems, itemRows).map((rows) =>
          db.insert(listItems).values(rows),
        )
        const foodSlotRows = foodSlotCopies.map((slot) => ({
          id: slot.newId,
          userId,
          listId: newId,
          dayNumber: slot.dayNumber,
          meal: slot.meal,
          createdAt: now,
          updatedAt: now,
        }))
        const foodItemRows = foodItemCopies.map((item) => ({
          id: item.newId,
          userId,
          listId: newId,
          name: item.name,
          weightGrams: item.weightGrams,
          quantity: item.quantity,
          isPerMeal: item.isPerMeal,
          sortOrder: item.sortOrder,
          // Pack state copies like gear's: packed flag verbatim, location
          // remapped, rank verbatim (whole cohorts move as sets, so each
          // rank stays unique within its new cohort).
          isPacked: item.isPacked,
          isReady: item.isReady,
          packingLocationId: remapPackingLocationId(
            item.packingLocationId,
            locationIdMap,
          ),
          packSortOrder: item.packSortOrder,
          createdAt: now,
          updatedAt: now,
        }))
        const foodLinkRows = sourceFoodLinks.flatMap((link) => {
          const foodItemId = foodItemIdMap.get(link.foodItemId)
          const slotId = foodSlotIdMap.get(link.slotId)
          if (!foodItemId || !slotId) return []
          return [{ foodItemId, slotId, userId, listId: newId }]
        })
        const insertFoodSlots = chunkForParamCap(listFoodSlots, foodSlotRows).map((rows) =>
          db.insert(listFoodSlots).values(rows),
        )
        const insertFoodItems = chunkForParamCap(listFoodItems, foodItemRows).map((rows) =>
          db.insert(listFoodItems).values(rows),
        )
        const insertFoodLinks = chunkForParamCap(listFoodItemSlots, foodLinkRows).map((rows) =>
          db.insert(listFoodItemSlots).values(rows),
        )
        const linkContainerLocations = locationCopies.flatMap((location) => {
          if (location.containerListItemId === null) return []
          const copiedContainerItemId = itemIdMap.get(location.containerListItemId)
          if (!copiedContainerItemId) {
            throw new Error('packing location lost its container item during duplicate')
          }
          return [
            db
              .update(packingLocations)
              .set({ containerListItemId: copiedContainerItemId })
              .where(
                and(
                  eq(packingLocations.id, location.newId),
                  eq(packingLocations.listId, newId),
                  eq(packingLocations.userId, userId),
                ),
              ),
          ]
        })
        try {
          const results = await runBatch(db, [
            insertList,
            ...insertLocations,
            ...insertItems,
            ...linkContainerLocations,
            // Food after the list row exists; slots and items before the
            // associations that reference them.
            ...insertFoodSlots,
            ...insertFoodItems,
            ...insertFoodLinks,
          ])
          const inserted = results[0] as ListRow[]
          const row = inserted[0]
          if (!row) throw new Error('list duplicate returned no row')
          return { ok: true, row }
        } catch (err) {
          if (isListCapError(err)) return { ok: false, reason: 'cap_exceeded' }
          throw err
        }
      })
    },

    // Atomic CSV list import: new categories, new gear, the list row,
    // and its items land in ONE db.batch (parity with the old app's
    // create_list_with_imported_items RPC - a late failure leaves no
    // orphans). Ownership of every referenced existing category/gear id
    // is checked first via owned-set membership (zero writes on failure;
    // D1's 100-param cap rules out inArray, see chunk-ids.ts). Cap
    // triggers stay the single enforcement points: any abort rolls back
    // the whole import. Batch order is list -> categories -> gear ->
    // items so FK targets always precede their referencing rows and the
    // returning list row stays at index 0 (the duplicate() pattern).
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
      if (existingCategoryIds.size > 0) {
        const ownedRows = await ownedCategoryIdsProbe()
        const owned = new Set(ownedRows.map((r) => r.id))
        for (const id of existingCategoryIds) {
          if (!owned.has(id)) return { ok: false, reason: 'invalid_category' }
        }
      }
      const existingGearIds = new Set(
        input.items.flatMap((i) =>
          i.gear.kind === 'existing' ? [i.gear.id] : [],
        ),
      )
      if (existingGearIds.size > 0) {
        const ownedRows = await ownedGearIdsProbe()
        const owned = new Set(ownedRows.map((r) => r.id))
        for (const id of existingGearIds) {
          if (!owned.has(id)) return { ok: false, reason: 'invalid_gear' }
        }
      }

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

      return withFreshSlug(async (slug) => {
        const newListId = crypto.randomUUID()
        const now = Date.now()
        const insertList = db
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
        // Statements in a batch run sequentially inside one transaction,
        // so each max(sortOrder)+1 subquery sees the rows inserted before
        // it - appended blocks come out contiguous past the existing max.
        const insertCategories = newCategories.map((c) =>
          db.insert(categories).values({
            id: c.id,
            userId,
            name: c.name,
            sortOrder: sql`coalesce((select max(${categories.sortOrder}) + 1 from ${categories} where ${categories.userId} = ${userId}), 0)`,
            createdAt: now,
          }),
        )
        const insertGear = newGear.map((g) =>
          db.insert(gearItems).values({
            id: g.id,
            userId,
            categoryId: resolveCategoryId(g.category),
            name: g.name,
            description: g.description,
            weightGrams: g.weightGrams,
            costCents: g.costCents,
            // The list CSV format carries no purchaseDate (no column for it);
            // status is app-internal only (same contract as the gear import).
            status: 'active',
            sortOrder: sql`coalesce((select max(${gearItems.sortOrder}) + 1 from ${gearItems} where ${gearItems.userId} = ${userId}), 0)`,
            createdAt: now,
            updatedAt: now,
          }),
        )
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
        const insertItems = input.items.map((item, index) =>
          db.insert(listItems).values({
            id: crypto.randomUUID(),
            userId,
            listId: newListId,
            gearItemId: resolveGearId(item.gear),
            quantity: item.quantity,
            isWorn: item.isWorn,
            isConsumable: item.isConsumable,
            // The original CSV row index; dropped empty-name rows leave
            // intentional gaps (old-repo parity).
            sortOrder: item.sortOrder,
            // Everything imported lands Unassigned, so the whole file is one
            // cohort and this dense rank orders it.
            packSortOrder: packRanks.get(index) ?? 0,
            createdAt: now,
            updatedAt: now,
          }),
        )
        try {
          const [inserted] = await runBatch(db, [
            insertList,
            ...insertCategories,
            ...insertGear,
            ...insertItems,
          ])
          const row = inserted[0]
          if (!row) throw new Error('list import returned no row')
          return { ok: true, row }
        } catch (err) {
          if (isListCapError(err)) return { ok: false, reason: 'cap_exceeded' }
          if (isGearCapError(err)) {
            return { ok: false, reason: 'gear_cap_exceeded' }
          }
          if (isListItemCapError(err)) {
            return { ok: false, reason: 'item_cap_exceeded' }
          }
          if (isCategoryCapError(err)) {
            return { ok: false, reason: 'category_cap_exceeded' }
          }
          // A referenced existing category or gear row was deleted between
          // the owned-set precheck and the batch. SQLite's FK error never
          // says which constraint failed, so re-probe both owned sets in one
          // batch - categories before gear, the precheck's own order - and
          // answer exactly what the precheck would have. The imported list
          // itself was created inside the rolled-back batch, so it is never
          // probed as a parent. An FK neither set explains rethrows: that is
          // a programming defect and must stay a loud 500. (A slug collision
          // is a UNIQUE violation, not an FK one, so it still falls through
          // to withFreshSlug's retry.)
          if (isForeignKeyViolation(err)) {
            const [catRows, gearRows] = await runBatch(db, [
              ownedCategoryIdsProbe(),
              ownedGearIdsProbe(),
            ])
            const ownedCats = new Set(catRows.map((r) => r.id))
            for (const id of existingCategoryIds) {
              if (!ownedCats.has(id)) {
                return { ok: false, reason: 'invalid_category' }
              }
            }
            const ownedGear = new Set(gearRows.map((r) => r.id))
            for (const id of existingGearIds) {
              if (!ownedGear.has(id)) {
                return { ok: false, reason: 'invalid_gear' }
              }
            }
          }
          throw err
        }
      })
    },

    // Gear-page "Create list from selection". All-or-nothing: one
    // non-owned gear id rejects the whole call with zero writes; the
    // batch is a real transaction on D1. Item order follows the array.
    async createFromSelection(
      name: string,
      description: string | null,
      gearItemIds: string[],
    ): Promise<FromSelectionResult> {
      // Owned-set membership, not inArray over the selection: D1 caps
      // bound parameters at 100 per query and the DTO allows up to 300
      // gear ids (see chunk-ids.ts). The gear cap bounds the scan at 500.
      const ownedRows = await db
        .select({ id: gearItems.id })
        .from(gearItems)
        .where(eq(gearItems.userId, userId))
      const owned = new Set(ownedRows.map((r) => r.id))
      if (!gearItemIds.every((id) => owned.has(id))) {
        return { ok: false, reason: 'invalid_gear' }
      }

      return withFreshSlug(async (slug) => {
        const newId = crypto.randomUUID()
        const now = Date.now()
        const insertList = db
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
        const insertItems = gearItemIds.map((gearItemId, i) =>
          db.insert(listItems).values({
            id: crypto.randomUUID(),
            userId,
            listId: newId,
            gearItemId,
            sortOrder: i,
            // One fresh list, everything Unassigned: one cohort, so the
            // selection index serves as both ranks.
            packSortOrder: i,
            createdAt: now,
            updatedAt: now,
          }),
        )
        try {
          const [inserted] = await runBatch(db, [insertList, ...insertItems])
          const row = inserted[0]
          if (!row) throw new Error('list from-selection returned no row')
          return { ok: true, row }
        } catch (err) {
          if (isListCapError(err)) return { ok: false, reason: 'cap_exceeded' }
          throw err
        }
      })
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
      return withFreshSlug(async (slug) => {
        const [row] = await db
          .update(lists)
          .set({ slug, updatedAt: Date.now() })
          .where(and(eq(lists.id, id), eq(lists.userId, userId)))
          .returning(cols)
        return row ? { ok: true, row } : { ok: false, reason: 'not_found' }
      })
    },
  }
}
