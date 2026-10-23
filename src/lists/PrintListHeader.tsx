import { FLAT_TABLE_EYEBROW } from '../components/flat-table-styles'

type Props = {
  name: string
  /** Gear rows plus food rows, containers counted once - the same union the
   *  pack progress metric counts, so the paper and the screen agree. */
  itemCount: number
}

// Local time, formatted as `YYYY-MM-DD HH:MM`. The sheet is read where it was
// printed, so wall-clock time; ISO date order so the sheet dates itself the
// same way whatever the browser locale is.
function formatPrintTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

// A small vertical label sitting over one printed checkbox column. w-3.5
// matches the squares' width and rotate-180 over vertical-rl makes the text
// read bottom-up, so a word longer than 14px costs height instead of
// colliding with its neighbor.
function ColumnLabel({ children }: { children: string }) {
  return (
    <span className="inline-block w-3.5 text-[8px] leading-none text-gray-600 [writing-mode:vertical-rl] rotate-180">
      {children}
    </span>
  )
}

// The printed document's header, and the only thing on paper that is not also
// on screen. `hidden print:block`.
//
// Deliberately one line of small type, not a title block: this replaces an app
// header that was eating the top of every sheet, and a checklist's value is
// rows per page. The list name is set at body weight rather than as a display
// heading for the same reason.
//
// The column labels are not decoration. The two checkbox squares in every row
// are only distinguishable by position when both are blank, so the columns
// get named once at the top, directly over the squares. The pl-[5px] + gap-1
// mirror a top-level row's geometry (1px section border + print:px-1 inset,
// print:gap-1 between the squares); rows nested inside a bag indent and the
// labels knowingly stop lining up there.
export default function PrintListHeader({ name, itemCount }: Props) {
  return (
    <div
      data-testid="print-list-header"
      className="hidden print:block mb-2 border-b border-gray-900 pb-1"
    >
      <div className="flex items-baseline justify-between gap-3">
        {/* A list name has no guaranteed whitespace either; see
            PRINT_UNTRUNCATE. */}
        <h1 className="min-w-0 text-[13px] font-semibold text-gray-900 [overflow-wrap:anywhere]">
          {name}
        </h1>
        <p className={`shrink-0 ${FLAT_TABLE_EYEBROW} print:text-[9px]`}>
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
          {' · '}
          {formatPrintTimestamp(new Date())}
        </p>
      </div>
      <div className="mt-1 flex items-end gap-1 pl-[5px]">
        <ColumnLabel>Ready</ColumnLabel>
        <ColumnLabel>Packed</ColumnLabel>
      </div>
    </div>
  )
}
