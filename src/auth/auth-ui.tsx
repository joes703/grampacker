import type { ReactNode } from 'react'

// Deliberately minimal: the real visual system arrives with the SPA
// transplant in phase 2. These are functional, honest forms.

export const LABEL = 'block text-sm font-medium text-gray-700'

export const FIELD =
  'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

export const PRIMARY_BUTTON =
  'w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'

export const TEXT_LINK = 'font-medium text-blue-600 hover:underline'

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-2xl font-bold tracking-tight text-gray-900">
          grampacker
        </h1>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">{title}</h2>
          {children}
        </div>
      </div>
    </main>
  )
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="text-sm text-rose-700" role="alert">
      {message}
    </p>
  )
}
