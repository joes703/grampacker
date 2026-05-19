import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import type { List } from '../lib/types'
import { queryKeys, updateList, makeOptimisticUpdate } from '../lib/queries'
import InlineTitle from './InlineTitle'

type Props = {
  list: List
}

// Current-list title + inline-rename header. Used by:
//   - NavBar's mobile route heading (md:hidden) for the top-bar list name.
//   - ListDetailPage's desktop list toolbar in the page body.
//
// List switching does NOT happen here — that's owned by the Lists page and
// the Lists nav destination. This header only identifies the current list
// and exposes rename via the pencil affordance. Click anywhere else on the
// component is inert by design.
export default function CurrentListHeader({ list }: Props) {
  const qc = useQueryClient()
  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateList(id, { name }),
    ...makeOptimisticUpdate<List, { id: string; name: string }>({
      qc,
      queryKey: queryKeys.lists(),
      id: ({ id }) => id,
      apply: (item, { name }) => ({
        ...item,
        name,
        updated_at: new Date().toISOString(),
      }),
    }),
  })
  const [editing, setEditing] = useState(false)
  // Counter the pencil increments to push InlineTitle into edit mode. The
  // counter idiom matches LibraryPanel's focusSearchTrigger.
  const [editTrigger, setEditTrigger] = useState(0)

  return (
    <div className="group flex flex-1 min-w-0 items-center">
      <InlineTitle
        key={list.id}
        name={list.name}
        onSave={(v) => renameMut.mutate({ id: list.id, name: v })}
        editTrigger={editTrigger}
        onEditingChange={setEditing}
      />
      {!editing && (
        <button
          type="button"
          onClick={() => setEditTrigger((t) => t + 1)}
          aria-label="Rename list"
          title="Rename list"
          // 32x32 hit area (h-8 w-8) for touch comfort. opacity-100 at
          // <md so touch users can always see it; md:opacity-0 +
          // md:group-hover:opacity-100 hides it on desktop until the
          // user hovers the header.
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-gray-400 opacity-100 transition-opacity hover:text-gray-600 md:opacity-0 md:group-hover:opacity-100"
        >
          <Pencil size={14} />
        </button>
      )}
    </div>
  )
}
