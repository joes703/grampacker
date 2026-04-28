import helpContent from '../../help.md?raw'
import MarkdownPage from '../components/MarkdownPage'
import { useDocumentTitle } from '../lib/use-document-title'

export default function HelpPage() {
  useDocumentTitle('Help')
  return <MarkdownPage content={helpContent} />
}
