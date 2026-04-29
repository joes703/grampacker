import { Link } from 'react-router'
import aboutContent from '../../about.md?raw'
import MarkdownPage from '../components/MarkdownPage'
import { useDocumentTitle } from '../lib/use-document-title'
import { useAuth } from '../auth/AuthProvider'

export default function AboutPage() {
  useDocumentTitle('About')
  const { session, loading } = useAuth()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center px-4">
          <Link to="/" className="text-lg font-bold text-gray-900 hover:text-gray-700">
            grampacker
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {!loading && session && (
              <Link
                to="/lists"
                className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
              >
                Back to app
              </Link>
            )}
            {!loading && !session && (
              <>
                <Link
                  to="/login"
                  className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                >
                  Sign in
                </Link>
                <Link
                  to="/register"
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Create account
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 pt-4 lg:pt-8 pb-8">
        <MarkdownPage content={aboutContent} />
      </main>
    </div>
  )
}