type Props = {
  name: string
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

// One legend entry: a small square drawn like the row squares, then its name.
function LegendSquare({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm border border-gray-900" />
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
// The legend is not decoration. The two checkbox squares in every row are
// only distinguishable by position when both are blank, so the header names
// them once, in the same left-to-right order as the squares in each row.
export default function PrintListHeader({ name }: Props) {
  return (
    <div
      data-testid="print-list-header"
      className="hidden print:block mb-2 border-b border-gray-900 pb-1"
    >
      <div className="flex items-baseline justify-between gap-3">
        {/* A list name has no guaranteed whitespace either; see
            PRINT_UNTRUNCATE. */}
        <h1 className="min-w-0 text-[12px] font-semibold text-gray-900 [overflow-wrap:anywhere]">
          {name}
        </h1>
        <p className="flex shrink-0 items-center gap-3 text-[9px] text-gray-600">
          <LegendSquare>Ready</LegendSquare>
          <LegendSquare>Packed</LegendSquare>
          <span className="tabular-nums">{formatPrintTimestamp(new Date())}</span>
        </p>
      </div>
    </div>
  )
}
