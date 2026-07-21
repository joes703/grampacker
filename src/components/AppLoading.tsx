type Props = {
  label?: string
  fullScreen?: boolean
}

// Stable cold-load surface shared by the session gate and route-level lazy
// boundaries. It is intentionally dependency-free so anonymous share visitors
// do not cross the authenticated bundle boundary just to see loading feedback.
export default function AppLoading({
  label = 'Loading grampacker...',
  fullScreen = false,
}: Props) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-live="polite"
      aria-busy="true"
      className={`flex items-center justify-center bg-gray-50 px-4 text-sm text-gray-500 ${
        fullScreen ? 'min-h-screen' : 'min-h-48'
      }`}
    >
      <span className="font-semibold text-gray-700">grampacker</span>
      <span className="ml-2">{fullScreen ? 'Loading...' : label}</span>
    </div>
  )
}
