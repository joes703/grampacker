import { Navigate, Route, Routes } from 'react-router'
import RootRedirect from './layout/RootRedirect'
import AppShell from './layout/AppShell'
import GearLibraryPage from './gear/GearLibraryPage'
import FoodLibraryPage from './food/FoodLibraryPage'
import FoodPlansPage from './food/FoodPlansPage'
import FoodPlanEditor from './food/FoodPlanEditor'
import SettingsPage from './settings/SettingsPage'
import ListsPage from './lists/ListsPage'
import ListDetailPage from './lists/ListDetailPage'
import { FOOD_PLANNING_ENABLED } from './lib/product-features'

// Everything behind the session gate (App.tsx imports this module and nothing
// else from here), as one lazy boundary rather than one per page.
//
// Per-page splitting is possible - it would want AppShell kept eager, since a
// LAZY layout route does serialize: React renders AppShell before it renders the
// Outlet, so the page chunk underneath could not start downloading until the
// shell chunk resolved. But paying that price means putting AppShell back in the
// anonymous bundle, and the reward is a chunk hop the first time a signed-in
// user opens each page - pages they are going to open anyway. The pages in here
// are all post-login primary destinations; there is no page a typical session
// does not touch. One boundary fetches the set once, hits the immutable asset
// cache from then on, and navigates without a network hop at all.
//
// Leaf-level splitting still happens inside the pages, where it does pay:
// ListSidebarDrawer's Radix Dialog, NotesEditor's markdown renderer. Those are
// genuinely optional - most sessions never open them.
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
        {FOOD_PLANNING_ENABLED ? (
          <>
            <Route path="food" element={<FoodLibraryPage />} />
            {/* Plans live under the /food home beside the library (FoodTabs).
                The index lists plans; :id opens one plan graph. */}
            <Route path="food/plans" element={<FoodPlansPage />} />
            <Route path="food/plans/:id" element={<FoodPlanEditor />} />
          </>
        ) : (
          // Preserve old bookmarks without exposing a half-disabled editor.
          <Route path="food/*" element={<Navigate to="/lists" replace />} />
        )}
        <Route path="settings" element={<SettingsPage />} />
        {/* Pack is a URL segment of the same detail page (see
            ListDetailPage's mode derivation). The two /organize routes are
            RETIRED - Organize merged into Pack - but stay mounted so old
            bookmarks and home-screen shortcuts resolve; the page rewrites
            them to /pack rather than 404ing. */}
        <Route path="lists" element={<ListsPage />} />
        <Route path="lists/:id" element={<ListDetailPage />} />
        <Route path="lists/:id/pack" element={<ListDetailPage />} />
        <Route path="lists/:id/organize" element={<ListDetailPage />} />
        {/* Organize's original nesting under Pack, kept for the same reason. */}
        <Route path="lists/:id/pack/organize" element={<ListDetailPage />} />
      </Route>
      {/* Unknown path under the gate: send them home rather than showing a
          dead end. This is the old top-level "*" catch-all - it lives here now
          because the splat route in App.tsx swallows everything that is not a
          public path. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
