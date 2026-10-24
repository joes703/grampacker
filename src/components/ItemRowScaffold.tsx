import type { ReactNode } from 'react'
import type { GearStatus } from '../lib/gear-status'
import InlineText from './InlineText'
import GearStatusBadge from './gear/GearStatusBadge'
import { FLAT_TABLE_BODY_TEXT_MUTED } from './flat-table-styles'

// The leading scaffold shared by the gear-library row (GearItemRow) and the
// list-detail row (ItemRow). The two used to re-build these pieces verbatim
// - same column proportions, same typography, down to the same comments - so
// a density fix to "the row" meant editing two files that had to agree
// character-for-character. Trailing columns genuinely differ per surface and
// stay in each row file.
//
// Share-path constraint: ItemRow renders on the anonymous share page, so
// nothing in this module may import @dnd-kit (the emitted share bundle is
// the check - see docs/testing-and-ci.md section 2 notes on the share seam).

// Desktop name + description as two FIXED proportional columns, name :
// description = 3 : 2, so every description in a table starts at the same
// x. Sizing the name to its own text gave names room, but each description
// then started where its own name ended and the column went ragged. The name
// is the content, so it gets the larger share; both cells truncate.
// The status badge is the first thing inside the name cell; null-for-active
// means active rows reserve no extra whitespace, while non-active rows pick
// up a subtle leading icon. Each text cell is an InlineText when its save
// handler is present, and a static span with the same typography otherwise
// (the read-only share view, or a surface that gates editing).
//
// An EMPTY description's "Add description" affordance is visual noise on
// every row of a long list, so it fades in only while the row is hovered -
// opacity, not display, so it stays keyboard-focusable and reveals itself
// on focus. A description with content always shows.
export function NameDescriptionCell({
  status,
  name,
  description,
  onSaveName,
  onSaveDescription,
}: {
  status: GearStatus
  name: string
  description: string
  onSaveName?: (name: string) => void
  // allowEmpty on the inline control: clearing removes the description; the
  // caller's write boundary converts '' to the null the contract takes.
  onSaveDescription?: (description: string) => void
}) {
  return (
    <div className="flex-1 min-w-0 flex items-center gap-3">
      <div className="flex-[3] min-w-0 flex items-center gap-1.5">
        <GearStatusBadge status={status} compact className="shrink-0 print:hidden" />
        {onSaveName ? (
          <InlineText
            value={name}
            onSave={onSaveName}
            className="block min-w-0 flex-1 truncate font-normal text-gray-900"
          />
        ) : (
          <span className="block min-w-0 flex-1 truncate font-normal text-gray-900">{name}</span>
        )}
      </div>
      <div
        className={`flex-[2] min-w-0 ${
          description ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
        }`}
      >
        {onSaveDescription ? (
          <InlineText
            value={description}
            placeholder="Add description"
            allowEmpty
            onSave={onSaveDescription}
            className={`block w-full truncate ${FLAT_TABLE_BODY_TEXT_MUTED}`}
          />
        ) : (
          <span className={`block w-full truncate ${FLAT_TABLE_BODY_TEXT_MUTED}`}>
            {description}
          </span>
        )}
      </div>
    </div>
  )
}

// Mobile (< lg) row body - the status badge + truncated name cell, with the
// surface's own trailing cells as children (the gear row shows weight only;
// the list row adds its flag slot and quantity). Description is dropped on
// mobile (redundant with the modal editor, and waste on a 375px screen).
// The wrapper is a <button> when onTap is provided and a plain <div>
// otherwise (the read-only share view).
export function MobileRowBody({
  status,
  name,
  onTap,
  tapLabel,
  children,
}: {
  status: GearStatus
  name: string
  onTap?: () => void
  // The button's accessible name; each surface words its own (the gear row
  // says Select/Deselect/Edit, the list row reads out quantity and weight).
  tapLabel?: string
  children?: ReactNode
}) {
  const cells = (
    <>
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <GearStatusBadge status={status} compact className="shrink-0 print:hidden" />
        <span className="block min-w-0 flex-1 truncate font-normal text-gray-900">{name}</span>
      </div>
      {children}
    </>
  )
  if (onTap) {
    return (
      <button
        type="button"
        onClick={onTap}
        aria-label={tapLabel}
        className="flex flex-1 min-w-0 items-center gap-2 text-left"
      >
        {cells}
      </button>
    )
  }
  return <div className="flex flex-1 min-w-0 items-center gap-2">{cells}</div>
}
