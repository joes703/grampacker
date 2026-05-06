import { BrowserRouter } from 'react-router'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './auth/AuthProvider'
import AppRoutes from './routes'
import ToastViewport from './components/Toast'
import { mutationErrorHandler } from './lib/mutation-error-handler'

// The MutationCache.onError handler is extracted to
// src/lib/mutation-error-handler.ts so the same function powers both
// production and the unit tests (a copy in the test would only test
// the copy). See that module's doc comment for the full rationale.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 30 },
  },
  mutationCache: new MutationCache({ onError: mutationErrorHandler }),
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
