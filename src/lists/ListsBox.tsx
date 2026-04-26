import { useState, useRef, useEffect } from 'react'
import { Download, MoreVertical, Plus, Share2, Trash2, Upload } from 'lucide-react'
import type { List } from '../lib/types'

type RowActions = {
  onImport: (list: List) => void
  onExport: (list: List) => void
  onShareToggle: (list: List) => void
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
  onShareToggle,
  onDelete,
}: Props) {
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Lists</p>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-gray-50" style={{ maxHeight: '40vh' }}>
        {lists.length === 0 ? (
          <p className="px-3 py-3 text-center text-xs text-gray-400 italic">No lists yet</p>
        ) : (
          lists.map((list) => (
            <ListsBoxRow
              key={list.id}
              list={list}
              active={list.id === activeId}
              onSelect={() => onSelect(list)}
              onRename={(name) => onRename(list, name)}
              onImport={() => onImport(list)}
              onExport={() => onExport(list)}
              onShareToggle={() => onShareToggle(list)}
              onDelete={() => onDelete(list)}
            />
          ))
        )}
      </div>

      <div className="border-t border-gray-100 bg-gray-50 p-2">
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
            className="flex w-full items-center justify-center gap-1 rounded px-2 py-1.5 text-sm text-blue-600 hover:bg-blue-50"
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
  onShareToggle,
  onDelete,
}: {
  list: List
  active: boolean
  onSelect: () => void
  onRename: (name: string) => void
  onImport: () => void
  onExport: () => void
  onShareToggle: () => void
  onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(list.name)
  const [menuOpen, setMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (renaming) inputRef.current?.select()
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

  function commit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== list.name) onRename(trimmed)
    setRenaming(false)
  }

  if (renaming) {
    return (
      <div className="px-2 py-1.5">
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
      className={`group relative flex items-center transition-colors ${
        active ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
    >
      <button
        onClick={onSelect}
        onDoubleClick={() => { setDraft(list.name); setRenaming(true) }}
        className={`flex-1 min-w-0 text-left px-3 py-1.5 text-sm ${
          active ? 'text-blue-700 font-medium' : 'text-gray-700'
        }`}
        title="Click to switch · double-click to rename"
      >
        <span className="truncate block">{list.name}</span>
      </button>

      {/* 3-dot menu */}
      <div className="relative shrink-0 pr-1" ref={menuRef}>
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
          className="rounded p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100"
          aria-label="List options"
        >
          <MoreVertical size={14} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-7 z-30 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-md">
            <MenuItem icon={<Upload size={13} />} onClick={() => { setMenuOpen(false); onImport() }}>
              Import CSV
            </MenuItem>
            <MenuItem icon={<Download size={13} />} onClick={() => { setMenuOpen(false); onExport() }}>
              Export CSV
            </MenuItem>
            <MenuItem icon={<Share2 size={13} />} onClick={() => { setMenuOpen(false); onShareToggle() }}>
              {list.is_shared ? `Sharing: ${list.share_token}` : 'Share'}
            </MenuItem>
            <div className="my-1 border-t border-gray-100" />
            <MenuItem
              icon={<Trash2 size={13} />}
              onClick={() => { setMenuOpen(false); onDelete() }}
              danger
            >
              Delete
            </MenuItem>
          </div>
        )}
      </div>
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
