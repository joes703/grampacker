import { Printer } from 'lucide-react'
import type { List } from '../lib/types'
import type { ListDetailMode } from './list-detail-mode'
import CurrentListHeader from './CurrentListHeader'
import ListSettingsButton from './ListSettingsButton'
import ListShareButton from './ListShareButton'
import ListViewNav from './ListViewNav'
import UnitSegmentedControl from '../components/UnitSegmentedControl'
import { TOOLBAR_BUTTON } from '../components/flat-table-styles'

type Props = {
  list: List
  mode: ListDetailMode
}

// List-document toolbar. Anchors list identity and list-scoped actions to the
// document column on /lists/:id now that the global top bar is global-only.
// Hidden in print: the print-only header carries the list name on paper.
//
// Layout rule: persistent chrome sits at the right edge, contextual tools
// next to the slack. The title owns all free space (flex-1), so everything
// after it packs against the right edge, and a control that appears or
// disappears displaces only what is to its LEFT - the right edge is the
// anchor. The unit control and List options therefore render in EVERY
// mode, and the one contextual tool (Print, pack-only) sits at the LEFT end
// of the control group, where its churn is absorbed by the title's slack.
// The view tabs sit on their own row below, so nothing on the title row
// can move them.
//
// The unit control is not dead weight in any mode: edit and food are weights
// everywhere, and the pack row edits a weight at lg+ (ItemRow's pack
// branch). List options everywhere costs nothing and keeps rename/sharing
// one click away.
//
// Print needs no home in edit or food - Ctrl/Cmd-P does the same thing, and
// the beforeprint handling behind it works either way - but a paper
// checklist nobody knows they can make is not a feature, so pack shows the
// button.
export default function ListDocumentToolbar({
  list,
  mode,
}: Props) {
  return (
    <div className="flex flex-col gap-1 print:hidden">
      <div data-testid="list-toolbar-title-row" className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1">
          <CurrentListHeader list={list} />
        </div>

        <div className="flex items-center gap-2">
          {mode === 'pack' && (
            <button
              type="button"
              onClick={() => window.print()}
              aria-label="Print"
              title="Print"
              className={`inline-flex items-center gap-1.5 ${TOOLBAR_BUTTON}`}
            >
              <Printer size={14} />
              {/* Icon-only below sm, like List options: at phone width this
                  row also holds the title, the unit control and List options. */}
              <span className="hidden sm:inline">Print</span>
            </button>
          )}
          <UnitSegmentedControl idPrefix="list-toolbar" />
        </div>

        <div className="flex items-center gap-2">
          {/* Share sits beside List options rather than inside it: it is the
              end goal of building a list for this audience, and buried between
              Rename and Delete it took UX audits three clicks to find. One
              home - ListSettingsPanel no longer hosts it. */}
          <ListShareButton list={list} />
          <ListSettingsButton list={list} />
        </div>
      </div>

      {/* The view tabs take their own row under the title at every width, so
          they read as sections of this list rather than one more control
          beside Share. The rule under them spans the toolbar. */}
      <div className="border-b border-gray-200">
        <ListViewNav listId={list.id} mode={mode} />
      </div>
    </div>
  )
}
