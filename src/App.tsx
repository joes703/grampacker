import { BrowserRouter } from 'react-router'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './auth/AuthProvider'
import AppRoutes from './routes'
import ToastViewport from './components/Toast'

// Global default error handler for every useMutation in the app. Per-mutation
// onError still wins for surfacing errors inline; this just guarantees no
// failed write disappears silently in development. Gated on import.meta.env.DEV
// so production builds stay quiet.
//
// Most mutation failures are surfaced inline at their call site (e.g.,
// GearItemDialog's transactional save shows the error in the dialog) or are
// silent optimistic rollbacks where the user sees the snap-back. We
// deliberately do NOT route every mutation failure through the toast system
// from here — that would spam users with toasts for transient network failures
// and background refetch errors. The toast system exists (src/lib/toast.ts)
// and is used selectively by makeOptimisticReorder.onError where the rollback
// is otherwise silent and confusing. New mutation paths should consider
// whether their failure mode warrants a toast on a case-by-case basis.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 30 },
  },
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (!import.meta.env.DEV) return
      const key = mutation.options.mutationKey?.join('/') ?? 'mutation'
      console.error(`[${key}] failed:`, error)
    },
  }),
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
        <ToastViewport />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
