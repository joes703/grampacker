import type { List } from '../lib/types'
import type { ListDetailMode } from './list-detail-mode'
import CurrentListHeader from './CurrentListHeader'
import ListSettingsButton from './ListSettingsButton'
import ListModeToggles from './ListModeToggles'
import UnitSegmentedControl from '../components/UnitSegmentedControl'

type Props = {
  list: List
  mode: ListDetailMode
  onTogglePackMode: () => void
  onToggleOrganizeMode: () => void
}

// List-document toolbar. Anchors list identity and
// list-scoped actions to the document column on /lists/:id now that the
// global top bar is global-only. The same identity and peer mode controls
// render at every viewport.
// Hidden in print: the print-only header carries the list name on paper.
//
// Pack mode suppresses List options. Pack-mode-specific controls
// (Show unpacked only, Add ready checks) live inline at the top of
// PackingProgress; the remaining List options (Group worn, Sharing,
// Rename/Duplicate/Export/Delete) are list-admin concerns the user
// doesn't need while actively packing, so the button isn't shown.
export default function ListDocumentToolbar({
  list,
  mode,
  onTogglePackMode,
  onToggleOrganizeMode,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <div className="flex min-w-0 basis-full sm:basis-auto sm:flex-1">
        <CurrentListHeader list={list} />
      </div>
      <div className="ml-auto flex items-center gap-2">
        {mode === 'edit' && (
          <div>
            <UnitSegmentedControl idPrefix="list-toolbar" />
          </div>
        )}
        <ListModeToggles
          mode={mode}
          onTogglePackMode={onTogglePackMode}
          onToggleOrganizeMode={onToggleOrganizeMode}
        />
        {mode === 'edit' && <ListSettingsButton list={list} />}
      </div>
    </div>
  )
}
