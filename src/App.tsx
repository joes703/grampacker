import { BrowserRouter } from 'react-router'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './auth/AuthProvider'
import AppRoutes from './routes'
import ToastViewport from './components/Toast'

// Global default error handler for every useMutation in the app. Per-mutation
// onError still wins for surfacing errors inline; this just guarantees no
// failed write disappears silently.
//
// Logged in every environment (not just DEV) so production failures are
// visible when a developer or technically-curious user opens DevTools.
// Deliberately uses console.warn rather than console.error: most mutation
// failures are recoverable (optimistic snap-back, user can retry), and
// reserving console.error for genuinely non-recoverable cases keeps the
// signal-to-noise ratio honest. A future Sentry/PostHog/etc. integration
// would wrap this call site — the structured payload is already the
// shape a reporter wants.
//
// Most mutation failures are surfaced inline at their call site (e.g.,
// GearItemDialog's transactional save shows the error in the dialog) or
// are silent optimistic rollbacks where the user sees the snap-back. We
// deliberately do NOT route every mutation failure through the toast
// system from here — that would spam users with toasts for transient
// network failures and background refetch errors. The toast system
// exists (src/lib/toast.ts) and is used selectively by
// makeOptimisticReorder.onError where the rollback is otherwise silent
// and confusing. New mutation paths should consider whether their
// failure mode warrants a toast on a case-by-case basis.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 30 },
  },
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      const key = mutation.options.mutationKey?.join('/') ?? 'mutation'
      const message = error instanceof Error ? error.message : String(error)
      const code =
        error && typeof error === 'object' && 'code' in error
          ? (error as { code: unknown }).code
          : undefined
      console.warn(`[${key}] failed`, {
        error: message,
        code,
        mutationKey: mutation.options.mutationKey,
      })
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
