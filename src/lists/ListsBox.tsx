import { useState, useRef, useEffect } from 'react'
import { Plus } from 'lucide-react'
import type { List } from '../lib/types'

type Props = {
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
            />
          ))
        )}
      </div>

      <div className="border-t border-gray-100 bg-gray-50 p-2">
        {creating ? (
          <div className="flex gap-1">
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
              className="flex-1 min-w-0 rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none"
            />
          </div>
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
}: {
  list: List
  active: boolean
  onSelect: () => void
  onRename: (name: string) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(list.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) inputRef.current?.select()
  }, [renaming])

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
    <button
      onClick={onSelect}
      onDoubleClick={() => { setDraft(list.name); setRenaming(true) }}
      className={`block w-full text-left px-3 py-1.5 text-sm transition-colors ${
        active
          ? 'bg-blue-50 text-blue-700 font-medium'
          : 'text-gray-700 hover:bg-gray-50'
      }`}
      title="Click to switch · double-click to rename"
    >
      <span className="truncate block">{list.name}</span>
    </button>
  )
}
