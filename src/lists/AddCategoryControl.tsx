import { useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { Category } from '../lib/types'
import { FLAT_TABLE_BODY_TEXT } from '../components/flat-table-styles'

type Props = {
  /** Creates the category (the same shared store the Gear page manages) and
   *  resolves to the server row. */
  onCreate: (name: string) => Promise<Category>
  /** Fired with the created category so the page can show its new, still
   *  empty section immediately (list views hide empty categories). */
  onCreated: (category: Category) => void
}

// In-list category creation. Categories still belong to the gear inventory
// and their order is still authored on /gear; this is only an entry point.
// It exists because building a list from scratch used to dead-end here: the
// list page had no way to make a category, and every 2026-10 UX audit run
// stumbled on exactly that.
//
// The in-flight ref is load-bearing, not ceremony: Enter plus the late blur
// Chrome fires when a control is disabled mid-submit created two lists
// through an unguarded submit path once already (use-current-list-actions).
// This component awaits an async create, which useCommitOnce cannot guard
// (its window is one render), so it keeps its own ref across the await.
export default function AddCategoryControl({ onCreate, onCreated }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  async function submit() {
    const name = draft.trim()
    if (!name || inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      const category = await onCreate(name)
      setDraft('')
      setEditing(false)
      onCreated(category)
    } catch {
      // A rejection does not prove the category was not created (AGENTS.md
      // "Traps"), so the copy says confirm, not failed.
      setError("Couldn't confirm the category was created. Try again, or check the Gear page.")
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`inline-flex items-center gap-1 self-start px-1 py-1.5 ${FLAT_TABLE_BODY_TEXT} font-medium text-gray-500 hover:text-blue-600 print:hidden`}
      >
        <Plus size={14} /> Add category
      </button>
    )
  }

  return (
    <div className="print:hidden">
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="add-category-name">Category name</label>
        <input
          id="add-category-name"
          autoFocus
          type="text"
          placeholder="Category name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape' && !pending) { setDraft(''); setError(null); setEditing(false) }
          }}
          disabled={pending}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!draft.trim() || pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={14} /> {pending ? 'Creating…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={() => { setDraft(''); setError(null); setEditing(false) }}
          disabled={pending}
          aria-label="Cancel"
          className="rounded p-1.5 text-gray-500 hover:text-gray-600"
        >
          <X size={16} />
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>
      )}
    </div>
  )
}
