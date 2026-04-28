import { Routes, Route, Navigate } from 'react-router'
import NavBar from './NavBar'
import MobileTabBar from './MobileTabBar'
import GearLibraryPage from '../gear/GearLibraryPage'
import ListDetailPage from '../lists/ListDetailPage'
import SettingsPage from '../settings/SettingsPage'
import HelpPage from '../help/HelpPage'
import AboutPage from '../about/AboutPage'

function NotFound() {
  return (
    <div className="flex h-64 items-center justify-center rounded-xl border-2 border-dashed border-gray-200">
      <p className="text-sm text-gray-400 italic">Page not found</p>
    </div>
  )
}

export default function AppShell() {
  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      {/* Bottom padding on mobile clears the fixed MobileTabBar (h-14 = 56 px)
          plus its safe-area-inset-bottom. On lg+ the tab bar is hidden, so
          revert to the original py-8 spacing. */}
      <main className="mx-auto max-w-7xl px-4 pt-4 lg:pt-8 pb-[calc(3.5rem+env(safe-area-inset-bottom)+1rem)] lg:pb-8">
        <Routes>
          <Route path="/" element={<Navigate to="/lists" replace />} />
          <Route path="/gear" element={<GearLibraryPage />} />
          <Route path="/lists" element={<ListDetailPage />} />
          <Route path="/lists/:id" element={<ListDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <MobileTabBar />
    </div>
  )
}
