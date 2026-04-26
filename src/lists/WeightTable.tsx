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

export default function WeightTable({ items, categories }: Props) {
  // Accumulate base weight (non-worn, non-consumable) per category
  const basePerCat = new Map<string | null, number>()
  let consumableGrams = 0
  let wornGrams = 0

  for (const item of items) {
    const w = item.weight_grams * item.quantity
    if (item.is_consumable) {
      consumableGrams += w
    } else if (item.is_worn) {
      wornGrams += w
    } else {
      const key = item.gear_item?.category_id ?? null
      basePerCat.set(key, (basePerCat.get(key) ?? 0) + w)
    }
  }

  // Order categories by sort_order, uncategorised last
  const sortedCats = [...categories]
    .filter((c) => basePerCat.has(c.id))
    .sort((a, b) => a.sort_order - b.sort_order)

  const catRows = sortedCats.map((c) => ({ name: c.name, grams: basePerCat.get(c.id)! }))
  if (basePerCat.has(null)) {
    catRows.push({ name: 'Uncategorised', grams: basePerCat.get(null)! })
  }

  const baseGrams = catRows.reduce((s, r) => s + r.grams, 0)
  const totalPackGrams = baseGrams + consumableGrams

  if (items.length === 0) return null

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <table className="w-full text-sm text-gray-700">
        <tbody className="divide-y divide-gray-50">
          {catRows.map((row) => (
            <tr key={row.name}>
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
            <tr className="text-gray-500">
              <td className="py-0.5 pl-4 pr-3">Worn (not added)</td>
              <td className="py-0.5 px-3 text-right tabular-nums">{fmtG(wornGrams)}</td>
              <td className="py-0.5 px-3 text-right tabular-nums">{fmtLbOz(wornGrams)}</td>
            </tr>
          )}
          <tr className="font-semibold">
            <td className="py-0.5 pl-4 pr-3">Total pack weight</td>
            <td className="py-0.5 px-3 text-right tabular-nums">{fmtG(totalPackGrams)}</td>
            <td className="py-0.5 px-3 text-right tabular-nums">{fmtLbOz(totalPackGrams)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
