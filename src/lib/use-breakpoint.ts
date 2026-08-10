import { useSyncExternalStore } from 'react'

// Three breakpoints used by the app. Keep the strings here as the single
// source of truth — Tailwind's `xl:` is 1280px, `lg:` is 1024px and `md:` is
// 768px, so `useIsBelowXl()` matches the negation of `xl:`,
// `useIsBelowLg()` matches the negation of `lg:` and `useIsMobile()` matches
// the negation of `md:`. See the note on the query strings below: those
// negations are only exact because of the fractional bounds.
// Range syntax, not max-width, and that is load-bearing. Tailwind's prefixes
// are min-width rules, so `xl:` is `(min-width: 1280px)`. Any `max-width`
// negation leaves a hole at fractional widths, which browsers produce under
// zoom and device emulation: `1279px` misses from 1279.01 up, and even the
// conventional `1279.98px` misses at 1279.99. In that hole a JS-gated control
// and its CSS counterpart are BOTH absent - or, at the lg boundary, both
// present. `(width < 1280px)` is the exact complement of `(min-width: 1280px)`
// at every width, fractional included.
//
// Media Queries Level 4 range syntax; Safari 16.4+, Chrome 104+, Firefox 102+.
const QUERIES = {
  belowXl: '(width < 1280px)',
  belowLg: '(width < 1024px)',
  mobile: '(width < 768px)',
} as const

// useSyncExternalStore + a single subscribe factory per query keep React
// updates batched and the call site simple. Note: each subscriber still
// registers its own matchMedia 'change' listener on the underlying
// MediaQueryList — this does NOT dedupe listeners at the DOM level. The
// real protection against listener-per-row blowup is page-level prop
// drilling: ListDetailPage / GearLibraryPage call useIsBelowLg() once and
// pass `isBelowLg` down to rows, so a 300-item list registers ~3
// listeners total, not 300.
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

const belowXlSubscribe = makeSubscribe(QUERIES.belowXl)
const belowXlGetSnapshot = makeGetSnapshot(QUERIES.belowXl)
const belowLgSubscribe = makeSubscribe(QUERIES.belowLg)
const belowLgGetSnapshot = makeGetSnapshot(QUERIES.belowLg)
const mobileSubscribe = makeSubscribe(QUERIES.mobile)
const mobileGetSnapshot = makeGetSnapshot(QUERIES.mobile)

// True at <1280px. Use where a control must exist only in the band the
// Pack picker aside does not cover — the aside is `xl:flex`, so a JS gate is
// what keeps DOM presence honest at 1024-1279px rather than leaving an
// element mounted-but-CSS-hidden that tests would read as present.
export function useIsBelowXl(): boolean {
  return useSyncExternalStore(belowXlSubscribe, belowXlGetSnapshot, getServerSnapshot)
}

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
