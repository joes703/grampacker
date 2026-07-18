import { and, asc, eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { foodItems } from '../db/schema'
import { isTriggerAbort } from './db-errors'

const cols = {
  id: foodItems.id,
  name: foodItems.name,
  brand: foodItems.brand,
  servingDescription: foodItems.servingDescription,
  servingWeightGrams: foodItems.servingWeightGrams,
  caloriesPerServing: foodItems.caloriesPerServing,
  servingsPerPackage: foodItems.servingsPerPackage,
  fatGrams: foodItems.fatGrams,
  saturatedFatGrams: foodItems.saturatedFatGrams,
  carbsGrams: foodItems.carbsGrams,
  fiberGrams: foodItems.fiberGrams,
  sugarGrams: foodItems.sugarGrams,
  proteinGrams: foodItems.proteinGrams,
  sodiumMg: foodItems.sodiumMg,
  potassiumMg: foodItems.potassiumMg,
  notes: foodItems.notes,
  sortOrder: foodItems.sortOrder,
  createdAt: foodItems.createdAt,
  updatedAt: foodItems.updatedAt,
}

export type FoodItemRow = {
  id: string
  name: string
  brand: string | null
  servingDescription: string | null
  servingWeightGrams: number
  caloriesPerServing: number
  servingsPerPackage: number | null
  fatGrams: number | null
  saturatedFatGrams: number | null
  carbsGrams: number | null
  fiberGrams: number | null
  sugarGrams: number | null
  proteinGrams: number | null
  sodiumMg: number | null
  potassiumMg: number | null
  notes: string | null
  sortOrder: number
  createdAt: number // epoch ms
  updatedAt: number // epoch ms
}

export type CreateFoodItemInput = {
  name: string
  brand: string | null
  servingDescription: string | null
  servingWeightGrams: number
  caloriesPerServing: number
  servingsPerPackage: number | null
  fatGrams: number | null
  saturatedFatGrams: number | null
  carbsGrams: number | null
  fiberGrams: number | null
  sugarGrams: number | null
  proteinGrams: number | null
  sodiumMg: number | null
  potassiumMg: number | null
  notes: string | null
}

// PATCH semantics: undefined = unchanged, null = clear (nullable fields).
// servingWeightGrams / caloriesPerServing are NOT NULL, so not nullable here.
export type UpdateFoodItemPatch = {
  name?: string
  brand?: string | null
  servingDescription?: string | null
  servingWeightGrams?: number
  caloriesPerServing?: number
  servingsPerPackage?: number | null
  fatGrams?: number | null
  saturatedFatGrams?: number | null
  carbsGrams?: number | null
  fiberGrams?: number | null
  sugarGrams?: number | null
  proteinGrams?: number | null
  sodiumMg?: number | null
  potassiumMg?: number | null
  notes?: string | null
}

export type FoodWriteResult =
  | { ok: true; row: FoodItemRow }
  | { ok: false; reason: 'cap_exceeded' | 'not_found' }

export type ImportFoodResult =
  | { ok: true; createdItems: number }
  | { ok: false; reason: 'cap_exceeded' }

// The DB trigger in migration 0007 is the SINGLE enforcement point for the
// cap - no read-then-insert race to lose (mirrors gear, PR #13). The repo
// maps the trigger's RAISE(ABORT) message to a friendly result; keep this
// matcher, the trigger's WHEN clause, and its message in lockstep.
//
// Root-cause-only matching (mirrors gear, PR #14): the outer wrappers embed
// bound params, so matching any other link in the chain would let a food
// literally named 'food item cap exceeded' misclassify an unrelated failure.
export function isFoodCapError(err: unknown): boolean {
  return isTriggerAbort(err, 'food item cap exceeded')
}

export function createFoodItemsRepo(db: Db, userId: string) {
  return {
    async list(): Promise<FoodItemRow[]> {
      return db
        .select(cols)
        .from(foodItems)
        .where(eq(foodItems.userId, userId))
        .orderBy(asc(foodItems.sortOrder), asc(foodItems.name))
    },

    async create(input: CreateFoodItemInput): Promise<FoodWriteResult> {
      const now = Date.now()
      try {
        const [row] = await db
          .insert(foodItems)
          .values({
            id: crypto.randomUUID(),
            userId,
            name: input.name,
            brand: input.brand,
            servingDescription: input.servingDescription,
            servingWeightGrams: input.servingWeightGrams,
            caloriesPerServing: input.caloriesPerServing,
            servingsPerPackage: input.servingsPerPackage,
            fatGrams: input.fatGrams,
            saturatedFatGrams: input.saturatedFatGrams,
            carbsGrams: input.carbsGrams,
            fiberGrams: input.fiberGrams,
            sugarGrams: input.sugarGrams,
            proteinGrams: input.proteinGrams,
            sodiumMg: input.sodiumMg,
            potassiumMg: input.potassiumMg,
            notes: input.notes,
            sortOrder: sql`coalesce((select max(${foodItems.sortOrder}) + 1 from ${foodItems} where ${foodItems.userId} = ${userId}), 0)`,
            createdAt: now,
            updatedAt: now,
          })
          .returning(cols)
        if (!row) throw new Error('food item insert returned no row')
        return { ok: true, row }
      } catch (err) {
        if (isFoodCapError(err)) return { ok: false, reason: 'cap_exceeded' }
        throw err
      }
    },

    // Bulk CSV import: one insert statement per row, all in ONE db.batch (a
    // single D1 transaction) - either every row lands or none do. Mirrors
    // gear's importBatch: per-statement inserts rather than chunked
    // multi-row VALUES because each statement's max(sortOrder)+1 subquery
    // sees the rows inserted by the statements before it, which is what
    // makes sortOrder come out sequential in CSV order past the existing
    // max (a subquery inside one multi-row VALUES has no such guarantee).
    // Params per statement (~20) sit far under D1's 100 cap. The cap
    // trigger aborts the whole batch -> friendly cap result, same taxonomy
    // as single create.
    async importBatch(items: CreateFoodItemInput[]): Promise<ImportFoodResult> {
      const now = Date.now()
      const statements = items.map((input) =>
        db.insert(foodItems).values({
          id: crypto.randomUUID(),
          userId,
          name: input.name,
          brand: input.brand,
          servingDescription: input.servingDescription,
          servingWeightGrams: input.servingWeightGrams,
          caloriesPerServing: input.caloriesPerServing,
          servingsPerPackage: input.servingsPerPackage,
          fatGrams: input.fatGrams,
          saturatedFatGrams: input.saturatedFatGrams,
          carbsGrams: input.carbsGrams,
          fiberGrams: input.fiberGrams,
          sugarGrams: input.sugarGrams,
          proteinGrams: input.proteinGrams,
          sodiumMg: input.sodiumMg,
          potassiumMg: input.potassiumMg,
          notes: input.notes,
          sortOrder: sql`coalesce((select max(${foodItems.sortOrder}) + 1 from ${foodItems} where ${foodItems.userId} = ${userId}), 0)`,
          createdAt: now,
          updatedAt: now,
        }),
      )
      const [first, ...rest] = statements
      if (!first) {
        // Unreachable: the DTO enforces min(1) items.
        return { ok: true, createdItems: 0 }
      }
      try {
        await db.batch([first, ...rest])
      } catch (err) {
        if (isFoodCapError(err)) return { ok: false, reason: 'cap_exceeded' }
        throw err
      }
      return { ok: true, createdItems: items.length }
    },

    async update(
      id: string,
      patch: UpdateFoodItemPatch,
    ): Promise<FoodWriteResult> {
      const set: Record<string, unknown> = { updatedAt: Date.now() }
      if (patch.name !== undefined) set.name = patch.name
      if (patch.brand !== undefined) set.brand = patch.brand
      if (patch.servingDescription !== undefined)
        set.servingDescription = patch.servingDescription
      if (patch.servingWeightGrams !== undefined)
        set.servingWeightGrams = patch.servingWeightGrams
      if (patch.caloriesPerServing !== undefined)
        set.caloriesPerServing = patch.caloriesPerServing
      if (patch.servingsPerPackage !== undefined)
        set.servingsPerPackage = patch.servingsPerPackage
      if (patch.fatGrams !== undefined) set.fatGrams = patch.fatGrams
      if (patch.saturatedFatGrams !== undefined)
        set.saturatedFatGrams = patch.saturatedFatGrams
      if (patch.carbsGrams !== undefined) set.carbsGrams = patch.carbsGrams
      if (patch.fiberGrams !== undefined) set.fiberGrams = patch.fiberGrams
      if (patch.sugarGrams !== undefined) set.sugarGrams = patch.sugarGrams
      if (patch.proteinGrams !== undefined)
        set.proteinGrams = patch.proteinGrams
      if (patch.sodiumMg !== undefined) set.sodiumMg = patch.sodiumMg
      if (patch.potassiumMg !== undefined) set.potassiumMg = patch.potassiumMg
      if (patch.notes !== undefined) set.notes = patch.notes
      const [row] = await db
        .update(foodItems)
        .set(set)
        .where(and(eq(foodItems.id, id), eq(foodItems.userId, userId)))
        .returning(cols)
      return row ? { ok: true, row } : { ok: false, reason: 'not_found' }
    },

    async remove(id: string): Promise<boolean> {
      const rows = await db
        .delete(foodItems)
        .where(and(eq(foodItems.id, id), eq(foodItems.userId, userId)))
        .returning({ id: foodItems.id })
      return rows.length > 0
    },
  }
}
