import { Routes, Route, Navigate } from 'react-router'
import NavBar from './NavBar'
import GearLibraryPage from '../gear/GearLibraryPage'

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-xl border-2 border-dashed border-gray-200">
      <p className="text-sm text-gray-400">{label} — coming soon</p>
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
          <Route path="/lists" element={<Placeholder label="Lists" />} />
          <Route path="*" element={<Placeholder label="Page not found" />} />
        </Routes>
      </main>
    </div>
  )
}
