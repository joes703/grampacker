import { Link } from 'react-router'

// Published on the privacy page and in the footer. It is a forwarding
// address, not a personal one.
export const CONTACT_EMAIL = 'hello@grampacker.app'

const FOOTER_LINK = 'hover:text-gray-700 hover:underline'

// The footer of the signed-out pages: the sign-in page, where the link
// lands, and the privacy page.
export default function SiteFooter() {
  return (
    <footer className="mt-10 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-500">
      <Link to="/privacy" className={FOOTER_LINK}>
        Privacy
      </Link>
      <a href={`mailto:${CONTACT_EMAIL}`} className={FOOTER_LINK}>
        {CONTACT_EMAIL}
      </a>
      <span>© 2026 grampacker</span>
    </footer>
  )
}
