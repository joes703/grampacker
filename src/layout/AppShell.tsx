import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router'
import NavBar from './NavBar'
import MobilePrimaryNav from './MobilePrimaryNav'
import RootRedirect from './RootRedirect'
import { SidebarDrawerProvider } from './sidebar-drawer-context'
import { MobilePrimaryNavProvider } from './mobile-primary-nav-context'
import GearLibraryPage from '../gear/GearLibraryPage'
import FoodLibraryPage from '../food/FoodLibraryPage'
import ListsPage from '../lists/ListsPage'
import ListDetailPage from '../lists/ListDetailPage'
import FoodPlanPage from '../food/FoodPlanPage'
import OfflineBanner from '../components/OfflineBanner'
import PasskeyNudge from '../components/PasskeyNudge'

// Settings and Help are rarely visited and don't need to ship in the main
// bundle. ListsPage/ListDetailPage/GearLibraryPage stay eager — they are
// the post-login destinations and the primary navigation surfaces; lazy
// would add a chunk hop on every nav with no real win.
const SettingsPage = lazy(() => import('../settings/SettingsPage'))
const HelpPage = lazy(() => import('../help/HelpPage'))

function NotFound() {
  return (
    <div className="flex h-64 items-center justify-center rounded-xl border-2 border-dashed border-gray-200">
      <p className="text-sm text-gray-400 italic">Page not found</p>
    </div>
  )
}

export default function AppShell() {
  return (
    <SidebarDrawerProvider>
      <MobilePrimaryNavProvider>
        <div className="min-h-screen bg-gray-50">
          <OfflineBanner />
          <PasskeyNudge />
          <NavBar />
          <main className="mx-auto max-w-7xl px-4 pt-4 lg:pt-8 pb-20 lg:pb-8">
            <Suspense fallback={null}>
              <Routes>
                <Route path="/" element={<RootRedirect />} />
                <Route path="/gear" element={<GearLibraryPage />} />
                <Route path="/food" element={<FoodLibraryPage />} />
                <Route path="/lists" element={<ListsPage />} />
                <Route path="/lists/:id" element={<ListDetailPage />} />
                <Route path="/lists/:id/food" element={<FoodPlanPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/help" element={<HelpPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </main>
          <MobilePrimaryNav />
        </div>
      </MobilePrimaryNavProvider>
    </SidebarDrawerProvider>
  )
}
