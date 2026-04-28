import aboutContent from '../../about.md?raw'
import MarkdownPage from '../components/MarkdownPage'

export default function AboutPage() {
  return <MarkdownPage content={aboutContent} />
}
