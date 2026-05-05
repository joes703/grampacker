import type { Session } from '@supabase/supabase-js'
import { useAuth } from './AuthProvider'

// Helper for pages that require an authenticated session. Returns
// { session, userId } when authenticated, or null when not.
//
// Single calling convention (every site uses this shape, no
// exceptions — protects hooks-order safety):
//
//   const auth = useRequireSession()
//   const userId = auth?.userId ?? ''
//   // ...all useQuery / useMutation / useMemo / useEffect / useState
//   //    hooks here, in the same order as before...
//   if (!auth) return null
//   // ...rest of render, including auth.session.* if needed...
//
// Collapses the duplicated `userId = session?.user.id ?? ''` /
// `if (!session) return null` pair into one helper, and removes
// `session!.user.id` bangs that relied on a caller wrapping in
// <RequireSession>. The empty-string `userId` fallback keeps queries
// runnable in the brief unauth render before the early-return fires.
export function useRequireSession(): { session: Session; userId: string } | null {
  const { session } = useAuth()
  if (!session) return null
  return { session, userId: session.user.id }
}
