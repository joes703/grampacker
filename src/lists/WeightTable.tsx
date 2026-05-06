import { useMemo } from 'react'
import type { ListItemWithGear, Category } from '../lib/types'
import { gramsToLbOzParts } from '../lib/weight'

type Props = {
  items: ListItemWithGear[]
  categories: Category[]
}

function fmtG(grams: number): string {
  return `${grams} g`
}

function fmtLbOz(grams: number): string {
  const { lb, oz } = gramsToLbOzParts(grams)
  if (lb > 0) return `${lb} lb ${oz.toFixed(1)} oz`
  return `${oz.toFixed(1)} oz`
}

// Stable row identity for React keys. Real categories use their uuid;
// the synthetic Uncategorized row uses the same '__uncategorized__'
// sentinel as GearLibraryPage to avoid colliding with any real id.
export type WeightBreakdown = {
  catRows: { id: string; name: string; grams: number }[]
  baseGrams: number
  consumableGrams: number
  wornGrams: number
  totalPackGrams: number
}

export function computeWeightBreakdown(
  items: ListItemWithGear[],
  categories: Category[],
): WeightBreakdown {
  const basePerCat = new Map<string | null, number>()
  let consumableGrams = 0
  let wornGrams = 0

  for (const item of items) {
    const w = item.gear_item.weight_grams * item.quantity
    if (item.is_consumable) {
      consumableGrams += w
    } else if (item.is_worn) {
      wornGrams += w
    } else {
      // Route unknown category ids (cache drift between ['categories'] and
      // ['list-items']) to Uncategorized so their weight still sums into base.
      const raw = item.gear_item.category_id
      const key = raw !== null && categories.some((c) => c.id === raw) ? raw : null
      basePerCat.set(key, (basePerCat.get(key) ?? 0) + w)
    }
  }

  const sortedCats = [...categories]
    .filter((c) => basePerCat.has(c.id))
    .sort((a, b) => a.sort_order - b.sort_order)

  const catRows = sortedCats.map((c) => {
    const grams = basePerCat.get(c.id)
    if (grams === undefined) throw new Error('computeWeightBreakdown: filtered key missing — unreachable')
    return { id: c.id, name: c.name, grams }
  })
  const uncatGrams = basePerCat.get(null)
  if (uncatGrams !== undefined) {
    catRows.push({ id: '__uncategorized__', name: 'Uncategorized', grams: uncatGrams })
  }

  const baseGrams = catRows.reduce((s, r) => s + r.grams, 0)
  const totalPackGrams = baseGrams + consumableGrams

  return { catRows, baseGrams, consumableGrams, wornGrams, totalPackGrams }
}

export default function WeightTable({ items, categories }: Props) {
  // Hook must be called unconditionally; the empty-list early return moved
  // below the memo. The memo guards against unrelated parent re-renders
  // (notes editor keystroke, dialog open/close) recomputing the breakdown
  // — pack-mode toggles still rebuild because `items` reference changes
  // there, but those are the renders where the breakdown legitimately
  // changes anyway.
  const breakdown = useMemo(
    () => computeWeightBreakdown(items, categories),
    [items, categories],
  )

  if (items.length === 0) return null

  const { catRows, baseGrams, consumableGrams, wornGrams, totalPackGrams } = breakdown

  return (
    <table className="w-full text-sm text-gray-700">
        <tbody className="divide-y divide-gray-50">
          {catRows.map((row) => (
            <tr key={row.id}>
              <td className="py-0.5 pl-4 pr-3">{row.name}</td>
              <td className="py-0.5 px-3 text-right tabular-nums">{fmtG(row.grams)}</td>
              <td className="py-0.5 px-3 text-right tabular-nums">{fmtLbOz(row.grams)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="divide-y divide-gray-100 border-t-2 border-gray-200">
          <tr className="font-semibold">
            <td className="py-0.5 pl-4 pr-3">Base weight</td>
            <td className="py-0.5 px-3 text-right tabular-nums">{fmtG(baseGrams)}</td>
            <td className="py-0.5 px-3 text-right tabular-nums">{fmtLbOz(baseGrams)}</td>
          </tr>
          {consumableGrams > 0 && (
            <tr>
              <td className="py-0.5 pl-4 pr-3">Consumables</td>
              <td className="py-0.5 px-3 text-right tabular-nums">{fmtG(consumableGrams)}</td>
              <td className="py-0.5 px-3 text-right tabular-nums">{fmtLbOz(consumableGrams)}</td>
            </tr>
          )}
          {wornGrams > 0 && (
            <tr className="text-gray-400">
              <td className="py-0.5 pl-4 pr-3">Worn (not added)</td>
              <td className="py-0.5 px-3 text-right tabular-nums">{fmtG(wornGrams)}</td>
              <td className="py-0.5 px-3 text-right tabular-nums">{fmtLbOz(wornGrams)}</td>
            </tr>
          )}
          <tr className="font-semibold border-t-2 border-gray-200">
            <td className="py-0.5 pl-4 pr-3">Total pack weight</td>
            <td className="py-0.5 px-3 text-right tabular-nums">{fmtG(totalPackGrams)}</td>
            <td className="py-0.5 px-3 text-right tabular-nums">{fmtLbOz(totalPackGrams)}</td>
          </tr>
        </tfoot>
    </table>
  )
}
