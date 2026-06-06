// Public share-view banner shown when the shared list is a draft (is_draft).
// Sets reviewer expectations: the list is incomplete, expect gaps. Deliberately
// does NOT say "hold off judging" - a shared draft is usually a shakedown, where
// feedback is wanted (design spec, "completeness not feedback-readiness").
export default function DraftBanner() {
  return (
    <div role="status" className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-900">Work in progress</p>
      <p className="mt-0.5 text-sm text-amber-800">
        This list is still being built and may be incomplete.
      </p>
    </div>
  )
}
