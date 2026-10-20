import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import type { Category } from '../lib/types'
import { MAX_CATEGORY_NAME } from '../lib/caps'
import { FORM_INPUT } from './flat-table-styles'
import PrimaryButton from './PrimaryButton'

// The one inline "new category" editor, shared by GearLibraryPage's toolbar
// and GearItemDialog's category select. It owns the name / pending / error
// state and these coordination guarantees:
//
// - The error is held inline, never a toast: the form variant runs inside a
//   modal where a toast cannot be seen (the modal rule in
//   src/lib/mutation-error-handler.ts), and the editor itself is the retry
//   surface - it stays open with the typed name until the create succeeds.
// - The error copy claims only what it can prove. createCategory is a POST
//   that mints an id, so a commit whose response was lost would be duplicated
//   by a blind retry - and category names are not unique, so nothing stops it.
// - `pending` disables the input and the submit button. Category names are
//   not unique in the schema, so a second submit while the first is out
//   quietly creates a duplicate - and Enter repeats on its own. The disabled
//   UI is the primary block; the guard in commit() is the backstop.
// - A LATE ANSWER MUST BE FULLY INERT once this editor is gone. The parent
//   closes the editor by unmounting it (and resets it by remounting under a
//   new key), so a create that settles afterwards must touch neither state
//   nor the parent: the `mounted` ref gates both. Without the callback half
//   of that gate, an abandoned create's success would call onCreated and
//   close whatever dialog the parent has open NOW.
//   The mounted ref cannot see a replacement that is QUEUED but not yet
//   committed (unmount effects run at commit), so a parent whose editor slot
//   can be replaced from a non-event context must ALSO guard its onCreated
//   with a functional update against current state - GearLibraryPage's
//   closeCategorySession is the shape.
//
// `create` must return a promise that settles for THIS call. With a TanStack
// mutation shared across surfaces (addCategory is one observer shared by both
// variants' parents), that means mutateAsync - never mutate with per-call
// callbacks, because TanStack detaches the observer from the previous
// mutation on every new mutate call, so those callbacks would simply never
// run. The overlap is reachable: abandon an in-flight toolbar create by
// opening New item, then create a category from inside the dialog.

type Props = {
  create: (name: string) => Promise<Category>
  // Must close (unmount) the editor; `pending` stays set until then, so the
  // editor cannot accept a second submit in the gap.
  onCreated: (created: Category) => void
  onCancel: () => void
  // 'toolbar': text Add button, fixed-width input (GearLibraryPage header).
  // 'form': icon buttons under a select, form-density input (GearItemDialog).
  variant: 'toolbar' | 'form'
}

export default function InlineCreateCategory({
  create,
  onCreated,
  onCancel,
  variant,
}: Props) {
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  function commit() {
    const trimmed = name.trim()
    if (!trimmed || pending) return
    setPending(true)
    setError(null)
    void (async () => {
      try {
        const created = await create(trimmed)
        if (!mounted.current) return
        onCreated(created)
      } catch {
        if (!mounted.current) return
        setPending(false)
        setError(
          "Couldn't confirm the category was created. Refresh before retrying, in case it was.",
        )
      }
    })()
  }

  const input = (
    <input
      autoFocus
      type="text"
      placeholder="Category name"
      maxLength={MAX_CATEGORY_NAME}
      value={name}
      disabled={pending}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          // The form variant sits inside the item dialog's <form>; a bare
          // Enter must commit the category, not submit the gear item.
          e.preventDefault()
          commit()
        }
        if (e.key === 'Escape') onCancel()
      }}
      className={
        variant === 'toolbar'
          ? 'w-44 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60'
          : `w-full min-w-0 ${FORM_INPUT} disabled:opacity-60`
      }
    />
  )

  if (variant === 'toolbar') {
    return (
      <div className="flex w-full md:w-auto flex-col gap-1">
        <div className="flex items-center gap-2">
          {input}
          <PrimaryButton
            type="button"
            onClick={commit}
            disabled={!name.trim() || pending}
            size="sm"
            disabledOpacity="40"
          >
            {pending ? 'Adding…' : 'Add'}
          </PrimaryButton>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1.5 text-gray-500 hover:text-gray-600"
            aria-label="Cancel new category"
          >
            <X size={16} />
          </button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
        {input}
        <PrimaryButton
          type="button"
          onClick={commit}
          disabled={pending || !name.trim()}
          aria-label="Create category"
          size="icon"
          disabledOpacity="40"
        >
          <Check size={16} />
        </PrimaryButton>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel new category"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:text-gray-600"
        >
          <X size={16} />
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </>
  )
}
