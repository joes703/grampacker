import aboutContent from '../../about.md?raw'
import MarkdownPage from '../components/MarkdownPage'
import { useDocumentTitle } from '../lib/use-document-title'

export default function AboutPage() {
  useDocumentTitle('About')
  return <MarkdownPage content={aboutContent} />
}
