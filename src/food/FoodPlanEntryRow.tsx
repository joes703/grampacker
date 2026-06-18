import { createPortal } from 'react-dom'
import { CircleMinus, Copy, FolderInput, MoreVertical, Pencil } from 'lucide-react'
import type { FoodItem, FoodPlanEntry } from '../lib/types'
import { FLAT_TABLE_ROW, POPOVER_SURFACE } from '../components/flat-table-styles'
import { RowMenuItem } from '../components/RowMenuItem'
import RowIconButton from '../components/RowIconButton'
import { useAnchoredMenu } from '../lib/use-anchored-menu'

const BASIS_LABEL: Record<FoodPlanEntry['basis'], string> = { servings: 'servings', packages: 'pkg', weight: 'g' }

function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)))
}

export default function FoodPlanEntryRow({
  entry, food, onEdit, onMove, onCopy, onRemove, dragHandle, outerRef, outerStyle,
}: {
  entry: FoodPlanEntry
  food: FoodItem | undefined
  onEdit?: () => void
  onMove?: () => void
  onCopy?: () => void
  onRemove?: () => void
  dragHandle?: React.ReactNode
  outerRef?: (el: HTMLElement | null) => void
  outerStyle?: React.CSSProperties
}) {
  const showKebab = Boolean(onEdit || onMove || onCopy || onRemove)
  return (
    <div ref={outerRef} style={outerStyle} className={`${FLAT_TABLE_ROW} flex items-center justify-between gap-3`}>
      <span className="flex min-w-0 items-center gap-1">
        {dragHandle}
        <span className="min-w-0 truncate text-sm text-gray-900">{food?.name ?? 'Unknown food'}</span>
      </span>
      <span className="flex items-center gap-2 whitespace-nowrap text-sm text-gray-500">
        {formatAmount(entry.amount)} {BASIS_LABEL[entry.basis]}
        {showKebab && <EntryKebab onEdit={onEdit} onMove={onMove} onCopy={onCopy} onRemove={onRemove} />}
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
  onMove,
  onCopy,
  onRemove,
}: {
  onEdit?: () => void
  onMove?: () => void
  onCopy?: () => void
  onRemove?: () => void
}) {
  const { open: menuOpen, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-flush', menuWidth: 192 })

  return (
    <>
      <RowIconButton
        ref={triggerRef}
        onClick={(e) => { e.stopPropagation(); if (menuOpen) close(); else openMenu() }}
        ariaLabel="Entry options"
        icon={<MoreVertical size={14} />}
      />

      {menuOpen && menuPos && 'left' in menuPos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className={`fixed z-50 w-48 py-1 ${POPOVER_SURFACE}`}
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {onEdit && (
            <RowMenuItem icon={<Pencil size={13} />} onClick={() => { close(); onEdit() }}>
              Edit quantity
            </RowMenuItem>
          )}
          {onMove && (
            <RowMenuItem icon={<FolderInput size={13} />} onClick={() => { close(); onMove() }}>
              Move to...
            </RowMenuItem>
          )}
          {onCopy && (
            <RowMenuItem icon={<Copy size={13} />} onClick={() => { close(); onCopy() }}>
              Copy to...
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
