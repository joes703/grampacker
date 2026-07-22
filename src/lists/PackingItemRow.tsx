import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import type { ListItemWithGear, PackingLocation } from '../lib/types'
import { makeDnDId } from '../lib/dnd-ids'
import { asButtonRef } from '../lib/dnd'
import RowIconButton from '../components/RowIconButton'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_ROW,
  FLAT_TABLE_ROW_PADDING,
} from '../components/flat-table-styles'
import MoveToLocationMenu from './MoveToLocationMenu'

type Props = {
  item: ListItemWithGear
  locations: PackingLocation[]
  mobile: boolean
  disabled: boolean
  containerCreationDisabled: boolean
  isContainer: boolean
  onMove: (locationId: string | null) => void
  onUseAsContainer: () => void
}

export default function PackingItemRow({
  item,
  locations,
  mobile,
  disabled,
  containerCreationDisabled,
  isContainer,
  onMove,
  onUseAsContainer,
}: Props) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: makeDnDId('packing-item', item.id), disabled })
  const containerActionProps = isContainer
    ? { isContainer: true as const }
    : { isContainer: false as const, onUseAsContainer }

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
      className={`${FLAT_TABLE_ROW} ${FLAT_TABLE_ROW_PADDING} ${FLAT_TABLE_BODY_TEXT} gap-2 bg-white`}
    >
      <RowIconButton
        touchSafe
        ref={asButtonRef(setActivatorNodeRef)}
        {...listeners}
        {...attributes}
        disabled={disabled}
        variant="dragHandle"
        ariaLabel={`Reorder or move ${item.gearItem.name}`}
        icon={<GripVertical size={14} />}
      />
      <span className="min-w-0 flex-1 truncate text-gray-900">{item.gearItem.name}</span>
      {item.quantity > 1 ? <span className="text-gray-500">x{item.quantity}</span> : null}
      <MoveToLocationMenu
        itemId={item.id}
        itemName={item.gearItem.name}
        currentLocationId={item.packingLocationId}
        locations={locations}
        mobile={mobile}
        disabled={disabled}
        containerCreationDisabled={containerCreationDisabled}
        onMove={onMove}
        {...containerActionProps}
      />
    </div>
  )
}
