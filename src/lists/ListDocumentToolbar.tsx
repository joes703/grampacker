import type { List } from '../lib/types'
import type { ListDetailMode } from './list-detail-mode'
import CurrentListHeader from './CurrentListHeader'
import ListSettingsButton from './ListSettingsButton'
import ListViewNav from './ListViewNav'
import UnitSegmentedControl from '../components/UnitSegmentedControl'

type Props = {
  list: List
  mode: ListDetailMode
}

// List-document toolbar. Anchors list identity and
// list-scoped actions to the document column on /lists/:id now that the
// global top bar is global-only. The same identity and peer view navigation
// render at every viewport.
// Hidden in print: the print-only header carries the list name on paper.
//
// Pack mode suppresses List options. Pack-mode-specific controls
// (Show unpacked only, Show un-ready only) live inline at the top of
// PackingProgress; the remaining List options (Sharing,
// Rename/Duplicate/Export/Delete) are list-admin concerns the user
// doesn't need while actively packing, so the button isn't shown.
//
// Food mode keeps the unit selector - the food view is weights everywhere,
// so hiding the page-level unit control there would be a regression - but
// drops List options: list admin is not a food-view concern.
export default function ListDocumentToolbar({
  list,
  mode,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <div className="order-1 flex min-w-0 flex-1">
        <CurrentListHeader list={list} />
      </div>

      <div className="order-3 basis-full lg:order-2 lg:basis-auto">
        <ListViewNav listId={list.id} mode={mode} />
      </div>

      {(mode === 'edit' || mode === 'food') && (
        <div className="order-2 ml-auto flex items-center gap-2 lg:order-3">
          <div>
            <UnitSegmentedControl idPrefix="list-toolbar" />
          </div>
          {mode === 'edit' && <ListSettingsButton list={list} />}
        </div>
      )}
    </div>
  )
}
