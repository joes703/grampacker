import { useState } from 'react'

type Props = {
  initial: string
  onSave: (description: string) => void
}

// Free-form notes textarea backed by lists.description. Saves on blur. The
// `key` on the parent (PanelCard's child) forces a fresh draft when the
// active list changes.
export default function NotesEditor({ initial, onSave }: Props) {
  const [draft, setDraft] = useState(initial)

  function commit() {
    const trimmed = draft.trim()
    if (trimmed !== initial.trim()) onSave(trimmed)
  }

  return (
    <textarea
      value={draft}
      maxLength={2000}
      placeholder="Add notes about this packing list…"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      className="flex-1 min-h-[8rem] w-full resize-none px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none"
    />
  )
}
