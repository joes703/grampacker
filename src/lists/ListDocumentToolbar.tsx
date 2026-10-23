import { Printer } from 'lucide-react'
import type { List } from '../lib/types'
import type { ListDetailMode } from './list-detail-mode'
import CurrentListHeader from './CurrentListHeader'
import ListSettingsButton from './ListSettingsButton'
import ListShareButton from './ListShareButton'
import ListViewNav from './ListViewNav'
import UnitSegmentedControl from '../components/UnitSegmentedControl'

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
// anchor. The unit control, view nav and List options therefore render in
// EVERY mode, and the one contextual tool (Print, pack-only) sits at the
// LEFT end of the control group, where its churn is absorbed by the title's
// slack. Hiding chrome per mode is what used to make the view nav slide
// sideways on every view switch.
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
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <div className="order-1 flex min-w-0 flex-1">
        <CurrentListHeader list={list} />
      </div>

      <div className="order-2 flex items-center gap-2">
        {mode === 'pack' && (
          <button
            type="button"
            onClick={() => window.print()}
            aria-label="Print"
            title="Print"
            // Same recipe as ListSettingsButton's trigger, so the two
            // bordered toolbar buttons read as one family and match heights
            // in the row. docs/ui-density.md exempts toolbar buttons from
            // the row target tokens.
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Printer size={14} />
            {/* Icon-only below sm, like List options: at phone width this
                row also holds the title, the unit control and List options. */}
            <span className="hidden sm:inline">Print</span>
          </button>
        )}
        <UnitSegmentedControl idPrefix="list-toolbar" />
      </div>

      {/* Below lg the nav takes its own full-width second row (basis-full),
          after List options in visual order; at lg it slots between the unit
          control and List options on the one row. Both tiers are explicit:
          the order- pair below is what keeps List options at the right edge
          on both. */}
      <div className="order-4 basis-full lg:order-3 lg:basis-auto">
        <ListViewNav listId={list.id} mode={mode} />
      </div>

      <div className="order-3 lg:order-4 flex items-center gap-2">
        {/* Share sits beside List options rather than inside it: it is the
            end goal of building a list for this audience, and buried between
            Rename and Delete it took UX audits three clicks to find. One
            home - ListSettingsPanel no longer hosts it. */}
        <ListShareButton list={list} />
        <ListSettingsButton list={list} />
      </div>
    </div>
  )
}
