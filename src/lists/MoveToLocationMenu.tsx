import { MapPin, PackageMinus, PackagePlus, Pencil, Trash2 } from 'lucide-react'
import type { PackingLocation } from '../lib/types'
import KebabMenu, { type KebabMenuContext } from '../components/KebabMenu'
import { RowMenuItem } from '../components/RowMenuItem'

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
  /** Drops the item from the list entirely, so noticing "I am not taking
   *  this" while packing does not mean leaving for List view.
   *
   *  This is a MEMBERSHIP operation: it removes the row from this list and
   *  never touches the gear item in the library. That is why it sits behind
   *  its own rule at the foot of the menu, away from the destinations.
   *
   *  Optional because the caller owns the consequences - removing an item that
   *  backs a container also destroys the container, and the page confirms that
   *  case before it happens. */
  onRemoveFromList?: () => void
  /** Opens the gear editor for this row, so a wrong weight noticed while
   *  packing can be fixed without leaving the view and losing your place.
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
  onRemoveFromList,
  onEdit,
  onUseAsContainer,
  onStopUsingAsContainer,
}: Props) {
  const choices = [
    ...locations
      .filter((location) =>
        location.containerListItemId !== itemId &&
        !excludedLocationIds?.has(location.id),
      )
      .map((location) => ({ id: location.id as string | null, name: location.name })),
    { id: null, name: 'Unassigned' },
  ]
  const moveRows = ({ close }: KebabMenuContext) => choices.map((choice) => (
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
  const rows = ({ close, triggerRef }: KebabMenuContext) => (
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
      {moveRows({ close, triggerRef })}
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
    <KebabMenu
      touchSafe
      width={56}
      mobileModal={mobile}
      disabled={disabled}
      ariaLabel={`Open ${itemName} packing options`}
      menuLabel={`${itemName} packing options`}
      title="Packing options"
    >
      {rows}
    </KebabMenu>
  )
}
