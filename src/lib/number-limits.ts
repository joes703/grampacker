import { MAX_ITEM_WEIGHT_GRAMS } from './caps'

// For the inline editors, which have no <form> and so no browser message on
// submit. Forms get the browser's own check from the same min and max.
//
// Too many decimals is left out on purpose: that gets rounded, and rounding is
// not the number changing under the user.
export function isOutOfLimits(input: HTMLInputElement | null): boolean {
  if (!input) return false
  const { rangeOverflow, rangeUnderflow, badInput } = input.validity
  return rangeOverflow || rangeUnderflow || badInput
}

export const WEIGHT_LIMIT_MESSAGE = `Weight must be 0 to ${MAX_ITEM_WEIGHT_GRAMS / 1000} kg. Not saved.`

export function quantityLimitMessage(max: number): string {
  return `Quantity must be 1 to ${max}. Not saved.`
}
