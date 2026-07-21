import { createPortal } from 'react-dom'
import { MapPin, MoreVertical } from 'lucide-react'
import type { PackingLocation } from '../lib/types'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
import RowIconButton from '../components/RowIconButton'
import { POPOVER_SURFACE } from '../components/flat-table-styles'
import { RowMenuItem } from '../components/RowMenuItem'
import MobileOptionsModal from '../components/MobileOptionsModal'

type Props = {
  itemName: string
  currentLocationId: string | null
  locations: PackingLocation[]
  mobile: boolean
  disabled: boolean
  onMove: (locationId: string | null) => void
}

export default function MoveToLocationMenu({
  itemName,
  currentLocationId,
  locations,
  mobile,
  disabled,
  onMove,
}: Props) {
  const { open, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-flush', menuWidth: 224 })

  const choices = [
    ...locations.map((location) => ({ id: location.id as string | null, name: location.name })),
    { id: null, name: 'Unassigned' },
  ]
  const rows = choices.map((choice) => (
    <RowMenuItem
      key={choice.id ?? '__unassigned__'}
      icon={<MapPin size={13} />}
      disabled={disabled || choice.id === currentLocationId}
      inMenu={!mobile}
      onClick={() => {
        close()
        onMove(choice.id)
      }}
    >
      {choice.name}
    </RowMenuItem>
  ))

  return (
    <>
      <RowIconButton
        ref={triggerRef}
        onClick={() => open ? close() : openMenu()}
        disabled={disabled}
        ariaLabel={`Move ${itemName} to another packing location`}
        title="Move to..."
        icon={<MoreVertical size={14} />}
      />
      {mobile && open ? (
        <MobileOptionsModal open={open} onClose={close} title={`Move ${itemName} to...`}>
          <div className="space-y-1">{rows}</div>
        </MobileOptionsModal>
      ) : !mobile && open && menuPos && 'left' in menuPos ? createPortal(
        <div
          ref={menuRef}
          role="menu"
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
