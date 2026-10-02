import { createPortal } from 'react-dom'
import { ArrowUpDown, MapPin, MoreVertical, PackageMinus, PackagePlus, Pencil, Trash2 } from 'lucide-react'
import type { PackingLocation } from '../lib/types'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
import RowIconButton from '../components/RowIconButton'
import { POPOVER_SURFACE } from '../components/flat-table-styles'
import { RowMenuItem } from '../components/RowMenuItem'
import MobileOptionsModal from '../components/MobileOptionsModal'

type BaseProps = {
  itemId: string
  itemName: string
  currentLocationId: string | null
  locations: PackingLocation[]
  mobile: boolean
  disabled: boolean
  /** The locations query has not resolved, so `locations` is [] because we do
   *  not KNOW rather than because there are none. Disables every row whose
   *  write is computed from that array - the destinations, container
   *  promotion/demotion, and in-bag reorder - while deliberately leaving the
   *  trigger and Remove from list alone.
   *
   *  Kept separate from `disabled` for exactly that reason: removal resolves
   *  the locations query itself and fail-safes to a confirm (see
   *  resolveRemovalPlan), so it is the one action here that is still correct
   *  during an outage, and folding it into the blanket flag would take away
   *  the menu's only working option. Without this, an item that really does
   *  sit in a bag is offered an enabled "Unassigned" - the destination list is
   *  built from the empty array plus a hardcoded Unassigned - and taking it
   *  writes a move the user never meant. */
  locationsUnavailable?: boolean
  containerCreationDisabled: boolean
  isContainer: boolean
  excludedLocationIds?: ReadonlySet<string>
  onMove: (locationId: string | null) => void
  /** Starts click-to-place: the non-drag way to reposition this row inside its
   *  own bag (WCAG 2.5.7). Omitted where the row cannot be row-reordered -
   *  container HEADER rows use this same menu but are excluded from reorder,
   *  and a dead action there would be worse than no action. The caller also
   *  omits it when the row's own section shows fewer than two rows, where
   *  every insertion point is a no-op and the mode would open empty.
   *
   *  Receives the kebab element so focus can come back here when the mode
   *  closes - by then the slot that had focus has unmounted. */
  onStartReorder?: (origin: HTMLElement | null) => void
  /** Drops the item from the list entirely. Pack could previously only
   *  rearrange what was already there, so noticing "I am not taking this"
   *  while packing meant leaving for List view and finding the row again.
   *
   *  This is a MEMBERSHIP operation: it removes the row from this list and
   *  never touches the gear item in the library. That distinction is still
   *  real - it is why this sits behind its own rule at the foot of the menu,
   *  away from the destinations - but it no longer implies that authoring is
   *  out of scope here. See onEdit.
   *
   *  Optional because the caller owns the consequences - removing an item that
   *  backs a container also destroys the container, and the page confirms that
   *  case before it happens. */
  onRemoveFromList?: () => void
  /** Opens the gear editor for this row.
   *
   *  This menu was written under the rule "authoring gear belongs to the
   *  library, not to a packing checklist". That rule is deliberately
   *  overturned: a real trip showed that noticing a wrong weight while
   *  packing meant leaving the view, fixing it elsewhere and finding your
   *  place again - which is exactly the shuffle the one-page work (PR #200)
   *  exists to end.
   *
   *  Optional, and food rows pass none: food is authored in the Food view,
   *  the same reason they pass no onRemoveFromList. */
  onEdit?: () => void
}

type Props = BaseProps & (
  | {
      // Gear rows: promotable to a container. Food rows pass no
      // onUseAsContainer - food cannot back a container - and the action row
      // simply does not render.
      isContainer: false
      onUseAsContainer?: () => void
      onStopUsingAsContainer?: never
    }
  | {
      isContainer: true
      onUseAsContainer?: never
      onStopUsingAsContainer?: () => void
    }
)

export default function MoveToLocationMenu({
  itemId,
  itemName,
  currentLocationId,
  locations,
  mobile,
  disabled,
  locationsUnavailable = false,
  containerCreationDisabled,
  isContainer,
  excludedLocationIds,
  onMove,
  onStartReorder,
  onRemoveFromList,
  onEdit,
  onUseAsContainer,
  onStopUsingAsContainer,
}: Props) {
  const { open, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-flush', menuWidth: 224 })

  const choices = [
    ...locations
      .filter((location) =>
        location.containerListItemId !== itemId &&
        !excludedLocationIds?.has(location.id),
      )
      .map((location) => ({ id: location.id as string | null, name: location.name })),
    { id: null, name: 'Unassigned' },
  ]
  const moveRows = choices.map((choice) => (
    <RowMenuItem
      key={choice.id ?? '__unassigned__'}
      icon={<MapPin size={13} />}
      disabled={disabled || locationsUnavailable || choice.id === currentLocationId}
      onClick={() => {
        close()
        onMove(choice.id)
      }}
    >
      {choice.name}
    </RowMenuItem>
  ))
  const rows = (
    <>
      {/* Leads the menu, behind its own rule. Editing is the only entry that
          changes the ITEM rather than where it sits, so it does not want to
          be adjacent to a destination in the move list. */}
      {onEdit ? (
        <>
          <RowMenuItem
            icon={<Pencil size={13} />}
            disabled={disabled}
            onClick={() => {
              close()
              onEdit()
            }}
          >
            Edit item
          </RowMenuItem>
          <div className="my-1 border-t border-gray-100" />
        </>
      ) : null}
      {onStartReorder ? (
        <>
          <RowMenuItem
            icon={<ArrowUpDown size={13} />}
            disabled={disabled || locationsUnavailable}
            onClick={() => {
              // Read the trigger BEFORE close(), while the menu is still the
              // thing that owns it. close() only clears the popover position;
              // the kebab itself stays mounted, so the element stays valid.
              const origin = triggerRef.current
              close()
              onStartReorder(origin)
            }}
          >
            Reorder in this bag
          </RowMenuItem>
          <div className="my-1 border-t border-gray-100" />
        </>
      ) : null}
      {!isContainer && onUseAsContainer ? (
        <>
          <RowMenuItem
            icon={<PackagePlus size={13} />}
            disabled={disabled || locationsUnavailable || containerCreationDisabled}
            onClick={() => {
              close()
              onUseAsContainer()
            }}
          >
            Use as container
          </RowMenuItem>
          <div className="my-1 border-t border-gray-100" />
        </>
      ) : null}
      {moveRows}
      {onStopUsingAsContainer ? (
        <>
          <div className="my-1 border-t border-gray-100" />
          <RowMenuItem
            icon={<PackageMinus size={13} />}
            tone="removal"
            disabled={disabled || locationsUnavailable}
            onClick={() => {
              close()
              onStopUsingAsContainer()
            }}
          >
            Stop using as container
          </RowMenuItem>
        </>
      ) : null}
      {/* Last, and behind its own rule. This is the only item in the menu that
          takes the row off the list rather than moving it around, so it does
          not want to sit adjacent to a destination in the move list where a
          mis-tap costs real work. */}
      {onRemoveFromList ? (
        <>
          <div className="my-1 border-t border-gray-100" />
          <RowMenuItem
            icon={<Trash2 size={13} />}
            tone="removal"
            disabled={disabled}
            onClick={() => {
              close()
              onRemoveFromList()
            }}
          >
            Remove from list
          </RowMenuItem>
        </>
      ) : null}
    </>
  )

  return (
    <>
      <RowIconButton
        touchSafe
        ref={triggerRef}
        onClick={() => open ? close() : openMenu()}
        disabled={disabled}
        ariaLabel={`Open ${itemName} packing options`}
        title="Packing options"
        icon={<MoreVertical size={14} />}
      />
      {mobile && open ? (
        <MobileOptionsModal open={open} onClose={close} title={`${itemName} packing options`}>
          <div ref={menuRef} className="space-y-1">{rows}</div>
        </MobileOptionsModal>
      ) : !mobile && open && menuPos && 'left' in menuPos ? createPortal(
        <div
          ref={menuRef}
          role="group"
          aria-label={`${itemName} packing options`}
          className={`fixed z-50 w-56 py-1 ${POPOVER_SURFACE}`}
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {rows}
        </div>,
        document.body,
      ) : null}
    </>
  )
}
