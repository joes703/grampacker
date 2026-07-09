import { useLocation } from 'react-router'
import { Plus, Settings2 } from 'lucide-react'
import MobileBottomBar from '../components/MobileBottomBar'
import { useSuppressMobilePrimaryNav } from '../layout/mobile-primary-nav-context'
import { buildMobileDestinationItems } from '../layout/mobile-nav-destinations'

type Props = {
  /** Start the existing inline new-list flow in the page header. The bar
   *  doesn't try to own that state — it just triggers the parent. */
  onNewList: () => void
}

// Mobile-only bottom action bar for the Lists page. Standardized 4-slot
// shape (Gear / Lists / Add / Options) shared with every other mobile
// bar. The first two destination slots come from
// buildMobileDestinationItems; Add carries the page-specific behavior.
//
// TRANSPLANT NOTE (csv): the old repo's Options slot opened a
// MobileOptionsModal whose only item was "Import from CSV". Until the
// CSV slice ships there is nothing to put in that modal, so the slot
// renders disabled (the same contextless-slot pattern as
// MobilePrimaryNav) to keep the 4-slot geography stable.
//
// Visibility:
//   - lg:hidden inside MobileBottomBar so desktop never renders this bar.
//   - Renders only on /lists because it's mounted by ListsPage.
export default function MobileListsActionBar({ onNewList }: Props) {
  useSuppressMobilePrimaryNav()
  const { pathname } = useLocation()

  return (
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
          onClick: () => {},
          disabled: true,
          ariaLabel: 'Lists options (coming soon)',
        },
      ]}
    />
  )
}
