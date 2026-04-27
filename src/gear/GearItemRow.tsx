import { Pencil, Trash2 } from 'lucide-react'
import type { GearItem } from '../lib/types'
import { formatItemWeight, type WeightUnit } from '../lib/weight'
import InlineText from '../components/InlineText'
import RowIconButton from '../components/RowIconButton'

type Props = {
  item: GearItem
  weightUnit: WeightUnit
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
  onInlineSave: (patch: Partial<Pick<GearItem, 'name' | 'description'>>) => void
  onEdit: () => void
  onDelete: () => void
}

export default function GearItemRow({
  item,
  weightUnit,
  selectMode,
  selected,
  onToggleSelect,
  onInlineSave,
  onEdit,
  onDelete,
}: Props) {
  return (
    <div
      className={`flex items-center gap-2 border-b border-gray-100 bg-white px-3 py-0.5 text-sm ${
        selected ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
    >
      {selectMode && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-4 w-4 rounded border-gray-300 text-blue-600"
        />
      )}
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <div className="flex-[2] min-w-0">
          <InlineText
            value={item.name}
            onSave={(v) => onInlineSave({ name: v })}
            className="block w-full truncate font-normal text-gray-900"
          />
        </div>
        {(item.description !== null || !selectMode) && (
          <div className="flex-[3] min-w-0">
            <InlineText
              value={item.description ?? ''}
              placeholder="Add description"
              onSave={(v) => onInlineSave({ description: v })}
              className="block w-full truncate text-xs text-gray-500"
            />
          </div>
        )}
      </div>
      <span className="shrink-0 w-16 text-right text-sm text-gray-600 tabular-nums">
        {formatItemWeight(item.weight_grams, weightUnit)}
      </span>
      {!selectMode && (
        <>
          <RowIconButton
            onClick={onEdit}
            title="Edit item"
            ariaLabel="Edit item"
            icon={<Pencil size={14} />}
          />
          <RowIconButton
            variant="danger"
            onClick={onDelete}
            title="Delete item"
            ariaLabel="Delete item"
            icon={<Trash2 size={14} />}
          />
        </>
      )}
    </div>
  )
}
