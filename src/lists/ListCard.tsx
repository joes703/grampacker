import { useState, useRef, useEffect } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, MoreVertical, Pencil, Copy, Trash2, Check, X } from 'lucide-react'
import type { List } from '../lib/types'

type Props = {
  list: List
  onOpen: () => void
  onRename: (name: string) => void
  onDuplicate: () => void
  onDelete: () => void
}

export default function ListCard({ list, onOpen, onRename, onDuplicate, onDelete }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(list.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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
    if (renaming) inputRef.current?.focus()
  }, [renaming])

  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  function commitRename() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== list.name) onRename(trimmed)
    setRenaming(false)
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="relative flex items-start gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
    >
      {/* Drag handle */}
      <button
        ref={setActivatorNodeRef as unknown as (node: HTMLButtonElement | null) => void}
        {...listeners}
        {...attributes}
        className="mt-0.5 cursor-grab touch-none text-gray-300 hover:text-gray-500 active:cursor-grabbing"
        tabIndex={-1}
        aria-label="Drag to reorder"
      >
        <GripVertical size={16} />
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0" onClick={renaming ? undefined : onOpen}>
        {renaming ? (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') { setDraft(list.name); setRenaming(false) }
              }}
              className="flex-1 rounded border border-blue-400 px-2 py-0.5 text-sm font-medium focus:outline-none"
            />
            <button onClick={commitRename} className="text-green-600 hover:text-green-700 p-0.5">
              <Check size={14} />
            </button>
            <button onClick={() => { setDraft(list.name); setRenaming(false) }} className="text-gray-400 hover:text-gray-600 p-0.5">
              <X size={14} />
            </button>
          </div>
        ) : (
          <p className="cursor-pointer truncate font-medium text-gray-900 hover:text-blue-600">
            {list.name}
          </p>
        )}
        {list.description && (
          <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{list.description}</p>
        )}
        {list.is_shared && (
          <span className="mt-1 inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            Shared
          </span>
        )}
      </div>

      {/* Three-dot menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
          className="rounded p-1 text-gray-400 hover:text-gray-700"
          aria-label="List options"
        >
          <MoreVertical size={16} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-7 z-20 w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-md">
            <button
              onClick={() => { setMenuOpen(false); setDraft(list.name); setRenaming(true) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
            >
              <Pencil size={13} /> Rename
            </button>
            <button
              onClick={() => { setMenuOpen(false); onDuplicate() }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
            >
              <Copy size={13} /> Duplicate
            </button>
            <button
              onClick={() => { setMenuOpen(false); onDelete() }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 size={13} /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
