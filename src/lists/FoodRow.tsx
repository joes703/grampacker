import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import { CircleMinus, MoreVertical } from 'lucide-react'
import ItemWeightValue from '../components/ItemWeightValue'
import RowIconButton from '../components/RowIconButton'
import { RowMenuItem } from '../components/RowMenuItem'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_HEADER,
  FLAT_TABLE_HEADER_PADDING,
  FLAT_TABLE_HEADER_TITLE,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_ROW,
  POPOVER_SURFACE,
} from '../components/flat-table-styles'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
import type { WeightUnit } from '../lib/weight'
import type { FoodProjection } from './use-food-projection'

type Props = {
  projection: FoodProjection
  weightUnit: WeightUnit
  busy: boolean
  onDetach: () => void
}

// The derived Food row (food-planning-design.md 8 / section 4).
//
// This is a RENDERING, not a row. Food is never a list_items row: gear_item_id
// is NOT NULL and food is not gear, so there is nothing to store and nothing to
// re-sync when the plan changes. It gets its own section precisely because it is
// not a list item - it is not sortable, not categorized and not draggable, and
// must not sit inside a category group where those affordances live.
//
// It reports as consumable, which is not a user choice: food is consumable by
// definition (and worn/consumable are mutually exclusive anyway).
//
// Detaching is a menu action, not a bare X (design 8). The link is live, so an
// accidental tap on a row-edge icon is worth one deliberate step - and it
// matches the kebab every other row on this page already carries.
//
// Pack mode expands this into the real per-food checklist - that is slice 4.
export default function FoodRow({
  projection,
  weightUnit,
  busy,
  onDetach,
}: Props) {
  const { open: menuOpen, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-flush', menuWidth: 192 })

  return (
    <section aria-labelledby="food-row-heading" className="mt-4">
      <div className={`${FLAT_TABLE_HEADER} ${FLAT_TABLE_HEADER_PADDING}`}>
        <h3 id="food-row-heading" className={FLAT_TABLE_HEADER_TITLE}>
          Food
        </h3>
      </div>

      <div className={`${FLAT_TABLE_ROW} flex items-center gap-2`}>
        <span className="flex-1 min-w-0">
          <Link
            to={`/food/plans/${projection.planId}`}
            className={`block truncate ${FLAT_TABLE_BODY_TEXT} text-blue-700 hover:underline`}
          >
            Food ({projection.name})
          </Link>
          <span className={`block ${FLAT_TABLE_META_TEXT}`}>
            Consumable
            {/* Same generic wording as the editor's badge and the weight note:
                incomplete currently covers both a missing package size and a
                food missing from the library cache, so naming one would
                sometimes be wrong. */}
            {projection.incomplete && ' · Estimate'}
          </span>
        </span>

        <ItemWeightValue grams={projection.grams} unit={weightUnit} />

        <RowIconButton
          ref={triggerRef}
          onClick={() => (menuOpen ? close() : openMenu())}
          disabled={busy}
          ariaLabel="Food options"
          icon={<MoreVertical size={14} />}
        />
      </div>

      {menuOpen && menuPos && 'left' in menuPos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className={`fixed z-50 w-48 py-1 ${POPOVER_SURFACE}`}
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <RowMenuItem
            icon={<CircleMinus size={13} />}
            onClick={() => { close(); onDetach() }}
            tone="removal"
          >
            Remove from list
          </RowMenuItem>
        </div>,
        document.body,
      )}
    </section>
  )
}
