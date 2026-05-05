import { Suspense, lazy } from 'react'
import helpContent from '../../help.md?raw'
import { useDocumentTitle } from '../lib/use-document-title'

const MarkdownPage = lazy(() => import('../components/MarkdownPage'))

export default function HelpPage() {
  useDocumentTitle('Help')
  return (
    <Suspense fallback={null}>
      <MarkdownPage content={helpContent} />
    </Suspense>
  )
}
