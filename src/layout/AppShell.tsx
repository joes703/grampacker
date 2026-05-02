import { Routes, Route } from 'react-router'
import NavBar from './NavBar'
import MobileTabBar from './MobileTabBar'
import RootRedirect from './RootRedirect'
import { SidebarDrawerProvider } from './sidebar-drawer-context'
import GearLibraryPage from '../gear/GearLibraryPage'
import ListsPage from '../lists/ListsPage'
import ListDetailPage from '../lists/ListDetailPage'
import SettingsPage from '../settings/SettingsPage'
import HelpPage from '../help/HelpPage'

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
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        {/* Bottom padding under md clears the fixed MobileTabBar (h-14 = 56 px)
            plus its safe-area-inset-bottom. At md+ the tab bar is hidden
            (the top nav covers every destination), so revert to py-8. */}
        <main className="mx-auto max-w-7xl px-4 pt-4 lg:pt-8 pb-[calc(3.5rem+env(safe-area-inset-bottom)+1rem)] md:pb-8">
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/gear" element={<GearLibraryPage />} />
            <Route path="/lists" element={<ListsPage />} />
            <Route path="/lists/:id" element={<ListDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <MobileTabBar />
      </div>
    </SidebarDrawerProvider>
  )
}
