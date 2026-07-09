import { useState } from 'react'
import { useLocation } from 'react-router'
import { Plus, Settings2, Upload } from 'lucide-react'
import MobileOptionsModal from '../components/MobileOptionsModal'
import MobileBottomBar from '../components/MobileBottomBar'
import { useSuppressMobilePrimaryNav } from '../layout/mobile-primary-nav-context'
import { buildMobileDestinationItems } from '../layout/mobile-nav-destinations'

type Props = {
  /** Start the existing inline new-list flow in the page header. The bar
   *  doesn't try to own that state — it just triggers the parent. */
  onNewList: () => void
  /** Open the existing CSV import file picker. Hidden file input stays on
   *  the page so the desktop header button and this bar trigger the same
   *  parse pipeline. */
  onImportCsv: () => void
}

// Mobile-only bottom action bar for the Lists page. Standardized 4-slot
// shape (Gear / Lists / Add / Options) shared with every other mobile
// bar. The first two destination slots come from
// buildMobileDestinationItems; Add and Options carry page-specific
// behavior. Import CSV lives behind Options so it doesn't compete with
// the primary "Add" affordance.
//
// Visibility:
//   - lg:hidden inside MobileBottomBar so desktop never renders this bar.
//   - Renders only on /lists because it's mounted by ListsPage.
export default function MobileListsActionBar({ onNewList, onImportCsv }: Props) {
  useSuppressMobilePrimaryNav()
  const { pathname } = useLocation()
  const [optionsOpen, setOptionsOpen] = useState(false)

  return (
    <>
      <MobileBottomBar
        label="Lists navigation and actions"
        items={[
          ...buildMobileDestinationItems(pathname),
          {
            type: 'button',
            label: 'Add',
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
