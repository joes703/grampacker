import { and, asc, eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { categories, gearItems, listItems, lists } from '../db/schema'
import { isTriggerAbort, isUniqueViolation } from './db-errors'
import { isCapError as isGearCapError } from './gear-items'
import { isListItemCapError } from './list-items'

const cols = {
  id: lists.id,
  name: lists.name,
  description: lists.description,
  slug: lists.slug,
  isShared: lists.isShared,
  groupWorn: lists.groupWorn,
  readyChecksEnabled: lists.readyChecksEnabled,
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
  groupWorn: boolean
  readyChecksEnabled: boolean
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
  groupWorn?: boolean
  readyChecksEnabled?: boolean
  isDraft?: boolean
}

export type ListWriteResult =
  | { ok: true; row: ListRow }
  | { ok: false; reason: 'cap_exceeded' | 'not_found' }

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
        | 'invalid_category'
        | 'invalid_gear'
    }

// The 0004 trigger is the single enforcement point; keep in lockstep
// with its WHEN clause and message (same discipline as GEAR_ITEM_CAP).
export const LIST_CAP = 100

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

// "(copy)" suffix must not push the name past the 256 CHECK; the old
// Postgres RPC had the same latent overflow, fixed here rather than
// ported.
function copyName(name: string): string {
  return `${name.slice(0, 249)} (copy)`
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

  return {
    async list(): Promise<ListRow[]> {
      return db
        .select(cols)
        .from(lists)
        .where(eq(lists.userId, userId))
        .orderBy(asc(lists.sortOrder), asc(lists.name))
    },

    async create(name: string): Promise<ListWriteResult> {
      for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
        const now = Date.now()
        try {
          const [row] = await db
            .insert(lists)
            .values({
              id: crypto.randomUUID(),
              userId,
              name,
              slug: generateSlug(),
              sortOrder: nextSortOrder(),
              createdAt: now,
              updatedAt: now,
            })
            .returning(cols)
          if (!row) throw new Error('list insert returned no row')
          return { ok: true, row }
        } catch (err) {
          if (isUniqueViolation(err, 'lists.slug')) continue
          if (isListCapError(err)) return { ok: false, reason: 'cap_exceeded' }
          throw err
        }
      }
      throw new Error('slug generation exhausted retries')
    },

    async update(id: string, patch: UpdateListPatch): Promise<ListWriteResult> {
      const set: Record<string, unknown> = { updatedAt: Date.now() }
      if (patch.name !== undefined) set.name = patch.name
      if (patch.description !== undefined) set.description = patch.description
      if (patch.isShared !== undefined) set.isShared = patch.isShared
      if (patch.groupWorn !== undefined) set.groupWorn = patch.groupWorn
      if (patch.readyChecksEnabled !== undefined)
        set.readyChecksEnabled = patch.readyChecksEnabled
      if (patch.isDraft !== undefined) set.isDraft = patch.isDraft
      const [row] = await db
        .update(lists)
        .set(set)
        .where(and(eq(lists.id, id), eq(lists.userId, userId)))
        .returning(cols)
      return row ? { ok: true, row } : { ok: false, reason: 'not_found' }
    },

    // The composite FK cascades membership rows; gear itself is untouched.
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
      await db.batch([first, ...rest])
      return true
    },

    // Deep copy: name gets "(copy)", every membership row is copied
    // (including packed/ready state - old duplicate_list behavior), and
    // isShared/isDraft deliberately reset to false/true so a copy is
    // never silently public.
    async duplicate(id: string): Promise<ListWriteResult> {
      const [source] = await db
        .select(cols)
        .from(lists)
        .where(and(eq(lists.id, id), eq(lists.userId, userId)))
        .limit(1)
      if (!source) return { ok: false, reason: 'not_found' }
      const items = await db
        .select({
          gearItemId: listItems.gearItemId,
          quantity: listItems.quantity,
          isWorn: listItems.isWorn,
          isConsumable: listItems.isConsumable,
          isPacked: listItems.isPacked,
          isReady: listItems.isReady,
          sortOrder: listItems.sortOrder,
        })
        .from(listItems)
        .where(and(eq(listItems.listId, id), eq(listItems.userId, userId)))

      for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
        const newId = crypto.randomUUID()
        const now = Date.now()
        const insertList = db
          .insert(lists)
          .values({
            id: newId,
            userId,
            name: copyName(source.name),
            description: source.description,
            slug: generateSlug(),
            isShared: false,
            groupWorn: source.groupWorn,
            readyChecksEnabled: source.readyChecksEnabled,
            isDraft: true,
            sortOrder: nextSortOrder(),
            createdAt: now,
            updatedAt: now,
          })
          .returning(cols)
        const insertItems = items.map((it) =>
          db.insert(listItems).values({
            id: crypto.randomUUID(),
            userId,
            listId: newId,
            gearItemId: it.gearItemId,
            quantity: it.quantity,
            isWorn: it.isWorn,
            isConsumable: it.isConsumable,
            isPacked: it.isPacked,
            isReady: it.isReady,
            sortOrder: it.sortOrder,
            createdAt: now,
            updatedAt: now,
          }),
        )
        try {
          const [inserted] = await db.batch([insertList, ...insertItems])
          const row = inserted[0]
          if (!row) throw new Error('list duplicate returned no row')
          return { ok: true, row }
        } catch (err) {
          if (isUniqueViolation(err, 'lists.slug')) continue
          if (isListCapError(err)) return { ok: false, reason: 'cap_exceeded' }
          throw err
        }
      }
      throw new Error('slug generation exhausted retries')
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
        const ownedRows = await db
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.userId, userId))
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
        const ownedRows = await db
          .select({ id: gearItems.id })
          .from(gearItems)
          .where(eq(gearItems.userId, userId))
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

      for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
        const newListId = crypto.randomUUID()
        const now = Date.now()
        const insertList = db
          .insert(lists)
          .values({
            id: newListId,
            userId,
            name: input.name,
            slug: generateSlug(),
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
            // The list CSV format carries no cost/purchaseDate; status is
            // app-internal only (same contract as the gear import).
            status: 'active',
            sortOrder: sql`coalesce((select max(${gearItems.sortOrder}) + 1 from ${gearItems} where ${gearItems.userId} = ${userId}), 0)`,
            createdAt: now,
            updatedAt: now,
          }),
        )
        const insertItems = input.items.map((item) =>
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
            createdAt: now,
            updatedAt: now,
          }),
        )
        try {
          const [inserted] = await db.batch([
            insertList,
            ...insertCategories,
            ...insertGear,
            ...insertItems,
          ])
          const row = inserted[0]
          if (!row) throw new Error('list import returned no row')
          return { ok: true, row }
        } catch (err) {
          if (isUniqueViolation(err, 'lists.slug')) continue
          if (isListCapError(err)) return { ok: false, reason: 'cap_exceeded' }
          if (isGearCapError(err)) {
            return { ok: false, reason: 'gear_cap_exceeded' }
          }
          if (isListItemCapError(err)) {
            return { ok: false, reason: 'item_cap_exceeded' }
          }
          throw err
        }
      }
      throw new Error('slug generation exhausted retries')
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

      for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
        const newId = crypto.randomUUID()
        const now = Date.now()
        const insertList = db
          .insert(lists)
          .values({
            id: newId,
            userId,
            name,
            description,
            slug: generateSlug(),
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
            createdAt: now,
            updatedAt: now,
          }),
        )
        try {
          const [inserted] = await db.batch([insertList, ...insertItems])
          const row = inserted[0]
          if (!row) throw new Error('list from-selection returned no row')
          return { ok: true, row }
        } catch (err) {
          if (isUniqueViolation(err, 'lists.slug')) continue
          if (isListCapError(err)) return { ok: false, reason: 'cap_exceeded' }
          throw err
        }
      }
      throw new Error('slug generation exhausted retries')
    },
  }
}
