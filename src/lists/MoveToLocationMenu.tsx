import { createPortal } from 'react-dom'
import { MapPin, MoreVertical, PackagePlus } from 'lucide-react'
import type { PackingLocation } from '../lib/types'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
import RowIconButton from '../components/RowIconButton'
import { POPOVER_SURFACE } from '../components/flat-table-styles'
import { RowMenuItem } from '../components/RowMenuItem'
import MobileOptionsModal from '../components/MobileOptionsModal'

type Props = {
  itemId: string
  itemName: string
  currentLocationId: string | null
  locations: PackingLocation[]
  mobile: boolean
  disabled: boolean
  containerCreationDisabled: boolean
  isContainer: boolean
  onMove: (locationId: string | null) => void
  onUseAsContainer: () => void
}

export default function MoveToLocationMenu({
  itemId,
  itemName,
  currentLocationId,
  locations,
  mobile,
  disabled,
  containerCreationDisabled,
  isContainer,
  onMove,
  onUseAsContainer,
}: Props) {
  const { open, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-flush', menuWidth: 224 })

  const choices = [
    ...locations
      .filter((location) => location.containerListItemId !== itemId)
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
