import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { List } from '../lib/types'
import { queryKeys, updateList, makeOptimisticUpdate } from '../lib/queries'

type Props = { list: List }

// Broad list-presentation settings — currently just Group worn. Ready
// checks lives in Pack Mode because that's where the user experiences
// its effect; Group worn applies to every view (edit, pack, public
// share) so it belongs here. Mounted inside ListSettingsButton's popover
// at md+ and inside a Modal on mobile.
//
// Sharing has its own surface (PrivacyPanel) so Share stays a one-tap
// CTA in the toolbar instead of getting buried in List options.
export default function ListSettingsPanel({ list }: Props) {
  const qc = useQueryClient()

  // Identical shape to PrivacyPanel's toggleMut: void input, toggle off
  // the cache row's current value so rapid double-toggles still track.
  const groupWornMut = useMutation({
    mutationFn: () => updateList(list.id, { group_worn: !list.group_worn }),
    ...makeOptimisticUpdate<List, void>({
      qc,
      queryKey: queryKeys.lists(),
      id: () => list.id,
      apply: (item) => ({ ...item, group_worn: !item.group_worn }),
    }),
  })

  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm font-medium text-gray-900">Group worn</span>
      <ToggleSwitch checked={list.group_worn} onChange={() => groupWornMut.mutate()} />
    </div>
  )
}

// Visual primitive copied from PrivacyPanel. If a third settings panel
// appears, lift this to a shared component.
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
