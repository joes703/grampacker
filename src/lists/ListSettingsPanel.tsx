import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { List } from '../lib/types'
import { queryKeys, updateList, makeOptimisticUpdate } from '../lib/queries'
import ToggleSwitch from '../components/ToggleSwitch'
import PrivacyPanel from './PrivacyPanel'

type Props = { list: List }

// Current-list settings panel. Three sections:
//   1. Group worn items - toggle that moves worn items into their own
//      grouped section across every view (edit, pack, public share).
//   2. Pack mode - settings that change pack-mode behavior on this list
//      (currently Ready checks, the per-list "second progress bar +
//      Ready checkbox column" feature). PackingProgress reads the same
//      list.ready_checks_enabled value to render the Ready UI when on.
//   3. Sharing - public/private toggle + copy-link affordance.
//      PrivacyPanel owns the toggle mutation and clipboard interaction;
//      this panel provides the section framing.
//
// Mounted inside ListSettingsButton's popover at md+ and inside a Modal
// on mobile via MobileListActionBar's Options slot.
export default function ListSettingsPanel({ list }: Props) {
  const qc = useQueryClient()

  const groupWornMut = useMutation({
    mutationFn: () => updateList(list.id, { group_worn: !list.group_worn }),
    ...makeOptimisticUpdate<List, void>({
      qc,
      queryKey: queryKeys.lists(),
      id: () => list.id,
      apply: (item) => ({ ...item, group_worn: !item.group_worn }),
    }),
  })

  // Ready checks lives here (not in PackingProgress) because it's a
  // list-level pack-mode setting, not a transient packing view filter.
  // Same updateList write path and same optimistic-cache shape as
  // group_worn; toggling off preserves existing is_ready values on
  // rows - disabling is a UI hide, not a data wipe.
  const readyChecksMut = useMutation({
    mutationFn: () => updateList(list.id, { ready_checks_enabled: !list.ready_checks_enabled }),
    ...makeOptimisticUpdate<List, void>({
      qc,
      queryKey: queryKeys.lists(),
      id: () => list.id,
      apply: (item) => ({ ...item, ready_checks_enabled: !item.ready_checks_enabled }),
    }),
  })

  return (
    <div className="space-y-4">
      <section>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-900">Group worn items</span>
          <ToggleSwitch
            checked={list.group_worn}
            onChange={() => groupWornMut.mutate()}
            ariaLabel="Group worn items"
          />
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Show worn items in their own section.
        </p>
      </section>

      <div className="border-t border-gray-100" />

      <section>
        <h3 className="text-sm font-semibold text-gray-900">Pack mode</h3>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-900">Ready checks</span>
          <ToggleSwitch
            checked={list.ready_checks_enabled}
            onChange={() => readyChecksMut.mutate()}
            ariaLabel="Ready checks"
          />
        </div>
      </section>

      <div className="border-t border-gray-100" />

      <section>
        <h3 className="text-sm font-semibold text-gray-900">Sharing</h3>
        <p className="mt-1 mb-2 text-xs text-gray-500">
          Anyone with the link can view this list.
        </p>
        <PrivacyPanel list={list} />
      </section>
    </div>
  )
}
