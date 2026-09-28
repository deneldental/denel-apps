import { useRegisterSW } from 'virtual:pwa-register/react'
import { useEffect } from 'react'
import { toast } from 'sonner'

/**
 * Registers the service worker and surfaces a toast when a new version is
 * waiting to activate. User must explicitly tap "Reload" — we don't
 * skip-waiting silently. This avoids the case where an unexpected SW
 * activation drops a mid-quiz user.
 *
 * Mount once at the app root.
 */
export function SWUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      // eslint-disable-next-line no-console
      console.error('[sw] registration failed:', error)
    },
  })

  useEffect(() => {
    if (!needRefresh) return
    toast('A new version is available', {
      description: 'Reload to get the latest features and fixes.',
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: 'Reload',
        onClick: () => {
          // updateServiceWorker(true) calls skipWaiting + reload — the user
          // explicitly chose this so the mid-flow concern doesn't apply.
          void updateServiceWorker(true)
        },
      },
      onDismiss: () => setNeedRefresh(false),
    })
  }, [needRefresh, setNeedRefresh, updateServiceWorker])

  return null
}
