import { useEffect, useSyncExternalStore } from 'react'
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import {
  dismissToast,
  getToasts,
  subscribe,
  type Toast as ToastModel,
  type ToastType,
} from '../lib/toast'

// Mounted once at the app root by App.tsx. Subscribes to the module store
// in src/lib/toast.ts via useSyncExternalStore (the React-19 idiom for
// non-React stores) and renders the active toast list.
//
// Position: bottom-right on md+; bottom-stretched on mobile, lifted above
// the MobileTabBar (h-14) plus its safe-area inset so toasts don't sit
// under the fixed tab bar. The bottom calc mirrors AppShell's main pb-.
//
// role="status" announces new toasts to screen readers with polite
// priority. aria-live="polite" so additive new toasts also announce
// without interrupting the current SR output.
export default function ToastViewport() {
  const toasts = useSyncExternalStore(subscribe, getToasts, getToasts)

  if (toasts.length === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] z-50 flex flex-col gap-2 md:left-auto md:right-4 md:bottom-4 md:w-80"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  )
}

function ToastCard({ toast }: { toast: ToastModel }) {
  // Schedule auto-dismiss based on the absolute expiresAt the store
  // recorded. Subtracting `now` gives the remaining delay even if the
  // toast has been live for some time before this card mounted.
  useEffect(() => {
    const remaining = Math.max(0, toast.expiresAt - Date.now())
    const handle = setTimeout(() => dismissToast(toast.id), remaining)
    return () => clearTimeout(handle)
  }, [toast.id, toast.expiresAt])

  const variant = variantStyles(toast.type)

  return (
    <div
      className={`pointer-events-auto flex items-start gap-2 rounded-lg border ${variant.border} ${variant.bg} px-3 py-2 shadow-md`}
    >
      <span className={`mt-0.5 shrink-0 ${variant.icon}`}>{variant.Icon}</span>
      <p className="flex-1 min-w-0 text-sm text-gray-900">{toast.message}</p>
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
      >
        <X size={14} />
      </button>
    </div>
  )
}

function variantStyles(type: ToastType) {
  switch (type) {
    case 'error':
      return {
        bg: 'bg-red-50',
        border: 'border-red-200',
        icon: 'text-red-600',
        Icon: <TriangleAlert size={14} aria-hidden />,
      }
    case 'success':
      return {
        bg: 'bg-green-50',
        border: 'border-green-200',
        icon: 'text-green-600',
        Icon: <CheckCircle2 size={14} aria-hidden />,
      }
    default:
      return {
        bg: 'bg-white',
        border: 'border-gray-200',
        icon: 'text-gray-500',
        Icon: <Info size={14} aria-hidden />,
      }
  }
}
