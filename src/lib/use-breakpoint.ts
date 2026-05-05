import { useSyncExternalStore } from 'react'

// Two breakpoints used by the app. Keep the strings here as the single
// source of truth — Tailwind's `lg:` is 1024px and Tailwind's `md:` is
// 768px, so `useIsBelowLg()` matches the negation of `lg:` and
// `useIsMobile()` matches the negation of `md:`.
const QUERIES = {
  belowLg: '(max-width: 1023px)',
  mobile: '(max-width: 767px)',
} as const

// useSyncExternalStore lets every consumer of the same query share one
// matchMedia listener. Without this, a list with 300 rows would register
// 300 separate listeners that all fire on every breakpoint cross.
function makeSubscribe(query: string) {
  return (onChange: () => void) => {
    if (typeof window === 'undefined') return () => {}
    const mq = window.matchMedia(query)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }
}
function makeGetSnapshot(query: string) {
  return () =>
    typeof window !== 'undefined' && window.matchMedia(query).matches
}
function getServerSnapshot(): boolean {
  return false
}

const belowLgSubscribe = makeSubscribe(QUERIES.belowLg)
const belowLgGetSnapshot = makeGetSnapshot(QUERIES.belowLg)
const mobileSubscribe = makeSubscribe(QUERIES.mobile)
const mobileGetSnapshot = makeGetSnapshot(QUERIES.mobile)

// True at <1024px. Use for sites that swap behavior at Tailwind's `lg:`
// boundary (rows with desktop+mobile bodies, the sidebar drawer, etc.).
export function useIsBelowLg(): boolean {
  return useSyncExternalStore(belowLgSubscribe, belowLgGetSnapshot, getServerSnapshot)
}

// True at <768px. Use for sites that swap behavior at Tailwind's `md:`
// boundary (the bottom-sheet list selector).
export function useIsMobile(): boolean {
  return useSyncExternalStore(mobileSubscribe, mobileGetSnapshot, getServerSnapshot)
}
