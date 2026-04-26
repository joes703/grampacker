import { Routes, Route, Navigate } from 'react-router'
import NavBar from './NavBar'
import GearLibraryPage from '../gear/GearLibraryPage'
import ListIndexPage from '../lists/ListIndexPage'
import ListDetailPage from '../lists/ListDetailPage'

function NotFound() {
  return (
    <div className="flex h-64 items-center justify-center rounded-xl border-2 border-dashed border-gray-200">
      <p className="text-sm text-gray-400">Page not found</p>
    </div>
  )
}

export default function AppShell() {
  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/gear" replace />} />
          <Route path="/gear" element={<GearLibraryPage />} />
          <Route path="/lists" element={<ListIndexPage />} />
          <Route path="/lists/:id" element={<ListDetailPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  )
}
