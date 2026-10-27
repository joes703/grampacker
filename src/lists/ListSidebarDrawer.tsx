import Modal from '../components/Modal'
import { FLAT_TABLE_SURFACE } from '../components/flat-table-styles'

// The left-anchored gear drawer on the list page. It is a Modal so that a
// toast raised while it is open (a failed add or remove) is shown inside it,
// not behind it.
type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  title: string
  children: React.ReactNode
}

export default function ListSidebarDrawer({ open, onOpenChange, title, children }: Props) {
  return (
    <Modal open={open} onClose={() => onOpenChange(false)} title={title} header placement="left">
      <div className="flex-1 min-h-0 flex flex-col p-4 overflow-hidden">
        <div className={`flex flex-col min-h-0 flex-1 ${FLAT_TABLE_SURFACE}`}>
          <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
        </div>
      </div>
    </Modal>
  )
}
