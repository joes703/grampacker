import { type ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Pencil, Trash2 } from 'lucide-react'
import type { GearItem } from '../lib/types'
import { formatItemWeight, type WeightUnit } from '../lib/weight'
import { asButtonRef } from '../lib/dnd'
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
  // Drag plumbing — populated by SortableGearItemRow.
  dragHandle?: ReactNode
  outerRef?: (el: HTMLElement | null) => void
  outerStyle?: React.CSSProperties
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
  dragHandle,
  outerRef,
  outerStyle,
}: Props) {
  return (
    <div
      ref={outerRef}
      style={outerStyle}
      className={`group relative flex items-center gap-1.5 border-b border-gray-100 bg-white px-3 py-0.5 text-sm ${
        selected ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
    >
      {dragHandle}
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
              className="block w-full truncate text-sm font-normal text-gray-500"
            />
          </div>
        )}
      </div>
      <span className="shrink-0 w-24 text-right tabular-nums text-gray-600">
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

// Sortable wrapper for the gear library page. Calls useSortable, wires the
// row's outer ref + transform style + a hover-revealed drag handle, then
// forwards everything to GearItemRow. Must be inside a SortableContext.
// Drag is disabled in select mode so the row's checkbox doesn't compete with
// the drag activator.
export function SortableGearItemRow(props: Omit<Props, 'dragHandle' | 'outerRef' | 'outerStyle'>) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.item.id, disabled: props.selectMode })

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const handle = props.selectMode ? undefined : (
    <RowIconButton
      ref={asButtonRef(setActivatorNodeRef)}
      {...listeners}
      {...attributes}
      tabIndex={-1}
      variant="dragHandle"
      ariaLabel="Drag to reorder"
      icon={<GripVertical size={14} />}
      className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
    />
  )

  return (
    <GearItemRow
      {...props}
      dragHandle={handle}
      outerRef={setNodeRef}
      outerStyle={sortableStyle}
    />
  )
}
