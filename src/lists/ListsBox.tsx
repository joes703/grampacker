import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CopyPlus, Download, GripVertical, MoreVertical, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import type { List } from '../lib/types'

type RowActions = {
  onImport: (list: List) => void
  onExport: (list: List) => void
  onDuplicate: (list: List) => void
  onDelete: (list: List) => void
}

type Props = RowActions & {
  lists: List[]
  activeId: string | undefined
  creating: boolean
  newDraft: string
  onNewDraftChange: (v: string) => void
  onStartNew: () => void
  onSubmitNew: () => void
  onCancelNew: () => void
  onSelect: (list: List) => void
  onRename: (list: List, name: string) => void
  onReorder: (orderedIds: string[]) => void
}

export default function ListsBox({
  lists,
  activeId,
  creating,
  newDraft,
  onNewDraftChange,
  onStartNew,
  onSubmitNew,
  onCancelNew,
  onSelect,
  onRename,
  onImport,
  onExport,
  onDuplicate,
  onDelete,
  onReorder,
}: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = lists.findIndex((l) => l.id === active.id)
    const newIndex = lists.findIndex((l) => l.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onReorder(arrayMove(lists, oldIndex, newIndex).map((l) => l.id))
  }

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Lists</p>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-gray-50" style={{ maxHeight: '40vh' }}>
        {lists.length === 0 ? (
          <p className="px-3 py-3 text-center text-xs text-gray-400 italic">No lists yet</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={lists.map((l) => l.id)} strategy={verticalListSortingStrategy}>
              {lists.map((list) => (
                <ListsBoxRow
                  key={list.id}
                  list={list}
                  active={list.id === activeId}
                  onSelect={() => onSelect(list)}
                  onRename={(name) => onRename(list, name)}
                  onImport={() => onImport(list)}
                  onExport={() => onExport(list)}
                  onDuplicate={() => onDuplicate(list)}
                  onDelete={() => onDelete(list)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      <div className="border-t border-gray-100 bg-gray-50 p-1">
        {creating ? (
          <input
            autoFocus
            type="text"
            placeholder="List name"
            value={newDraft}
            onChange={(e) => onNewDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmitNew()
              if (e.key === 'Escape') onCancelNew()
            }}
            onBlur={() => {
              if (newDraft.trim()) onSubmitNew()
              else onCancelNew()
            }}
            className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none"
          />
        ) : (
          <button
            onClick={onStartNew}
            className="flex w-full items-center justify-center gap-1 rounded px-2 py-1 text-sm text-blue-600 hover:bg-blue-50"
          >
            <Plus size={14} /> New list
          </button>
        )}
      </div>
    </div>
  )
}

function ListsBoxRow({
  list,
  active,
  onSelect,
  onRename,
  onImport,
  onExport,
  onDuplicate,
  onDelete,
}: {
  list: List
  active: boolean
  onSelect: () => void
  onRename: (name: string) => void
  onImport: () => void
  onExport: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(list.name)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuOpen = menuPos !== null

  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: list.id })

  useEffect(() => {
    if (renaming) inputRef.current?.select()
  }, [renaming])

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
    function handleScroll() {
      setMenuPos(null)
    }
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

  function commit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== list.name) onRename(trimmed)
    setRenaming(false)
  }

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  if (renaming) {
    return (
      <div ref={setNodeRef} style={sortableStyle} className="px-2 py-1.5">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setDraft(list.name); setRenaming(false) }
          }}
          className="w-full rounded border border-blue-400 px-2 py-0.5 text-sm focus:outline-none"
        />
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={sortableStyle}
      className={`group relative flex items-center transition-colors ${
        active ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
    >
      {/* Drag handle */}
      <button
        ref={setActivatorNodeRef as unknown as (node: HTMLButtonElement | null) => void}
        {...listeners}
        {...attributes}
        className="cursor-grab touch-none px-1 py-1.5 text-gray-300 hover:text-gray-500 active:cursor-grabbing shrink-0"
        tabIndex={-1}
        aria-label="Drag to reorder list"
      >
        <GripVertical size={13} />
      </button>

      <button
        onClick={onSelect}
        onDoubleClick={() => { setDraft(list.name); setRenaming(true) }}
        className={`flex-1 min-w-0 text-left pr-3 py-1.5 text-sm ${
          active ? 'text-blue-700 font-medium' : 'text-gray-700'
        }`}
        title="Click to switch · double-click to rename"
      >
        <span className="truncate block">{list.name}</span>
      </button>

      {/* 3-dot menu trigger */}
      <button
        ref={triggerRef}
        onClick={(e) => { e.stopPropagation(); menuOpen ? setMenuPos(null) : openMenu() }}
        className="shrink-0 mr-1 rounded p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100"
        aria-label="List options"
      >
        <MoreVertical size={14} />
      </button>

      {menuOpen && menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <MenuItem
            icon={<Pencil size={13} />}
            onClick={() => { setMenuPos(null); setDraft(list.name); setRenaming(true) }}
          >
            Rename
          </MenuItem>
          <MenuItem icon={<Upload size={13} />} onClick={() => { setMenuPos(null); onImport() }}>
            Import CSV
          </MenuItem>
          <MenuItem icon={<Download size={13} />} onClick={() => { setMenuPos(null); onExport() }}>
            Export CSV
          </MenuItem>
          <MenuItem icon={<CopyPlus size={13} />} onClick={() => { setMenuPos(null); onDuplicate() }}>
            Duplicate
          </MenuItem>
          <div className="my-1 border-t border-gray-100" />
          <MenuItem icon={<Trash2 size={13} />} onClick={() => { setMenuPos(null); onDelete() }} danger>
            Delete
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
