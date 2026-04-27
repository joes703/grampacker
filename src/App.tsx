import { BrowserRouter } from 'react-router'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './auth/AuthProvider'
import AppRoutes from './routes'

// Global default error handler for every useMutation in the app. Per-mutation
// onError still wins for surfacing errors inline; this just guarantees no
// failed write disappears silently. Once we have a toast system, route through
// it from here.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 30 },
  },
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
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
