import helpContent from '../../help.md?raw'
import MarkdownPage from '../components/MarkdownPage'

export default function HelpPage() {
  return <MarkdownPage content={helpContent} />
}
