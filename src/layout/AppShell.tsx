import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router'
import NavBar from './NavBar'
import MobilePrimaryNav from './MobilePrimaryNav'
import RootRedirect from './RootRedirect'
import { SidebarDrawerProvider } from './sidebar-drawer-context'
import { MobilePrimaryNavProvider } from './mobile-primary-nav-context'
import GearLibraryPage from '../gear/GearLibraryPage'
import ListsPage from '../lists/ListsPage'
import ListDetailPage from '../lists/ListDetailPage'
import PasskeyNudge from '../components/PasskeyNudge'

// Secondary surfaces, lazy-loaded to keep them out of the entry chunk. The
// food pages pull in the whole nutrition / plan / projection subtree, so
// splitting them is the biggest single bundle win here (perf audit P3). They
// already sit under the shared <Suspense fallback={null}> below.
// ListsPage/ListDetailPage/GearLibraryPage stay eager — they are the
// post-login destinations and primary navigation surfaces; lazy would add a
// chunk hop on every nav with no real win.
const SettingsPage = lazy(() => import('../settings/SettingsPage'))
const HelpPage = lazy(() => import('../help/HelpPage'))
const FoodLibraryPage = lazy(() => import('../food/FoodLibraryPage'))
const FoodPlanPage = lazy(() => import('../food/FoodPlanPage'))

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
                <Route path="/lists/:id/pack" element={<ListDetailPage />} />
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
