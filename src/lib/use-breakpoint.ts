import { useSyncExternalStore } from 'react'

// Three breakpoints used by the app. Keep the strings here as the single
// source of truth — Tailwind's `xl:` is 80rem, `lg:` is 64rem and `md:` is
// 48rem, so `useIsBelowXl()` matches the negation of `xl:`,
// `useIsBelowLg()` matches the negation of `lg:` and `useIsMobile()` matches
// the negation of `md:`. Read the note on the query strings below before
// changing their form: the negations are exact only because of it.
// Two details here are load-bearing, and both exist so these are the EXACT
// complement of the Tailwind prefix they name - not an approximation.
//
// 1. Range syntax, not `max-width`. Tailwind's prefixes are min-width rules,
//    and no max-width value is their complement: `1279px` misses from 1279.01
//    up, and even the conventional `1279.98px` misses at 1279.99. Browsers
//    produce those widths under zoom and device emulation, and in the gap a
//    JS-gated control and its CSS counterpart are both absent - or, at the
//    other boundary, both present.
//
// 2. rem, not px. Tailwind v4 emits `md/lg/xl` as `48rem/64rem/80rem`. Those
//    equal 768/1024/1280px ONLY at a 16px root font. A reader who raises their
//    browser's default font size moves every Tailwind breakpoint and would
//    otherwise leave these hooks answering for a boundary the CSS no longer
//    has - at 20px root, `xl:` starts at 1600px while a px-based hook would
//    flip at 1280px, a 320px-wide hole.
//
// Media Queries Level 4 range syntax; Safari 16.4+, Chrome 104+, Firefox 102+.
const QUERIES = {
  belowXl: '(width < 80rem)',
  belowLg: '(width < 64rem)',
  mobile: '(width < 48rem)',
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

// True below Tailwind's `xl:` (80rem — 1280px at a default root font). Use
// where a control must exist only in the band the Pack picker aside does not
// cover: the aside is `xl:flex`, so a JS gate is what keeps DOM presence
// honest between `lg:` and `xl:` rather than leaving an element
// mounted-but-CSS-hidden that tests would read as present.
export function useIsBelowXl(): boolean {
  return useSyncExternalStore(belowXlSubscribe, belowXlGetSnapshot, getServerSnapshot)
}

// True below Tailwind's `lg:` (64rem — 1024px at a default root font). Use for
// sites that swap behavior at that boundary (rows with desktop+mobile bodies,
// the sidebar drawer, etc.).
export function useIsBelowLg(): boolean {
  return useSyncExternalStore(belowLgSubscribe, belowLgGetSnapshot, getServerSnapshot)
}

// True below Tailwind's `md:` (48rem — 768px at a default root font). Use for
// sites that swap behavior at that boundary (the bottom-sheet list selector).
export function useIsMobile(): boolean {
  return useSyncExternalStore(mobileSubscribe, mobileGetSnapshot, getServerSnapshot)
}
