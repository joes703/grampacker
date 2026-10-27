import { foodUnitCount, type UpdateFoodItemRequest } from '../../shared/food'
import { formatItemWeight, type WeightUnit } from '../lib/weight'

// The food editor dialog's working copy of an item. Pure data so the summary
// and the patch diff are testable without rendering. `slotIds` must already be
// filtered to the slots that still exist - the dialog derives it from the live
// slot list every render, so an id trimmed while the dialog is open can never
// reach the summary or a write.
export type FoodItemDraft = {
  name: string
  weightGrams: number
  quantity: number
  isPerMeal: boolean
  slotIds: readonly string[]
}

type FoodItemSummary = {
  /** What the plan carries of this item - foodUnitCount, never a local copy. */
  unitCount: number
  /** The carried weight, or null when the typed weight is still 0. */
  weightLabel: string | null
  /** Plain-words arithmetic behind the count, e.g. "2 per meal × 4 meals". */
  note: string
}

export function foodItemSummary(draft: FoodItemDraft, unit: WeightUnit): FoodItemSummary {
  const unitCount = foodUnitCount(draft)
  const weightLabel =
    draft.weightGrams > 0 ? formatItemWeight(draft.weightGrams * unitCount, unit) : null
  const meals = `${draft.slotIds.length} ${draft.slotIds.length === 1 ? 'meal' : 'meals'}`
  let note: string
  if (draft.isPerMeal) {
    note =
      draft.slotIds.length === 0
        ? // Mirrors foodUnitCount: an unscheduled per-meal item counts one
          // meal's worth rather than zero, so it is never weightless.
          "not scheduled yet — counted as one meal's worth"
        : `${draft.quantity} per meal × ${meals}`
  } else {
    const amount = draft.quantity === 1 ? 'one container' : `${draft.quantity} total`
    note = draft.slotIds.length === 0 ? `${amount}, not scheduled yet` : `${amount} across ${meals}`
  }
  return { unitCount, weightLabel, note }
}

// The changed fields between the item as the dialog opened (`baseline`) and
// the draft at submit, or null when nothing changed. Diffing against the
// OPEN-TIME baseline, not the current cache item, is load-bearing: a
// background refetch can change a field the user never touched, and a diff
// against the fresher copy would write the stale draft value over it. The
// accepted residual gap (two clients editing the SAME field) is the food
// revision guard in SECURITY.md, same as every other food write.
//
// false, 0 and [] are real values and survive the diff; the server's
// nonEmptyPatch only refuses a patch with no defined fields at all.
export function foodItemPatch(
  baseline: FoodItemDraft,
  draft: FoodItemDraft,
): UpdateFoodItemRequest | null {
  const patch: UpdateFoodItemRequest = {}
  const name = draft.name.trim()
  if (name !== baseline.name.trim()) patch.name = name
  if (draft.weightGrams !== baseline.weightGrams) patch.weightGrams = draft.weightGrams
  if (draft.quantity !== baseline.quantity) patch.quantity = draft.quantity
  if (draft.isPerMeal !== baseline.isPerMeal) patch.isPerMeal = draft.isPerMeal
  if (!sameIdSet(baseline.slotIds, draft.slotIds)) patch.slotIds = [...draft.slotIds]
  return Object.keys(patch).length === 0 ? null : patch
}

// Membership comparison: the picker's order is presentation, not data.
function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}
