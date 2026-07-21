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

// Desktop list-document toolbar (md+). Anchors list identity and
// list-scoped actions to the document column on /lists/:id now that the
// global top bar is global-only. Mobile renders the same peer mode toggles
// above the document column.
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
    <div className="hidden md:flex items-center gap-2 print:hidden">
      <CurrentListHeader list={list} />
      <div className="ml-auto flex items-center gap-2">
        {/* Units. Gated lg even though this toolbar is md+, because the
            mobile placement in ListDetailPage is lg:hidden. Deliberately
            mode-independent: weights are still on screen while packing. */}
        <div className="hidden lg:block">
          <UnitSegmentedControl idPrefix="list-toolbar" />
        </div>
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
