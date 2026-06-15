// Per-route slot resolution. NavBar sits outside the inner <Routes>, so the
// current route context has to be derived from the pathname.
export type RouteContext =
  | { kind: 'list-detail'; listId: string }
  | { kind: 'all-lists' }
  | { kind: 'gear' }
  | { kind: 'food' }
  | { kind: 'settings' }
  | { kind: 'help' }
  | { kind: 'other' }

export function resolveRoute(pathname: string): RouteContext {
  const listMatch = pathname.match(/^\/lists\/([^/]+)(?:\/(?:pack|food))?$/)
  if (listMatch?.[1]) return { kind: 'list-detail', listId: listMatch[1] }
  if (pathname === '/lists') return { kind: 'all-lists' }
  if (pathname === '/gear') return { kind: 'gear' }
  if (pathname === '/food') return { kind: 'food' }
  if (pathname === '/settings') return { kind: 'settings' }
  if (pathname === '/help') return { kind: 'help' }
  return { kind: 'other' }
}
