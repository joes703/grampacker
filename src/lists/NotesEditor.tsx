import { Suspense, lazy, useEffect, useRef, useState } from 'react'

// react-markdown + remark-gfm is ~46 KB gzip. Owner Notes panels rarely
// switch into render-with-content state on first paint (often empty for
// fresh lists), so lazy-loading keeps the initial bundle smaller. The
// public share view already lazy-loads the same component the same way.
const MarkdownContent = lazy(() => import('../components/MarkdownContent'))

type Props = {
  initial: string
  onSave: (description: string) => void
  /** Controlled edit mode. Lifted to the parent so the panel's header
   *  pencil affordance (mounted in PanelCard.headerAction) can show
   *  in read mode and hide in edit mode without lifting the textarea
   *  here. */
  editing: boolean
  onEditingChange: (next: boolean) => void
}

// Owner Notes panel body for List Detail. Two modes:
//   - Read (default): renders `initial` as markdown via MarkdownContent,
//     matching the public share view. Empty state shows a muted
//     "No notes" placeholder so the panel still has visible content.
//   - Edit: raw markdown textarea with explicit Save / Cancel. No
//     blur-save - the user has to commit the change.
//
// Edit mode is its own component so the draft state seeds from `initial`
// at mount (useState initializer) rather than via setState-in-effect on
// the `editing` flag flip. That keeps the lint rule satisfied without
// resorting to a key-on-edit remount trick.
//
// Share view continues to render MarkdownContent directly (no edit
// affordance) - this component is owner-only.
export default function NotesEditor({
  initial,
  onSave,
  editing,
  onEditingChange,
}: Props) {
  if (editing) {
    return (
      <NotesEdit
        initial={initial}
        onSave={(v) => {
          onSave(v)
          onEditingChange(false)
        }}
        onCancel={() => onEditingChange(false)}
      />
    )
  }
  return <NotesRead initial={initial} />
}

function NotesRead({ initial }: { initial: string }) {
  return (
    <div className="px-3 py-2 min-h-[8rem]">
      {initial ? (
        <Suspense fallback={null}>
          <MarkdownContent content={initial} />
        </Suspense>
      ) : (
        <p className="text-sm italic text-gray-400">No notes</p>
      )}
    </div>
  )
}

function NotesEdit({
  initial,
  onSave,
  onCancel,
}: {
  initial: string
  onSave: (description: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Selection-at-end on mount is friendlier than select-all for longer
  // notes where the user is more likely appending than rewriting. This
  // only runs once per edit-mode entry since the subtree is fresh each
  // time the parent flips into edit mode.
  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.focus()
      const end = el.value.length
      el.setSelectionRange(end, end)
    }
  }, [])

  function commit() {
    const next = draft.trim()
    if (next !== initial.trim()) onSave(next)
    else onCancel()
  }

  return (
    <div className="flex flex-1 flex-col">
      <textarea
        ref={textareaRef}
        value={draft}
        maxLength={2000}
        placeholder="Add notes about this packing list. Markdown supported."
        onChange={(e) => setDraft(e.target.value)}
        className="flex-1 min-h-[8rem] w-full resize-none px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none"
      />
      <div className="flex justify-end gap-2 border-t border-gray-100 px-3 py-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={commit}
          className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
        >
          Save
        </button>
      </div>
    </div>
  )
}
