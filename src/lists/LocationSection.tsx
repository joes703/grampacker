import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { ListItemWithGear, PackingLocation } from '../lib/types'
import { makeDnDId } from '../lib/dnd-ids'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
import RowIconButton from '../components/RowIconButton'
import { RowMenuItem, RowMenuSeparator } from '../components/RowMenuItem'
import {
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_SURFACE,
  POPOVER_SURFACE,
} from '../components/flat-table-styles'
import PackingItemRow from './PackingItemRow'

type Props = {
  location: PackingLocation | null
  items: ListItemWithGear[]
  locations: PackingLocation[]
  mobile: boolean
  movePending: boolean
  dragHandle?: ReactNode
  onRename?: (name: string) => void
  onDelete?: () => void
  onMove: (itemId: string, locationId: string | null) => void
}

export default function LocationSection({
  location,
  items,
  locations,
  mobile,
  movePending,
  dragHandle,
  onRename,
  onDelete,
  onMove,
}: Props) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(location?.name ?? '')
  const { open, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-flush', menuWidth: 192 })
  const title = location?.name ?? 'Unassigned'

  function commitRename() {
    const name = draft.trim()
    if (name && name !== location?.name) onRename?.(name)
    else setDraft(location?.name ?? '')
    setRenaming(false)
  }

  return (
    <section className={FLAT_TABLE_SURFACE} aria-label={title}>
      <div className="flex min-h-10 items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
        {dragHandle}
        {renaming ? (
          <input
            autoFocus
            value={draft}
            maxLength={60}
            aria-label="Packing location name"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename()
              if (event.key === 'Escape') {
                setDraft(location?.name ?? '')
                setRenaming(false)
              }
            }}
            className="min-w-0 flex-1 rounded border border-blue-400 bg-white px-2 py-1 text-sm font-semibold text-gray-900"
          />
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{title}</h2>
        )}
        <span className={FLAT_TABLE_META_TEXT}>
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
        {location && onRename && onDelete ? (
          <>
            <RowIconButton
              ref={triggerRef}
              onClick={() => open ? close() : openMenu()}
              ariaLabel={`${title} options`}
              icon={<MoreVertical size={14} />}
            />
            {open && menuPos && 'left' in menuPos && createPortal(
              <div
                ref={menuRef}
                role="group"
                aria-label={`${title} actions`}
                className={`fixed z-50 w-48 py-1 ${POPOVER_SURFACE}`}
                style={{ top: menuPos.top, left: menuPos.left }}
              >
                <RowMenuItem icon={<Pencil size={13} />} onClick={() => {
                  close()
                  setRenaming(true)
                }}>
                  Rename
                </RowMenuItem>
                <RowMenuSeparator />
                <RowMenuItem icon={<Trash2 size={13} />} tone="danger" onClick={() => {
                  close()
                  onDelete()
                }}>
                  Delete location
                </RowMenuItem>
              </div>,
              document.body,
            )}
          </>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-3 text-sm text-gray-500">
          {location ? 'No items in this location.' : 'Everything has a location.'}
        </p>
      ) : (
        <SortableContext
          items={items.map((item) => makeDnDId('packing-item', item.id))}
          strategy={verticalListSortingStrategy}
        >
          {items.map((item) => (
            <PackingItemRow
              key={item.id}
              item={item}
              locations={locations}
              mobile={mobile}
              disabled={movePending}
              onMove={(locationId) => onMove(item.id, locationId)}
            />
          ))}
        </SortableContext>
      )}
    </section>
  )
}
