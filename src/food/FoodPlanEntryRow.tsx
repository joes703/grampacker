import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleMinus, MoreVertical, Pencil } from 'lucide-react'
import type { FoodItem, FoodPlanEntry } from '../lib/types'
import { FLAT_TABLE_ROW, POPOVER_SURFACE } from '../components/flat-table-styles'
import { RowMenuItem } from '../components/RowMenuItem'
import { usePortalPopover } from '../lib/use-portal-popover'

const BASIS_LABEL: Record<FoodPlanEntry['basis'], string> = { servings: 'servings', packages: 'pkg', weight: 'g' }

function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)))
}

export default function FoodPlanEntryRow({
  entry, food, onEdit, onRemove,
}: {
  entry: FoodPlanEntry
  food: FoodItem | undefined
  onEdit?: () => void
  onRemove?: () => void
}) {
  const showKebab = Boolean(onEdit || onRemove)
  return (
    <div className={`${FLAT_TABLE_ROW} flex items-center justify-between gap-3`}>
      <span className="min-w-0 truncate text-sm text-gray-900">{food?.name ?? 'Unknown food'}</span>
      <span className="flex items-center gap-2 whitespace-nowrap text-sm text-gray-500">
        {formatAmount(entry.amount)} {BASIS_LABEL[entry.basis]}
        {showKebab && <EntryKebab onEdit={onEdit} onRemove={onRemove} />}
      </span>
    </div>
  )
}

// Kebab popover for an entry row. Mirrors ItemRow's RowKebab: a three-dot
// trigger plus a portal-rendered menu, with dismissal handled by
// usePortalPopover (no hand-rolled listeners). Each row owns its own open
// state so only one menu can be open per row.
function EntryKebab({
  onEdit,
  onRemove,
}: {
  onEdit?: () => void
  onRemove?: () => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const close = () => setOpen(false)

  usePortalPopover({ isOpen: open, onClose: close, triggerRef, contentRef: menuRef })

  function menuPos() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return { top: 0, left: 0 }
    return { top: rect.bottom + 4, left: rect.right - 192 }
  }
  const pos = open ? menuPos() : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        aria-label="Entry options"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
      >
        <MoreVertical size={14} />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className={`fixed z-50 w-48 py-1 ${POPOVER_SURFACE}`}
          style={{ top: pos.top, left: pos.left }}
        >
          {onEdit && (
            <RowMenuItem icon={<Pencil size={13} />} onClick={() => { close(); onEdit() }}>
              Edit
            </RowMenuItem>
          )}
          {onRemove && (
            <RowMenuItem icon={<CircleMinus size={13} />} onClick={() => { close(); onRemove() }} tone="removal">
              Remove
            </RowMenuItem>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
