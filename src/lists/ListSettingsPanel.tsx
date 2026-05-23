import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { List } from '../lib/types'
import { queryKeys, updateList, makeOptimisticUpdate } from '../lib/queries'
import ToggleSwitch from '../components/ToggleSwitch'
import PrivacyPanel from './PrivacyPanel'

type Props = { list: List }

// Current-list settings panel. A flat stack of toggle rows, one
// per setting:
//   - Group worn items: moves worn items into their own grouped
//     section across every view (edit, pack, public share).
//   - Ready checks (pack mode): enables the per-list "second progress
//     bar + Ready checkbox column" feature in Pack mode.
//   - Public link: PrivacyPanel's inline body (toggle + url + Copy when
//     public).
//
// Each row is a single line: label left, switch right. No section
// headings, no helper paragraphs - labels are short enough to stand on
// their own.
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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-900">Group worn items</span>
        <ToggleSwitch
          checked={list.group_worn}
          onChange={() => groupWornMut.mutate()}
          ariaLabel="Group worn items"
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-900">Ready checks (pack mode)</span>
        <ToggleSwitch
          checked={list.ready_checks_enabled}
          onChange={() => readyChecksMut.mutate()}
          ariaLabel="Ready checks (pack mode)"
        />
      </div>
      <PrivacyPanel list={list} />
    </div>
  )
}
