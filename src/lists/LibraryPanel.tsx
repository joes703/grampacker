import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, MoreHorizontal, Pencil, Search, Trash2 } from 'lucide-react'
import type { GearItem, Category } from '../lib/types'
import { formatItemWeight, type WeightUnit } from '../lib/weight'
import ConfirmDialog from '../components/ConfirmDialog'

type Props = {
  gearItems: GearItem[]
  categories: Category[]
  listItemGearIds: Set<string>
  weightUnit: WeightUnit
  onAdd: (item: GearItem) => void
  onRemove: (item: GearItem) => void
  onEdit: (item: GearItem) => void
  onDelete: (item: GearItem) => void
}

export default function LibraryPanel({ gearItems, categories, listItemGearIds, weightUnit, onAdd, onRemove, onEdit, onDelete }: Props) {
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState(new Set<string>())
  const [deleteCandidate, setDeleteCandidate] = useState<GearItem | null>(null)

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const q = search.trim().toLowerCase()
  const filtered = q
    ? gearItems.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          (g.description?.toLowerCase().includes(q) ?? false),
      )
    : gearItems

  // Build groups ordered by category sort_order
  const sortedCats = [...categories].sort((a, b) => a.sort_order - b.sort_order)
  const groups = sortedCats
    .map((cat) => ({ category: cat, items: filtered.filter((g) => g.category_id === cat.id) }))
    .filter((g) => g.items.length > 0)

  const uncategorised = filtered.filter((g) => g.category_id === null)

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="p-3 border-b border-gray-200">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search gear…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Category groups */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {groups.length === 0 && uncategorised.length === 0 ? (
          <p className="p-4 text-center text-sm text-gray-400 italic">
            {q ? 'No items found' : 'No gear items yet'}
          </p>
        ) : (
          <>
            {groups.map(({ category, items }) => (
              <CategoryGroup
                key={category.id}
                name={category.name}
                items={items}
                collapsed={collapsed.has(category.id)}
                onToggle={() => toggleCollapse(category.id)}
                listItemGearIds={listItemGearIds}
                weightUnit={weightUnit}
                onAdd={onAdd}
                onRemove={onRemove}
                onEdit={onEdit}
                onRequestDelete={(item) => setDeleteCandidate(item)}
              />
            ))}
            {uncategorised.length > 0 && (
              <CategoryGroup
                name="Uncategorised"
                items={uncategorised}
                collapsed={collapsed.has('__uncategorised__')}
                onToggle={() => toggleCollapse('__uncategorised__')}
                listItemGearIds={listItemGearIds}
                weightUnit={weightUnit}
                onAdd={onAdd}
                onRemove={onRemove}
                onEdit={onEdit}
                onRequestDelete={(item) => setDeleteCandidate(item)}
              />
            )}
          </>
        )}
      </div>

      {deleteCandidate && (
        <ConfirmDialog
          title="Delete from inventory"
          message={`This will remove "${deleteCandidate.name}" from your inventory and from any list it appears on. This cannot be undone.`}
          confirmLabel="Delete"
          dangerous
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={() => {
            const item = deleteCandidate
            setDeleteCandidate(null)
            onDelete(item)
          }}
        />
      )}
    </div>
  )
}

function CategoryGroup({
  name,
  items,
  collapsed,
  onToggle,
  listItemGearIds,
  weightUnit,
  onAdd,
  onRemove,
  onEdit,
  onRequestDelete,
}: {
  name: string
  items: GearItem[]
  collapsed: boolean
  onToggle: () => void
  listItemGearIds: Set<string>
  weightUnit: WeightUnit
  onAdd: (item: GearItem) => void
  onRemove: (item: GearItem) => void
  onEdit: (item: GearItem) => void
  onRequestDelete: (item: GearItem) => void
}) {
  return (
    <div>
      {/* Category header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-3 py-0.5 bg-gray-50 hover:bg-gray-100 text-left border-b border-gray-100"
      >
        {collapsed ? (
          <ChevronRight size={13} className="shrink-0 text-gray-400" />
        ) : (
          <ChevronDown size={13} className="shrink-0 text-gray-400" />
        )}
        <span className="flex-1 text-sm font-medium text-gray-700">
          {name}
        </span>
        <span className="text-xs tabular-nums text-gray-400">{items.length}</span>
      </button>

      {/* Items */}
      {!collapsed && (
        <div>
          {items.map((item) => (
            <LibraryItemRow
              key={item.id}
              item={item}
              inList={listItemGearIds.has(item.id)}
              weightUnit={weightUnit}
              onAdd={onAdd}
              onRemove={onRemove}
              onEdit={onEdit}
              onRequestDelete={onRequestDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Single panel row: clicking the row body adds/removes the item, the kebab
// opens a small menu with Edit / Delete-from-inventory. Per-row menu state
// (open + position) is colocated here so each row manages its own popover.
function LibraryItemRow({
  item,
  inList,
  weightUnit,
  onAdd,
  onRemove,
  onEdit,
  onRequestDelete,
}: {
  item: GearItem
  inList: boolean
  weightUnit: WeightUnit
  onAdd: (item: GearItem) => void
  onRemove: (item: GearItem) => void
  onEdit: (item: GearItem) => void
  onRequestDelete: (item: GearItem) => void
}) {
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuOpen = menuPos !== null

  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e: MouseEvent) {
      const t = e.target as Node
      if (
        menuRef.current && !menuRef.current.contains(t) &&
        triggerRef.current && !triggerRef.current.contains(t)
      ) {
        setMenuPos(null)
      }
    }
    function handleScroll() { setMenuPos(null) }
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [menuOpen])

  function openMenu() {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const menuWidth = 176 // matches w-44
    setMenuPos({
      top: rect.bottom + 4,
      left: Math.max(8, rect.right - menuWidth),
    })
  }

  return (
    <div className="flex items-center border-b border-gray-100 hover:bg-gray-50 focus-within:bg-gray-50">
      <button
        type="button"
        onClick={() => (inList ? onRemove(item) : onAdd(item))}
        title={inList ? 'Click to remove from list' : 'Click to add to list'}
        className="flex flex-1 min-w-0 items-center gap-2 px-3 py-0.5 text-left focus:outline-none"
      >
        <span
          className={`flex-1 min-w-0 truncate text-sm font-normal ${
            inList ? 'text-gray-400' : 'text-gray-900'
          }`}
        >
          {item.name}
        </span>
        <span
          className={`shrink-0 text-xs tabular-nums ${
            inList ? 'text-gray-300' : 'text-gray-500'
          }`}
        >
          {formatItemWeight(item.weight_grams, weightUnit)}
        </span>
      </button>

      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); if (menuOpen) setMenuPos(null); else openMenu() }}
        aria-label="Item options"
        className="shrink-0 mr-1 inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-gray-700"
      >
        <MoreHorizontal size={14} />
      </button>

      {menuOpen && menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <MenuItem icon={<Pencil size={13} />} onClick={() => { setMenuPos(null); onEdit(item) }}>
            Edit
          </MenuItem>
          <div className="my-1 border-t border-gray-100" />
          <MenuItem
            icon={<Trash2 size={13} />}
            onClick={() => { setMenuPos(null); onRequestDelete(item) }}
            danger
          >
            Delete from inventory
          </MenuItem>
        </div>,
        document.body,
      )}
    </div>
  )
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  )
}
