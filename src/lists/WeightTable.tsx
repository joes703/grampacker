import type { ListItemWithGear } from '../lib/types'
import type { Category } from '../lib/types'
import { computeWeightRollup, gramsToLbOzParts } from '../lib/weight'

type Props = {
  items: ListItemWithGear[]
  categories: Category[]
}

function fmt(grams: number) {
  const { lb, oz } = gramsToLbOzParts(grams)
  const ozStr = oz.toFixed(1)
  return { g: `${grams} g`, lboz: lb > 0 ? `${lb} lb ${ozStr} oz` : `${ozStr} oz` }
}

type RowData = {
  label: string
  grams: number
  isSummary?: boolean
  isSubtotal?: boolean
}

export default function WeightTable({ items, categories }: Props) {
  // Group items by category
  const catMap = new Map(categories.map((c) => [c.id, c.name]))
  const grouped = new Map<string, ListItemWithGear[]>()

  for (const item of items) {
    const key = item.gear_item?.category_id ?? '__uncategorised__'
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(item)
  }

  const rows: RowData[] = []

  for (const [key, catItems] of grouped) {
    const catName = key === '__uncategorised__' ? 'Uncategorised' : (catMap.get(key) ?? 'Unknown')
    const catGrams = catItems.reduce((s, i) => s + i.weight_grams * i.quantity, 0)
    rows.push({ label: catName, grams: catGrams, isSubtotal: true })
    for (const item of catItems) {
      const name = item.gear_item?.name ?? '(deleted item)'
      const label = item.quantity > 1 ? `${name} ×${item.quantity}` : name
      rows.push({ label, grams: item.weight_grams * item.quantity })
    }
  }

  const all = computeWeightRollup(items.map((i) => ({
    weight_grams: i.weight_grams,
    quantity: i.quantity,
    is_worn: i.is_worn,
    is_consumable: i.is_consumable,
  })))

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500">
            <th className="py-2 pl-4 pr-2 text-left">Item</th>
            <th className="py-2 px-3 text-right">g</th>
            <th className="py-2 px-3 text-right">lb + oz</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const { g, lboz } = fmt(row.grams)
            return (
              <tr
                key={i}
                className={
                  row.isSubtotal
                    ? 'border-t border-gray-100 bg-gray-50 font-medium text-gray-700'
                    : 'border-t border-gray-50 text-gray-600'
                }
              >
                <td className={`py-1.5 pr-2 ${row.isSubtotal ? 'pl-4' : 'pl-8'}`}>{row.label}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{g}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{lboz}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot className="border-t-2 border-gray-200 text-xs font-semibold">
          <SummaryRow label="Total" grams={all.totalGrams} />
          {all.wornGrams > 0 && <SummaryRow label="Worn" grams={all.wornGrams} muted />}
          {all.consumableGrams > 0 && <SummaryRow label="Consumable" grams={all.consumableGrams} muted />}
          <SummaryRow label="Base weight" grams={all.baseGrams} highlight />
        </tfoot>
      </table>
    </div>
  )
}

function SummaryRow({ label, grams, muted, highlight }: { label: string; grams: number; muted?: boolean; highlight?: boolean }) {
  const { g, lboz } = fmt(grams)
  return (
    <tr className={highlight ? 'bg-blue-50 text-blue-800' : muted ? 'text-gray-500' : 'text-gray-700'}>
      <td className="py-1.5 pl-4 pr-2">{label}</td>
      <td className="py-1.5 px-3 text-right tabular-nums">{g}</td>
      <td className="py-1.5 px-3 text-right tabular-nums">{lboz}</td>
    </tr>
  )
}
