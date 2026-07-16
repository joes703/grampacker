import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_META_TEXT,
} from '../components/flat-table-styles'

// Empty-state cell for the library panel's pickers - shown when search produces
// zero matches or when the user has nothing to pick yet. Wording explains where
// the thing lives instead of offering to create it here, and there is
// deliberately NO nav link: the desktop primary nav and the mobile bottom bar
// both already surface the Gear and Food destinations.
//
// Shared by the Gear and Food sides of the toggle so the two halves of one panel
// cannot drift into different empty-state shapes.
export default function PickerEmptyState({
  heading,
  body,
}: {
  heading: string
  // Optional: a transient state (loading) has a heading and nothing useful to
  // add under it, and an empty <p> would still take its margin.
  body?: string
}) {
  return (
    <div className={`p-4 text-center ${FLAT_TABLE_BODY_TEXT} text-gray-500`}>
      <p className="font-medium text-gray-700">{heading}</p>
      {body && <p className={`mt-1 ${FLAT_TABLE_META_TEXT} text-gray-500`}>{body}</p>}
    </div>
  )
}
