import { describe, expect, it } from 'vitest'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_HEADER,
  FLAT_TABLE_HEADER_PADDING,
  FLAT_TABLE_ROW,
  FLAT_TABLE_ROW_PADDING,
  FLAT_TABLE_SURFACE,
  POPOVER_SURFACE,
  PRINT_BODY_TEXT,
  PRINT_KEEP_TOGETHER,
  PRINT_KEEP_WITH_NEXT,
  PRINT_ROW_HEIGHT,
  PRINT_ROW_PADDING,
  PRINT_UNTRUNCATE,
} from './flat-table-styles'

// The print tier is a third density tier that no test can SEE: jsdom
// paginates nothing and renders no paper. What these assertions pin is the
// wiring - that the shared tokens still carry the print tier, and that the
// two one-line changes doing the heavy lifting are still there.
//
// They are cheap and they are not proof of appearance. Whether a sheet is
// legible, and how many pages it runs to, is a human looking at a print
// preview. Nothing here substitutes for that.

describe('the print tier reaches the shared row/header tokens', () => {
  it.each([
    // Without the height and padding rows, `lg:` (min-width 1024px) never
    // matches against a ~816px page box and every sheet prints in the 44px
    // touch tier.
    { token: 'FLAT_TABLE_ROW', value: FLAT_TABLE_ROW, cls: PRINT_ROW_HEIGHT, has: true },
    { token: 'FLAT_TABLE_ROW_PADDING', value: FLAT_TABLE_ROW_PADDING, cls: PRINT_ROW_PADDING, has: true },
    { token: 'FLAT_TABLE_HEADER', value: FLAT_TABLE_HEADER, cls: PRINT_ROW_HEIGHT, has: true },
    { token: 'FLAT_TABLE_HEADER_PADDING', value: FLAT_TABLE_HEADER_PADDING, cls: PRINT_ROW_PADDING, has: true },
    { token: 'FLAT_TABLE_BODY_TEXT', value: FLAT_TABLE_BODY_TEXT, cls: PRINT_BODY_TEXT, has: true },
    // Rows stay whole, and headings stay attached to what follows them.
    { token: 'FLAT_TABLE_ROW', value: FLAT_TABLE_ROW, cls: PRINT_KEEP_TOGETHER, has: true },
    { token: 'FLAT_TABLE_HEADER', value: FLAT_TABLE_HEADER, cls: PRINT_KEEP_WITH_NEXT, has: true },
    // Whole SECTIONS are deliberately NOT kept together: nested bags are
    // descendants of their parent section, so blanket avoidance would ask the
    // browser to hold an entire bag subtree on one page.
    { token: 'FLAT_TABLE_SURFACE', value: FLAT_TABLE_SURFACE, cls: 'break-inside-avoid', has: false },
    // Unclipped, so a wrapped name is not cut off.
    { token: 'FLAT_TABLE_SURFACE', value: FLAT_TABLE_SURFACE, cls: 'print:overflow-visible', has: true },
    // An ellipsized item name on paper is silently missing information, and
    // unlike on screen there is no scroll or resize that recovers it. These
    // three undo all three parts of `truncate`.
    { token: 'PRINT_UNTRUNCATE', value: PRINT_UNTRUNCATE, cls: 'print:overflow-visible', has: true },
    { token: 'PRINT_UNTRUNCATE', value: PRINT_UNTRUNCATE, cls: 'print:text-clip', has: true },
    { token: 'PRINT_UNTRUNCATE', value: PRINT_UNTRUNCATE, cls: 'print:whitespace-normal', has: true },
    // Every kebab/options menu in the app portals to document.body, so hiding
    // a trigger - or any ancestor of it - does nothing. This token is the
    // single thing all of them compose, which is why the rule lives on it.
    { token: 'POPOVER_SURFACE', value: POPOVER_SURFACE, cls: 'print:hidden', has: true },
  ])('$token carries $cls: $has', ({ value, cls, has }) => {
    if (has) expect(value).toContain(cls)
    else expect(value).not.toContain(cls)
  })
})
