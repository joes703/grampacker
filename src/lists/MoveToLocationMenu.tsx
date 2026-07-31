import { createPortal } from 'react-dom'
import { ArrowUpDown, MapPin, MoreVertical, PackageMinus, PackagePlus, Trash2 } from 'lucide-react'
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
   *  This stays a MEMBERSHIP operation: it removes the row from this list and
   *  never touches the gear item in the library. Authoring gear belongs to the
   *  library, not to a packing checklist.
   *
   *  Optional because the caller owns the consequences - removing an item that
   *  backs a container also destroys the container, and the page confirms that
   *  case before it happens. */
  onRemoveFromList?: () => void
}

type Props = BaseProps & (
  | {
      isContainer: false
      onUseAsContainer: () => void
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
  containerCreationDisabled,
  isContainer,
  excludedLocationIds,
  onMove,
  onStartReorder,
  onRemoveFromList,
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
      disabled={disabled || choice.id === currentLocationId}
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
      {onStartReorder ? (
        <>
          <RowMenuItem
            icon={<ArrowUpDown size={13} />}
            disabled={disabled}
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
      {!isContainer ? (
        <>
          <RowMenuItem
            icon={<PackagePlus size={13} />}
            disabled={disabled || containerCreationDisabled}
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
            disabled={disabled}
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
