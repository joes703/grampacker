// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Outlet, useParams } from 'react-router'
import { MAGIC_LINK_PATH } from '../shared/auth'
import { AppRoutes } from './App'

// Splitting the bundle moved every authenticated path from a flat route list
// onto RELATIVE paths inside a lazy chunk, under a "/*" splat. Nothing tested
// routing before, so that rewrite could have broken /lists/:id/pack (or the
// index route, or the catch-all) and still shipped green.
//
// So this drives the REAL route tables - App's and AuthenticatedApp's, both
// unmocked - through a real MemoryRouter, and mocks only the leaf pages, which
// this change does not touch. A test that mocked the router or the route table
// would only assert that I believe my own routes work.
const h = vi.hoisted(() => ({ useSession: vi.fn() }))

vi.mock('./lib/auth-client', () => ({
  authClient: { useSession: h.useSession },
  passkeysSupported: () => false,
}))

// AppShell is a LAYOUT route: if it fails to render an Outlet, every page under
// it silently disappears, so the stub keeps the Outlet and nothing else.
vi.mock('./layout/AppShell', () => ({
  default: () => (
    <div data-testid="shell">
      <Outlet />
    </div>
  ),
}))
vi.mock('./layout/RootRedirect', () => ({ default: () => <div data-testid="root-redirect" /> }))
vi.mock('./gear/GearLibraryPage', () => ({ default: () => <div data-testid="gear" /> }))
vi.mock('./settings/SettingsPage', () => ({ default: () => <div data-testid="settings" /> }))
vi.mock('./lists/ListsPage', () => ({ default: () => <div data-testid="lists" /> }))
vi.mock('./lists/ListDetailPage', () => ({
  default: function ListDetailStub() {
    return <div data-testid="detail">{useParams().id}</div>
  },
}))
vi.mock('./lists/SharePage', () => ({
  default: function ShareStub() {
    return <div data-testid="share">{useParams().slug}</div>
  },
}))
vi.mock('./auth/SignInPage', () => ({ default: () => <div data-testid="sign-in" /> }))
vi.mock('./auth/MagicLinkPage', () => ({ default: () => <div data-testid="magic-link" /> }))

const SIGNED_IN = { data: { user: { id: 'u1' } }, isPending: false }
const SIGNED_OUT = { data: null, isPending: false }
const PENDING = { data: null, isPending: true }

function renderAt(path: string, session: unknown) {
  h.useSession.mockReturnValue(session)
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the authenticated area (lazy chunk, relative paths under the splat)', () => {
  // findBy*, not getBy*: these paths now resolve through a lazy import and a
  // Suspense boundary, so the first paint is the null fallback.
  it.each([
    ['/', 'root-redirect'],
    ['/gear', 'gear'],
    ['/settings', 'settings'],
    ['/lists', 'lists'],
  ])('renders %s inside the shell', async (path, testId) => {
    renderAt(path, SIGNED_IN)
    expect(await screen.findByTestId(testId)).toBeInTheDocument()
    expect(screen.getByTestId('shell')).toBeInTheDocument()
  })

  // The two most breakable paths in the rewrite: a nested route with a param,
  // and one with a param AND a trailing segment. Both are relative now
  // ("lists/:id/pack"), matched against the splat's remainder.
  it('renders a list detail page and passes the id through', async () => {
    renderAt('/lists/abc123', SIGNED_IN)
    expect(await screen.findByTestId('detail')).toHaveTextContent('abc123')
  })

  it('renders pack mode as a segment of the same detail page', async () => {
    renderAt('/lists/abc123/pack', SIGNED_IN)
    expect(await screen.findByTestId('detail')).toHaveTextContent('abc123')
  })

  it('renders organize mode as a peer segment of the same detail page', async () => {
    renderAt('/lists/abc123/organize', SIGNED_IN)
    expect(await screen.findByTestId('detail')).toHaveTextContent('abc123')
  })

  it('sends an unknown path home rather than to a dead end', async () => {
    renderAt('/no/such/page', SIGNED_IN)
    expect(await screen.findByTestId('root-redirect')).toBeInTheDocument()
  })
})

describe('the session gate', () => {
  it('sends a signed-out visitor to sign-in, and does NOT render the app', async () => {
    renderAt('/', SIGNED_OUT)
    expect(await screen.findByTestId('sign-in')).toBeInTheDocument()
    // The point of the split: no shell means the authenticated chunk never
    // rendered for someone who cannot use it.
    expect(screen.queryByTestId('shell')).not.toBeInTheDocument()
  })

  it('renders nothing while the session is still pending', () => {
    const { container } = renderAt('/', PENDING)
    // Deliberately not a redirect: bouncing a pending session to /sign-in would
    // flash the form at every already-signed-in user on every cold load.
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps a signed-in user off the sign-in form', async () => {
    renderAt('/sign-in', SIGNED_IN)
    expect(await screen.findByTestId('root-redirect')).toBeInTheDocument()
    expect(screen.queryByTestId('sign-in')).not.toBeInTheDocument()
  })
})

describe('the public paths', () => {
  it('serves a share link to a signed-out visitor, with no app chrome', async () => {
    renderAt('/r/my-kit', SIGNED_OUT)
    expect(await screen.findByTestId('share')).toHaveTextContent('my-kit')
    expect(screen.queryByTestId('shell')).not.toBeInTheDocument()
  })

  it('serves the same public view to a signed-in visitor', async () => {
    renderAt('/r/my-kit', SIGNED_IN)
    expect(await screen.findByTestId('share')).toHaveTextContent('my-kit')
    expect(screen.queryByTestId('shell')).not.toBeInTheDocument()
  })

  it('still redirects the retired /sign-up to /sign-in', async () => {
    renderAt('/sign-up', SIGNED_OUT)
    expect(await screen.findByTestId('sign-in')).toBeInTheDocument()
  })

  it('renders the magic-link page even for a signed-in user', async () => {
    // Not wrapped in RedirectIfSession on purpose: someone already signed in on
    // this device may be redeeming a link to switch accounts, and bouncing them
    // home would silently burn the token they just clicked.
    renderAt(MAGIC_LINK_PATH, SIGNED_IN)
    expect(await screen.findByTestId('magic-link')).toBeInTheDocument()
  })

  // A splat route is the one shape that can silently swallow its siblings if
  // react-router ever ranked by source order instead of specificity. It does
  // not - and this is what would catch it if that ever changed.
  it('does not let the "/*" splat shadow the static public paths', async () => {
    renderAt('/sign-in', SIGNED_OUT)
    expect(await screen.findByTestId('sign-in')).toBeInTheDocument()
    expect(screen.queryByTestId('shell')).not.toBeInTheDocument()
  })
})
