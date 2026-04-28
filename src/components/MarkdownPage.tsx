import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Element-level styling for rendered markdown. Matches the rest of the app's
// typography (text-xl font-semibold for h1, text-base font-semibold for h2,
// text-sm text-gray-700 for body) so help/about pages don't introduce a new
// type system. Kept as a const so any future markdown page renders identically.
const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-4 text-xl font-semibold text-gray-900">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-8 mb-2 text-base font-semibold text-gray-900">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-5 mb-2 text-sm font-semibold text-gray-700">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mb-3 text-sm text-gray-700 leading-relaxed">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 ml-6 list-disc space-y-1 text-sm text-gray-700">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 ml-6 list-decimal space-y-1 text-sm text-gray-700">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ href, children }) => (
    <a href={href} className="text-blue-600 hover:underline">
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono text-gray-800">
      {children}
    </code>
  ),
  hr: () => <hr className="my-6 border-gray-200" />,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-gray-300 pl-4 text-sm italic text-gray-600">
      {children}
    </blockquote>
  ),
}

export default function MarkdownPage({ content }: { content: string }) {
  return (
    <article className="mx-auto max-w-2xl">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </article>
  )
}
