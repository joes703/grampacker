import { useState } from 'react'
import { Pencil } from 'lucide-react'
import type { List } from '../lib/types'
import DraftBadge from '../components/DraftBadge'
import { ROW_CONTROL_TARGET } from '../components/flat-table-styles'
import InlineTitle from './InlineTitle'
import { useCurrentListActions } from './use-current-list-actions'

type Props = {
  list: List
}

// Current-list title + inline-rename header. Used by:
//   - ListDetailPage's list toolbar at every viewport.
//
// List switching does NOT happen here — that's owned by the Lists page and
// the Lists nav destination. This header only identifies the current list
// and exposes rename via the pencil affordance. Click anywhere else on the
// component is inert by design. The rename mutation comes from the shared
// useCurrentListActions hook so the /lists card kebab, the in-list List
// options panel, and this pencil all route through the same handler.
export default function CurrentListHeader({ list }: Props) {
  const { renameMut, draftToggle } = useCurrentListActions()
  const [editing, setEditing] = useState(false)
  // Counter the pencil increments to push InlineTitle into edit mode. The
  // counter idiom matches LibraryPanel's focusSearchTrigger.
  const [editTrigger, setEditTrigger] = useState(0)

  return (
    <div className="group flex flex-1 min-w-0 items-center">
      <div className="flex flex-1 min-w-0 items-center gap-2">
        <InlineTitle
          key={list.id}
          name={list.name}
          onSave={(v) => renameMut.mutate({ id: list.id, name: v })}
          editTrigger={editTrigger}
          onEditingChange={setEditing}
        />
        {!editing && list.isDraft && (
          <button
            type="button"
            onClick={() => draftToggle.toggle(list)}
            aria-label="Draft. Mark list complete"
            title="Mark list complete"
            className="shrink-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <DraftBadge />
          </button>
        )}
      </div>
      {!editing && (
        <button
          type="button"
          onClick={() => setEditTrigger((t) => t + 1)}
          aria-label="Rename list"
          title="Rename list"
          // The shared target stays 40x40 and visible below lg. At lg it
          // compacts to 28x24 and hides until a pointer user hovers the header.
          className={`${ROW_CONTROL_TARGET} shrink-0 text-gray-500 opacity-100 transition-opacity hover:text-gray-600 lg:opacity-0 lg:group-hover:opacity-100`}
        >
          <Pencil size={14} />
        </button>
      )}
    </div>
  )
}
