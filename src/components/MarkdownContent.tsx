// SAFETY: Renders user-supplied markdown (e.g. shared list notes). Do NOT
// add rehype-raw here and do NOT pass rehypePlugins that allow raw HTML —
// react-markdown's default behavior is to ignore raw HTML in input, which
// is what keeps this component XSS-safe for untrusted authored content.
// External URLs are still sanitized by react-markdown's default
// urlTransform (javascript:/data: blocked).
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Compact element styling for inline markdown surfaces (notes cards,
// description blocks). Tighter spacing than MarkdownPage's page-shaped
// renderer; intended to live inside a card the parent has already padded.
// Headings step down a tier from MarkdownPage so they don't compete with
// the surrounding page chrome (list title, panel header).
const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-3 mb-2 text-base font-semibold text-gray-900">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3 mb-1.5 text-sm font-semibold text-gray-900">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-2 mb-1 text-sm font-semibold text-gray-700">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mb-2 text-sm text-gray-700 leading-relaxed">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-2 ml-5 list-disc space-y-0.5 text-sm text-gray-700">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 ml-5 list-decimal space-y-0.5 text-sm text-gray-700">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ href, children }) => {
    const isExternal = typeof href === 'string' && /^https?:\/\//i.test(href)
    return (
      <a
        href={href}
        className="text-blue-600 hover:underline"
        {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {children}
      </a>
    )
  },
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono text-gray-800">
      {children}
    </code>
  ),
  hr: () => <hr className="my-3 border-gray-200" />,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-gray-300 pl-3 text-sm italic text-gray-600">
      {children}
    </blockquote>
  ),
}

// `[&>:first-child]:mt-0` collapses the leading margin from the first
// rendered child so the content hugs the card's top padding instead of
// stacking against the parent's own padding.
export default function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="[&>:first-child]:mt-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
