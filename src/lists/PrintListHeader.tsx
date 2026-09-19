import { FLAT_TABLE_EYEBROW } from '../components/flat-table-styles'

type Props = {
  name: string
  /** Gear rows plus food rows, containers counted once - the same union the
   *  pack progress metric counts, so the paper and the screen agree. */
  itemCount: number
}

// The printed document's header, and the only thing on paper that is not also
// on screen. `hidden print:block`.
//
// Deliberately one line of small type, not a title block: this replaces an app
// header that was eating the top of every sheet, and a checklist's value is
// rows per page. The list name is set at body weight rather than as a display
// heading for the same reason.
//
// The legend is not decoration. Both checkbox columns print as identical empty
// squares - they are only distinguishable on screen, and only once ticked
// (amber for ready, blue for packed). On paper, position is the sole cue, so
// the columns get named once at the top.
export default function PrintListHeader({ name, itemCount }: Props) {
  return (
    <div
      data-testid="print-list-header"
      className="hidden print:block mb-2 border-b border-gray-900 pb-1"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="min-w-0 text-[13px] font-semibold text-gray-900">{name}</h1>
        <p className={`shrink-0 ${FLAT_TABLE_EYEBROW} print:text-[9px]`}>
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
          {' · '}
          {new Date().toLocaleDateString()}
        </p>
      </div>
      <p className="mt-0.5 text-[9px] text-gray-600">
        Checkbox columns, left to right: Ready · Packed
      </p>
    </div>
  )
}
