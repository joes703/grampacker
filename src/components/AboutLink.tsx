import { Suspense, lazy, useState } from 'react'
import Modal from './Modal'
import aboutContent from '../../about.md?raw'

// MarkdownPage carries the entire react-markdown + remark-gfm chunk (~46 KB
// gzip). Lazy so it only downloads when a visitor actually opens the
// About modal — login and share-view cold-loads stay lean.
const MarkdownPage = lazy(() => import('./MarkdownPage'))

type Props = {
  /** Classes applied to the trigger button (positioning, color, size). */
  className?: string
}

// Public/signed-out-safe: renders a small text button that opens an About
// modal showing about.md verbatim. Used on LoginPage (below the auth card)
// and SharePage (footer of /r/<slug>) — both paths must work without a
// session, so this component touches no auth state.
export default function AboutLink({ className }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
      >
        About grampacker
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="About grampacker"
        className="w-full max-w-lg"
      >
        <div className="max-h-[80vh] overflow-y-auto px-6 pb-6 pt-2">
          <Suspense fallback={null}>
            <MarkdownPage content={aboutContent} />
          </Suspense>
        </div>
      </Modal>
    </>
  )
}
