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
  // Without these, `lg:` (min-width 1024px) never matches against a ~816px
  // page box and every sheet prints in the 44px touch tier.
  it('zeroes the row minimum height and vertical padding on paper', () => {
    expect(FLAT_TABLE_ROW).toContain(PRINT_ROW_HEIGHT)
    expect(FLAT_TABLE_ROW_PADDING).toContain(PRINT_ROW_PADDING)
    expect(FLAT_TABLE_HEADER).toContain(PRINT_ROW_HEIGHT)
    expect(FLAT_TABLE_HEADER_PADDING).toContain(PRINT_ROW_PADDING)
  })

  it('drops body text to the print size', () => {
    expect(FLAT_TABLE_BODY_TEXT).toContain(PRINT_BODY_TEXT)
  })

  it('keeps rows whole and headings attached to what follows them', () => {
    expect(FLAT_TABLE_ROW).toContain(PRINT_KEEP_TOGETHER)
    expect(FLAT_TABLE_HEADER).toContain(PRINT_KEEP_WITH_NEXT)
  })

  // Whole SECTIONS are deliberately NOT kept together: nested bags are
  // descendants of their parent section, so blanket avoidance would ask the
  // browser to hold an entire bag subtree on one page.
  it('does not protect whole sections from breaking', () => {
    expect(FLAT_TABLE_SURFACE).not.toContain('break-inside-avoid')
  })

  it('unclips the surface so a wrapped name is not cut off', () => {
    expect(FLAT_TABLE_SURFACE).toContain('print:overflow-visible')
  })
})

describe('untruncation', () => {
  // An ellipsized item name on paper is silently missing information, and
  // unlike on screen there is no scroll or resize that recovers it.
  it('undoes all three parts of `truncate`', () => {
    expect(PRINT_UNTRUNCATE).toContain('print:overflow-visible')
    expect(PRINT_UNTRUNCATE).toContain('print:text-clip')
    expect(PRINT_UNTRUNCATE).toContain('print:whitespace-normal')
  })
})

describe('popover menus never reach paper', () => {
  // Every kebab/options menu in the app portals to document.body, so hiding a
  // trigger - or any ancestor of it - does nothing. This token is the single
  // thing all of them compose, which is why the rule lives on it.
  it('hides the shared popover surface in print', () => {
    expect(POPOVER_SURFACE).toContain('print:hidden')
  })
})
