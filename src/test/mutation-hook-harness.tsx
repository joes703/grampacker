// Shared setup for tests of the write-action hooks (src/gear/use-gear-*-actions,
// src/lists/use-list-*-actions). These tests mock only the network functions
// from lib/queries. The optimistic helpers, the QueryClient and the toast
// store are the real ones, so a test sees what the user would see: the cache
// while a request is pending, the cache after a rollback, and the toasts.
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { mutationErrorHandler } from '../lib/mutation-error-handler'
import { dismissToast, getToasts } from '../lib/toast'

// Same mutation error handler as src/App.tsx, so a meta.errorToast is shown
// the way production shows it.
export function testQueryClient(): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({ onError: mutationErrorHandler }),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

export function renderHookWithClient<T>(qc: QueryClient, hook: () => T) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return renderHook(hook, { wrapper }).result
}

// A network call the test settles by hand, to look at the cache while it is
// still pending.
export function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// The toast store is module state and outlives a test. Call in afterEach.
export function clearToasts(): void {
  for (const toast of getToasts()) dismissToast(toast.id)
}

export function toastMessages(): string[] {
  return getToasts().map((t) => t.message)
}
