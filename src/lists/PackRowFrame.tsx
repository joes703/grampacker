import type { ReactNode } from 'react'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_ROW,
  FLAT_TABLE_ROW_PADDING,
  PRINT_UNTRUNCATE,
} from '../components/flat-table-styles'
import PackModeCheckbox from './PackModeCheckbox'

// The pack-mode row skeleton shared by the gear row (ItemRow's pack branch)
// and SortableFoodRow: shell, grip slot, Ready checkbox, the wrapping label
// that hosts Packed + name/description, and the print-only checkbox squares.
// The two used to carry this verbatim (same composed className, same two
// print spans, same label structure), so any pack-row density or print
// change had to be made twice and re-verified for checkbox-column alignment.
// The trailing cells (worn/consumable slots, quantity, weight, row action)
// genuinely differ per surface and stay with each caller, passed as
// children so a cell on one and not the other still misaligns VISIBLY in
// review rather than drifting silently.
//
// No @dnd-kit import, deliberately: ItemRow renders on the anonymous share
// page, so this module must stay off the drag machinery; the sortable
// wrappers inject `dragHandle` from outside.
//
// Structure rules this frame owns:
// - The Ready checkbox sits OUTSIDE the wrapping label so that clicking the
//   row's name still toggles Packed (the muscle-memory destination). With
//   implicit label association, the browser forwards a non-input click on
//   the label to its FIRST nested input - putting Ready there would steal
//   that gesture. Ready gets its own aria-label since it's not wrapped.
// - The wrapping label means clicking/tapping the name toggles Packed, and
//   screen readers announce the item name as the checkbox's accessible name.
// - Print-only empty squares shadow both checkboxes. The native inputs are
//   suppressed in print because browsers render their checked state, and
//   the printed sheet should be a blank checklist regardless of what the
//   user has already marked digitally.
// - Anything interactive that must NOT toggle Packed (the weight cell, the
//   row action menu) belongs in `children`, which render as SIBLINGS of the
//   label, never inside it.

function PrintCheckboxSquare() {
  return (
    <span
      aria-hidden="true"
      className="hidden print:inline-block h-3.5 w-3.5 shrink-0 rounded-sm border border-gray-900"
    />
  )
}

// The packed-name treatment: calmer than a green tint - gray-500 +
// line-through pairs with the shell's bg-gray-50 to read as completed
// without celebrating; print restores plain black on the blank checklist.
export function packedNameClass(isPacked: boolean): string {
  return `block w-full truncate ${PRINT_UNTRUNCATE} font-normal ${
    isPacked ? 'text-gray-500 line-through print:text-gray-900 print:no-underline' : 'text-gray-900'
  }`
}

type Props = {
  name: string
  isPacked: boolean
  isReady: boolean
  onUpdate?: (patch: { isPacked?: boolean; isReady?: boolean }) => void
  // Rendered between the Packed checkbox and the name (the gear row's
  // status badge; food has none).
  statusBadge?: ReactNode
  // Content of the lg+ description slot. The slot itself always renders so
  // the columns to the right land where the pack header says they will -
  // food passes nothing and keeps the empty slot for skeleton alignment.
  description?: ReactNode
  dragHandle?: ReactNode
  // Trailing cells + row action, as siblings of the label (see above).
  children?: ReactNode
  outerRef?: (el: HTMLElement | null) => void
  outerStyle?: React.CSSProperties
}

export default function PackRowFrame({
  name,
  isPacked,
  isReady,
  onUpdate,
  statusBadge,
  description,
  dragHandle,
  children,
  outerRef,
  outerStyle,
}: Props) {
  return (
    <div
      ref={outerRef}
      style={outerStyle}
      // gap-2 lg:gap-2.5 controls the space between the Ready checkbox and
      // the wrapping label that hosts Packed + name, so the two checkboxes
      // don't read as a single cluster on touch. print:bg-transparent keeps
      // the paper checklist visually neutral.
      className={`${FLAT_TABLE_ROW} ${FLAT_TABLE_BODY_TEXT} ${FLAT_TABLE_ROW_PADDING} gap-2 lg:gap-2.5 print:gap-1 transition-colors ${
        isPacked ? 'bg-gray-50 print:bg-transparent' : 'bg-white'
      }`}
    >
      {dragHandle}
      <PackModeCheckbox
        variant="ready"
        checked={isReady}
        onChange={(checked) => onUpdate?.({ isReady: checked })}
        ariaLabel={`Mark ${name} ready`}
        title="Ready"
        standaloneLabel
      />
      <PrintCheckboxSquare />
      <label className="flex flex-1 min-w-0 items-center gap-1.5 lg:gap-1.5 cursor-pointer">
        <PackModeCheckbox
          variant="packed"
          checked={isPacked}
          onChange={(checked) => onUpdate?.({ isPacked: checked })}
        />
        <PrintCheckboxSquare />
        {statusBadge}
        {/* Name + description at lg+ in the same 2:3 proportion as edit
            mode. <lg keeps the single-column name-only layout. */}
        <div className="flex flex-1 min-w-0 items-center gap-3">
          <div className="flex-[2] min-w-0">
            <span className={packedNameClass(isPacked)}>{name}</span>
          </div>
          <div className="hidden lg:block lg:flex-[3] min-w-0">{description}</div>
        </div>
      </label>
      {children}
    </div>
  )
}
