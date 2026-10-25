import { expect } from 'vitest'

// jsdom does no layout, so this checks the class that makes truncation work.
// A flex item's minimum width defaults to its content, so a flex-1 box
// between the row and a truncating name grows to fit a long name and pushes
// the weight off the row instead. Every flex-1 box from the name up to the
// row must carry min-w-0, or overflow-hidden, which also drops that minimum
// to zero (SwipeableRow uses it).
export function expectNameCanShrink(nameEl: HTMLElement, row: HTMLElement) {
  let el: HTMLElement | null = nameEl.parentElement
  while (el && el !== row) {
    if (el.classList.contains('flex-1')) {
      const shrinks = el.classList.contains('min-w-0') || el.classList.contains('overflow-hidden')
      expect(shrinks, `flex-1 box between the name and the row: "${el.className}"`).toBe(true)
    }
    el = el.parentElement
  }
  expect(el, 'row must contain the name').toBe(row)
}
