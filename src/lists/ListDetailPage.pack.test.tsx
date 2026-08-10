// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { ReactNode } from 'react'
import type { Category, GearItem, List, ListItemWithGear, PackingLocation } from '../lib/types'
import type { ListFoodResponse } from '../../shared/food'
import { MobilePrimaryNavProvider } from '../layout/mobile-primary-nav-context'
import { SidebarDrawerProvider } from '../layout/sidebar-drawer-context'

// Pack's entry point back to the gear library.
//
// Desktop Pack hides the left aside on purpose so packing gets the focus.
// That also removed the only desktop way to put a forgotten item on the list
// without leaving the view - Pack could rearrange what was already there and
// nothing else. The drawer restores adding without giving the aside back.
//
// Which surface carries the trigger is the whole point of these tests, so
// they assert per-breakpoint and per-view rather than just "a button exists".

const listId = 'list-1'

const list = {
  id: listId,
  name: 'Sierra High Route',
  isShared: false,
  shareSlug: null,
  description: null,
  readyChecksEnabled: true,
  updatedAt: '2026-07-01T00:00:00.000Z',
} as unknown as List

const gear = {
  id: 'gear-1',
  name: 'Cooking pot',
  weightGrams: 210,
  categoryId: null,
} as unknown as GearItem

const listItem = {
  id: 'li-1',
  gearItemId: 'gear-1',
  gearItem: gear,
  quantity: 1,
  isWorn: false,
  isConsumable: false,
  isPacked: false,
  isReady: false,
  packingLocationId: null,
  sortOrder: 0,
} as unknown as ListItemWithGear

const emptyFood: ListFoodResponse = { dayCount: 0, slots: [], items: [] }

const wornItem = {
  ...listItem,
  id: 'li-worn',
  gearItemId: 'gear-worn',
  gearItem: { ...gear, id: 'gear-worn', name: 'Sun hoody' },
  isWorn: true,
  sortOrder: 1,
} as unknown as ListItemWithGear

const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
  deleteListItem: vi.fn(),
  quickAddListItem: vi.fn(),
}))

// The page calls authClient.useSession(), which mounts better-auth's nanostores
// session atom. Nanostores keeps an unmounted store alive on a ~1s timer, and
// when that timer fires AFTER vitest has torn down this file's jsdom
// environment, better-auth's cleanupBroadcastSetup touches `window` and throws
// an unhandled ReferenceError - failing CI with every test still passing.
// Mocking the client means the atom never mounts. The session is read here only
// for the last-list pointer's owner id, which no test in this file asserts on.
vi.mock('../lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'owner-1' } }, isPending: false }) },
}))

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, ...h }
})

function stubViewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const m = /width\s*<\s*([\d.]+)px/.exec(query)
    return {
      matches: m ? width < Number(m[1]) : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }
  })
}

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={qc}>
      <MobilePrimaryNavProvider>
        <SidebarDrawerProvider>{children}</SidebarDrawerProvider>
      </MobilePrimaryNavProvider>
    </QueryClientProvider>
  )
}

async function renderDetail(path: string) {
  const { default: ListDetailPage } = await import('./ListDetailPage')
  render(
    <Providers>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/lists/:id" element={<ListDetailPage />} />
          <Route path="/lists/:id/pack" element={<ListDetailPage />} />
        </Routes>
      </MemoryRouter>
    </Providers>,
  )
  // Anchors on content that only exists past the detail loading gate. Food
  // used to render inline in both List and Pack (that was the regression
  // this file's tests were written to catch), so its heading was a
  // convenient anchor reachable from either mode; food now has its own route
  // and does not render inline in Pack, so a Food-based anchor is gone.
  //
  // The gear item's own name is NOT a safe substitute here: in List (edit)
  // view it renders in the desktop library aside too, which mounts OUTSIDE
  // the detail gate (it needs only the gear query) - so it would let this
  // file's negative assertions (no Add-gear button, no packing kebab, no
  // worn-remove button) pass vacuously before the gated item rows ever
  // render. Branch on mode instead, anchoring on something that is both
  // unconditional in that mode AND strictly inside the loaded branch:
  // the packing-location create form in Pack, the List-view-only Food
  // summary row in Edit (mirrors ListDetailPage.locations-failure.test.tsx
  // and ListDetailPage.food.test.tsx, which anchor the same way).
  if (path.endsWith('/pack')) {
    await screen.findByLabelText('New packing location')
  } else {
    await screen.findByRole('region', { name: 'Food summary' })
  }
}

const addGear = () => screen.queryByRole('button', { name: 'Add gear' })

// jsdom implements <dialog> without its modal methods, and the gear editor is
// a Modal. Same shim ListDetailPage.edit-gear.test.tsx uses.
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.open = false }
  }
})

beforeEach(() => {
  h.fetchLists.mockResolvedValue([list])
  h.fetchListItems.mockResolvedValue([listItem])
  h.fetchGearItems.mockResolvedValue([gear])
  h.fetchCategories.mockResolvedValue([] as Category[])
  h.fetchPackingLocations.mockResolvedValue([] as PackingLocation[])
  h.fetchListFood.mockResolvedValue(emptyFood)
  h.deleteListItem.mockResolvedValue(undefined)
  h.quickAddListItem.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('adding gear from Pack view', () => {
  // The band between lg and xl is the one width where Pack has neither the
  // aside (xl and up) nor the mobile action bar's Add (below lg). Remove this
  // button and that band has no path to the picker at all.
  it('offers Add gear between lg and xl, where Pack has no aside', async () => {
    stubViewport(1100)
    await renderDetail(`/lists/${listId}/pack`)
    expect(addGear()).toBeTruthy()
  })

  it('opens the gear library from that button', async () => {
    stubViewport(1100)
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(addGear() as HTMLElement)

    // The drawer is lazy-loaded, so this also proves the chunk resolves.
    expect(await screen.findByText('Add from gear')).toBeTruthy()
  })

  // The bottom action bar already carries Add below lg. A second button would
  // be two controls for one action on the surface with the least room.
  it('omits the button below lg, where the action bar already has Add', async () => {
    stubViewport(500)
    await renderDetail(`/lists/${listId}/pack`)
    expect(addGear()).toBeNull()
  })

  // At xl the picker is on screen permanently, so a button that opens the
  // same panel in a drawer is a second control for a visible surface.
  it('omits the button at xl, where the picker aside is already there', async () => {
    stubViewport(1280)
    await renderDetail(`/lists/${listId}/pack`)
    expect(addGear()).toBeNull()
  })

  // List view keeps the aside, so the library is already on screen.
  it('omits the button in desktop List view, which shows the aside', async () => {
    stubViewport(1280)
    await renderDetail(`/lists/${listId}`)
    expect(addGear()).toBeNull()
  })
})

// Every list starts with no packing locations, so Pack falls back to category
// grouping - which is the state a new user meets this view in. Removal has to
// be there, not only once a bag exists.
describe('removing gear from Pack view', () => {
  it('offers removal on a pack row when the list has no locations yet', async () => {
    stubViewport(1280)
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(
      screen.getByRole('button', { name: 'Open Cooking pot packing options' }),
    )
    await user.click(screen.getByRole('button', { name: 'Remove from list' }))

    expect(h.deleteListItem).toHaveBeenCalledWith(listId, 'li-1')
  })

  // Adjusting a weight mid-pack was one of the jobs that forced a three-view
  // shuffle. Pack now reaches the gear editor, which deliberately overturns
  // the "authoring belongs to the library, not to a packing checklist" rule
  // this menu was written under.
  it('opens the gear editor from an ordinary pack row', async () => {
    stubViewport(1280)
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(
      screen.getByRole('button', { name: 'Open Cooking pot packing options' }),
    )
    await user.click(screen.getByRole('button', { name: 'Edit item' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  // A container's own row lives in the section HEADER, with a separately
  // constructed menu - so it is reachable by neither the row kebab nor the
  // worn button. Without this the bag itself would be the one item you cannot
  // edit from Pack.
  it('opens the gear editor from a container section header', async () => {
    stubViewport(1280)
    h.fetchPackingLocations.mockResolvedValue([{
      id: 'loc-1',
      name: 'Cooking pot',
      sortOrder: 0,
      parentLocationId: null,
      containerListItemId: 'li-1',
    }] as unknown as PackingLocation[])
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(
      await screen.findByRole('button', { name: 'Open Cooking pot packing options' }),
    )
    await user.click(screen.getByRole('button', { name: 'Edit item' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  // Worn rows have no packing kebab at all, so the menu entry above cannot
  // reach them - they need their own control or "you can edit from Pack" is
  // false for a whole section.
  it('opens the gear editor from a worn pack row, which has no kebab', async () => {
    stubViewport(1280)
    h.fetchListItems.mockResolvedValue([listItem, wornItem])
    // The editor resolves the row's gear out of the gear query, so the worn
    // item's gear has to be in the library for the dialog to open at all.
    h.fetchGearItems.mockResolvedValue([gear, wornItem.gearItem])
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(screen.getByRole('button', { name: 'Edit Sun hoody' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  // Worn rows sit outside the packing tree, so they never receive the packing
  // kebab. Without their own affordance the Worn section is the one place in
  // Pack you cannot drop an item from.
  it('offers removal on a worn row, which has no packing kebab', async () => {
    stubViewport(1280)
    h.fetchListItems.mockResolvedValue([listItem, wornItem])
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(
      screen.getByRole('button', { name: 'Remove Sun hoody from list' }),
    )

    expect(h.deleteListItem).toHaveBeenCalledWith(listId, 'li-worn')
  })

  // The category-grouped sections are shared with List view, so the binding
  // that adds the packing kebab is mode-gated.
  //
  // Scope, stated because it is narrower than the title suggests: ItemRow
  // renders rowAction only inside its pack branch, so List view would look
  // like this even if the gate were removed. What this pins is the
  // USER-VISIBLE contract - List rows keep exactly one kebab, and the worn
  // removal button is a pack affordance. The gate itself earns its keep
  // elsewhere (it keeps List view from building menus and placement bindings
  // it will not render), and that is not observable from the DOM.
  it('shows no packing affordances on List view rows', async () => {
    stubViewport(1280)
    h.fetchListItems.mockResolvedValue([listItem, wornItem])
    await renderDetail(`/lists/${listId}`)

    expect(
      screen.queryByRole('button', { name: 'Open Cooking pot packing options' }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Remove Sun hoody from list' }),
    ).toBeNull()
  })
})

// Creating a brand-new item mid-pack was impossible: CategoryGroup gates its
// "+ Add new item" footer on !packMode, so the only path was Gear view ->
// List view picker -> back to Pack to place it. The picker now carries the
// control, in both arrangements.
describe('creating a new item while packing', () => {
  it('creates from Pack with a null category, never a location id', async () => {
    stubViewport(1280)
    const user = userEvent.setup()
    await renderDetail(`/lists/${listId}/pack`)

    await user.click(screen.getByRole('button', { name: 'New item' }))
    await user.type(screen.getByLabelText(/^Name/), 'Titanium spork')
    await user.click(screen.getByRole('button', { name: 'Add item' }))

    await waitFor(() => expect(h.quickAddListItem).toHaveBeenCalledWith(
      listId,
      expect.objectContaining({ name: 'Titanium spork', categoryId: null }),
    ))
  })
})

// Pack used to hide the gear picker so packing got the focus. A real trip
// showed that costs more than it buys: adding or reweighing one item meant
// leaving the view. The picker now sits beside Pack too - but at xl, not lg,
// because at 1024px a 320px aside leaves 656px for a row dense enough to
// truncate item names to ~113px rather than overflow (docs/one-page-list-design.md).
describe('the gear picker beside Pack', () => {
  const listsPanel = () =>
    screen.queryByRole('button', { name: 'New list or import CSV' })

  it('renders the picker aside in Pack, gated at xl rather than lg', async () => {
    stubViewport(1280)
    await renderDetail(`/lists/${listId}/pack`)

    const aside = screen.getByTestId('list-side-panel')
    expect(aside.className).toContain('xl:flex')
    expect(aside.className).not.toContain('lg:flex')
  })

  it('keeps Category view on the lg gate it already had', async () => {
    stubViewport(1280)
    await renderDetail(`/lists/${listId}`)

    const aside = screen.getByTestId('list-side-panel')
    expect(aside.className).toContain('lg:flex')
    expect(aside.className).not.toContain('xl:flex')
  })

  // max-w-3xl is unprefixed, so it governs paper as well as screen. Screen
  // gets the width back now the aside fills it; print keeps the 768px measure
  // the checklist was designed around.
  it('constrains the Pack document for print only', async () => {
    stubViewport(1280)
    await renderDetail(`/lists/${listId}/pack`)

    const column = screen.getByTestId('list-document-column')
    expect(column.className).toContain('print:max-w-3xl')
    expect(column.className).not.toMatch(/(^|\s)max-w-3xl(\s|$)/)
  })

  // Nobody switches lists mid-pack, and the switcher's max-h-72 is height the
  // picker wants back.
  it('drops the lists switcher in Pack but keeps it in Category', async () => {
    stubViewport(1280)
    await renderDetail(`/lists/${listId}/pack`)
    expect(listsPanel()).toBeNull()

    cleanup()
    await renderDetail(`/lists/${listId}`)
    expect(listsPanel()).toBeTruthy()
  })
})
