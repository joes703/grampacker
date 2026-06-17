import { createPortal } from 'react-dom'
import { MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
import RowIconButton from '../components/RowIconButton'
import { RowMenuItem, RowMenuSeparator } from '../components/RowMenuItem'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_BODY_TEXT_MUTED,
  FLAT_TABLE_ROW,
  POPOVER_SURFACE,
} from '../components/flat-table-styles'
import type { FoodItem } from '../lib/types'

type Props = {
  food: FoodItem
  onEdit: (food: FoodItem) => void
  onDelete: (food: FoodItem) => void
}

function servingSummary(f: FoodItem): string {
  const base = f.serving_description
    ? `${f.serving_description} (${f.serving_weight_grams} g)`
    : `${f.serving_weight_grams} g`
  return `${base} - ${f.calories_per_serving} kcal`
}

export default function FoodItemRow({ food, onEdit, onDelete }: Props) {
  return (
    <div
      className={`group relative ${FLAT_TABLE_ROW} ${FLAT_TABLE_BODY_TEXT} gap-1.5 bg-white px-3 py-2 lg:py-0 hover:bg-gray-50`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-normal text-gray-900">{food.name}</p>
        <p className={`truncate ${FLAT_TABLE_BODY_TEXT_MUTED}`}>
          {food.brand ? `${food.brand} - ` : ''}
          {servingSummary(food)}
        </p>
      </div>
      <FoodRowKebab
        name={food.name}
        onEdit={() => onEdit(food)}
        onDelete={() => onDelete(food)}
      />
    </div>
  )
}

// Kebab popover mirroring GearRowKebab (src/gear/GearItemRow.tsx): three-dot
// trigger + portal-rendered menu via useAnchoredMenu. Each row owns its own
// menu state so multiple kebabs can't open at once. Items: Edit, Delete.
export function FoodRowKebab({
  name,
  onEdit,
  onDelete,
}: {
  name: string
  onEdit: () => void
  onDelete: () => void
}) {
  const { open, openMenu, close, triggerRef, menuRef, menuPos } = useAnchoredMenu({
    variant: 'right-flush',
    menuWidth: 192,
  })

  return (
    <>
      <RowIconButton
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation()
          if (open) close()
          else openMenu()
        }}
        ariaLabel={`Options for ${name}`}
        icon={<MoreVertical size={14} />}
      />

      {open &&
        menuPos &&
        'left' in menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className={`fixed z-50 w-48 py-1 ${POPOVER_SURFACE}`}
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <RowMenuItem icon={<Pencil size={13} />} onClick={() => { close(); onEdit() }}>
              Edit
            </RowMenuItem>
            <RowMenuSeparator />
            <RowMenuItem
              icon={<Trash2 size={13} />}
              onClick={() => { close(); onDelete() }}
              tone="danger"
            >
              Delete from library
            </RowMenuItem>
          </div>,
          document.body,
        )}
    </>
  )
}
