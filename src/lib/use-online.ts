import { useSyncExternalStore } from 'react'

// useSyncExternalStore against the browser's online/offline events. Same
// shape as use-breakpoint.ts so the codebase has one mental model for
// browser-state hooks. `navigator.onLine` is the snapshot; the events fire
// when connectivity transitions either direction. Each subscriber adds two
// window listeners — cheap, but the hook is intended to be called at the
// shell level (AppShell, SharePage) and threaded as a prop if needed
// rather than spawning per-row subscriptions.
function subscribe(onChange: () => void) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

function getSnapshot(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}

// SSR/test default to online. Render-time snapshot will correct on the
// next tick when the navigator is available; this matters less than for
// breakpoints since "assume offline" would flicker the banner on every
// load.
function getServerSnapshot(): boolean {
  return true
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
