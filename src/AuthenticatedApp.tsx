import { Navigate, Route, Routes } from 'react-router'
import RootRedirect from './layout/RootRedirect'
import AppShell from './layout/AppShell'
import GearLibraryPage from './gear/GearLibraryPage'
import SettingsPage from './settings/SettingsPage'
import ListsPage from './lists/ListsPage'
import ListDetailPage from './lists/ListDetailPage'

// Everything behind the session gate, in ONE lazy chunk (App.tsx imports this
// module and nothing else from here).
//
// One chunk, not one per page, on purpose. The pages in here are all
// post-login primary destinations, so splitting them individually would buy a
// smaller first authenticated payload at the cost of a chunk hop on every
// nav - and it would ALSO serialize: React renders AppShell (the layout route)
// before it renders the Outlet, so a lazy AppShell would have to resolve before
// the lazy page underneath it even started downloading. A single chunk fetches
// once, hits the immutable asset cache on every later visit, and navigates
// instantly. Leaf-level splitting still happens inside the pages, where it pays
// (ListSidebarDrawer's Radix Dialog, NotesEditor's markdown renderer).
//
// Routes are relative because App.tsx mounts this at path="/*": the splat is
// the remainder of the URL, and this nested <Routes> matches against it.
export default function AuthenticatedApp() {
  return (
    <Routes>
      {/* AppShell is a layout route (header + mobile primary nav); the pages
          render through its Outlet. */}
      <Route element={<AppShell />}>
        {/* No home page: `/` redirects to the most-recent list (or the lists
            empty state for a brand-new account). See RootRedirect. */}
        <Route index element={<RootRedirect />} />
        <Route path="gear" element={<GearLibraryPage />} />
        <Route path="settings" element={<SettingsPage />} />
        {/* Pack mode is a URL segment of the same detail page (see
            ListDetailPage's mode derivation + legacy ?mode=pack redirect). */}
        <Route path="lists" element={<ListsPage />} />
        <Route path="lists/:id" element={<ListDetailPage />} />
        <Route path="lists/:id/pack" element={<ListDetailPage />} />
      </Route>
      {/* Unknown path under the gate: send them home rather than showing a
          dead end. This is the old top-level "*" catch-all - it lives here now
          because the splat route in App.tsx swallows everything that is not a
          public path. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
