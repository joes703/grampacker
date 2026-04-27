import { Drawer } from 'vaul'
import type { GearItem, Category } from '../lib/types'
import type { WeightUnit } from '../lib/weight'
import LibraryPanel from './LibraryPanel'

type Props = {
  open: boolean
  onClose: () => void
  gearItems: GearItem[]
  categories: Category[]
  listItemGearIds: Set<string>
  weightUnit: WeightUnit
  onAdd: (item: GearItem) => void
  onDelete: (item: GearItem) => void
}

export default function LibrarySheet({ open, onClose, gearItems, categories, listItemGearIds, weightUnit, onAdd, onDelete }: Props) {
  return (
    <Drawer.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col rounded-t-2xl bg-white">
          <div className="mx-auto mt-3 mb-1 h-1.5 w-10 rounded-full bg-gray-300" />
          <Drawer.Title className="px-4 py-2 text-sm font-semibold text-gray-800">
            Gear library
          </Drawer.Title>
          <div className="flex-1 overflow-hidden">
            <LibraryPanel
              gearItems={gearItems}
              categories={categories}
              listItemGearIds={listItemGearIds}
              weightUnit={weightUnit}
              onAdd={(item) => { onAdd(item) }}
              onDelete={onDelete}
            />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
