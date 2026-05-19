import { useState } from 'react'
import { Backpack, ListChecks, Plus, Settings2, Upload } from 'lucide-react'
import MobileOptionsModal from '../components/MobileOptionsModal'
import MobileBottomBar from '../components/MobileBottomBar'
import { useSuppressMobilePrimaryNav } from '../layout/mobile-primary-nav-context'

type Props = {
  /** Start the existing inline new-list flow in the page header. The bar
   *  doesn't try to own that state — it just triggers the parent. */
  onNewList: () => void
  /** Open the existing CSV import file picker. Hidden file input stays on
   *  the page so the desktop header button and this bar trigger the same
   *  parse pipeline. */
  onImportCsv: () => void
}

// Mobile-only bottom action bar for the Lists page. Same layout model as
// MobileListActionBar (List Detail) and MobileGearActionBar (Gear page):
// the first two slots are destination links, the right slots are page-local
// actions, rare actions live behind Options. Import CSV is moved into the
// Options modal so it doesn't compete with the primary "New" affordance.
//
// Visibility:
//   - lg:hidden inside MobileBottomBar so desktop never renders this bar.
//   - Renders only on /lists because it's mounted by ListsPage.
export default function MobileListsActionBar({ onNewList, onImportCsv }: Props) {
  useSuppressMobilePrimaryNav()
  const [optionsOpen, setOptionsOpen] = useState(false)

  return (
    <>
      <MobileBottomBar
        label="Lists navigation and actions"
        items={[
          {
            type: 'link',
            to: '/gear',
            label: 'Gear',
            icon: <Backpack size={18} />,
            ariaLabel: 'Gear',
          },
          {
            type: 'link',
            to: '/lists',
            label: 'Lists',
            icon: <ListChecks size={18} />,
            ariaLabel: 'Lists',
            active: true,
          },
          {
            type: 'button',
            label: 'New',
            icon: <Plus size={18} />,
            onClick: onNewList,
            ariaLabel: 'New list',
          },
          {
            type: 'button',
            label: 'Options',
            icon: <Settings2 size={18} />,
            onClick: () => setOptionsOpen(true),
            ariaLabel: 'Lists options',
          },
        ]}
      />

      <MobileOptionsModal
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        title="Lists options"
      >
        <div className="space-y-1" role="menu" aria-label="Lists options">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOptionsOpen(false)
              onImportCsv()
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <span className="text-gray-500"><Upload size={16} /></span>
            <span>Import from CSV</span>
          </button>
        </div>
      </MobileOptionsModal>
    </>
  )
}
