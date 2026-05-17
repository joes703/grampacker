import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { List } from '../lib/types'
import { queryKeys, updateList, makeOptimisticUpdate } from '../lib/queries'

type Props = { list: List }

// List-property toggles that aren't share-related: Group worn + Ready
// checks. Both are per-list DB state on lists; the share toggle has its
// own surface (PrivacyPanel). Mounted inside ListSettingsButton's popover
// at md+ and inside a Modal on mobile.
//
// Why this sits separate from PrivacyPanel: keeping Share as its own
// one-tap CTA in the nav matters for the primary user gesture (copy a
// link). Merging share into "List settings" would bury it. The trade-off
// is two adjacent popover buttons; that mirrors how mobile already had
// separate Group worn / Share entries.
export default function ListSettingsPanel({ list }: Props) {
  const qc = useQueryClient()

  // Both mutations follow the same shape: void input, toggle off the
  // cache row's current value so rapid double-toggles still track.
  // Identical to PrivacyPanel's toggleMut pattern.
  const groupWornMut = useMutation({
    mutationFn: () => updateList(list.id, { group_worn: !list.group_worn }),
    ...makeOptimisticUpdate<List, void>({
      qc,
      queryKey: queryKeys.lists(),
      id: () => list.id,
      apply: (item) => ({ ...item, group_worn: !item.group_worn }),
    }),
  })

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
    <>
      <div className="flex items-center justify-between py-2">
        <span className="text-sm font-medium text-gray-900">Group worn</span>
        <ToggleSwitch checked={list.group_worn} onChange={() => groupWornMut.mutate()} />
      </div>
      <div className="flex items-center justify-between py-2">
        <span className="text-sm font-medium text-gray-900">Ready checks</span>
        <ToggleSwitch
          checked={list.ready_checks_enabled}
          onChange={() => readyChecksMut.mutate()}
        />
      </div>
    </>
  )
}

// Same visual primitive as PrivacyPanel's ToggleSwitch. Duplicated rather
// than extracted because the two panels are conceptually small and may
// drift independently; if a third site appears, lift this to a shared
// component.
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? 'bg-blue-600' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
