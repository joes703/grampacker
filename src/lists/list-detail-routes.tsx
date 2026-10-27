import { Navigate, useLocation, useParams } from 'react-router'
import ListDetailPage from './ListDetailPage'
import { persistedListPath } from './list-detail-mode'

// Old Organize URLs. Organize is part of Pack, so an old bookmark or
// home-screen shortcut lands on /pack, keeping its query and fragment. The
// router matches case-insensitively and ignores a trailing slash.
function OrganizeRedirect() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  return (
    <Navigate
      replace
      to={{ pathname: persistedListPath(id!, 'pack'), search: location.search, hash: location.hash }}
    />
  )
}

// The list detail routes, shared by the app and the page tests. Each view is a
// URL so it is bookmarkable and survives a refresh. All three render the same
// component, so switching views on one list keeps the page mounted.
export const LIST_DETAIL_ROUTES = {
  'lists/:id': <ListDetailPage mode="edit" />,
  'lists/:id/pack': <ListDetailPage mode="pack" />,
  'lists/:id/food': <ListDetailPage mode="food" />,
  'lists/:id/organize': <OrganizeRedirect />,
  'lists/:id/pack/organize': <OrganizeRedirect />,
}
