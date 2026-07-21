import type { List } from '../lib/types'
import CurrentListHeader from './CurrentListHeader'
import ListSettingsButton from './ListSettingsButton'
import PackToggle from './PackToggle'
import UnitSegmentedControl from '../components/UnitSegmentedControl'

type Props = {
  list: List
  packMode: boolean
  onTogglePackMode: () => void
  onOrganizePack: () => void
}

// Desktop list-document toolbar (md+). Anchors list identity and
// list-scoped actions to the document column on /lists/:id now that the
// global top bar is global-only. Mobile keeps the list name in NavBar's
// route heading and the Pack toggle in MobilePackToggle.
// Hidden in print: the print-only header carries the list name on paper.
//
// Pack mode suppresses List options. Pack-mode-specific controls
// (Show unpacked only, Add ready checks) live inline at the top of
// PackingProgress; the remaining List options (Group worn, Sharing,
// Rename/Duplicate/Export/Delete) are list-admin concerns the user
// doesn't need while actively packing, so the button isn't shown.
export default function ListDocumentToolbar({
  list,
  packMode,
  onTogglePackMode,
  onOrganizePack,
}: Props) {
  return (
    <div className="hidden md:flex items-center gap-2 print:hidden">
      <CurrentListHeader list={list} />
      <div className="ml-auto flex items-center gap-2">
        {/* Units. Gated lg even though this toolbar is md+, because the
            mobile placement in ListDetailPage is lg:hidden - anything md+
            here would double-render across 768-1023px. Deliberately outside
            the !packMode gate: weights are still on screen while packing. */}
        <div className="hidden lg:block">
          <UnitSegmentedControl idPrefix="list-toolbar" />
        </div>
        <PackToggle active={packMode} onClick={onTogglePackMode} />
        {packMode ? (
          <button
            type="button"
            onClick={onOrganizePack}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Organize
          </button>
        ) : null}
        {!packMode && <ListSettingsButton list={list} />}
      </div>
    </div>
  )
}
