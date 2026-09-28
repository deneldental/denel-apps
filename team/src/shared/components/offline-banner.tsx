import { WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Thin amber bar that surfaces when the browser reports `navigator.onLine`
 * is false. Mounted once at the app root so it overlays every page.
 *
 * Note: navigator.onLine is reliable in practice — when it flips false the
 * device truly can't reach anything. False negatives (online flag stays true
 * while connectivity is dead) are caught by the API client's timeout +
 * Sentry capture; we don't try to second-guess the browser here.
 */
export function OfflineBanner() {
  // SSR-safe initial — assume online so we don't flash the banner during hydration.
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  )

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (online) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-xs font-medium text-amber-950 shadow-sm"
    >
      <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
      <span>You're offline — changes won't sync until you reconnect.</span>
    </div>
  )
}
