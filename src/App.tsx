import { BrowserRouter } from 'react-router'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './auth/AuthProvider'
import AppRoutes from './routes'

// Global default error handler for every useMutation in the app. Per-mutation
// onError still wins for surfacing errors inline; this just guarantees no
// failed write disappears silently in development. Gated on import.meta.env.DEV
// so production builds stay quiet — temporary until a toast system lands and
// we route user-facing failures through it from here.
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
      </BrowserRouter>
    </QueryClientProvider>
  )
}
