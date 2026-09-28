import { useEffect, useState } from 'react'

/**
 * Captures Chromium's `beforeinstallprompt` so the app can offer a one-tap PWA
 * install (Android/desktop Chrome/Edge). The event fires once, early, and only
 * when the app is installable (manifest + active service worker over HTTPS) — so
 * we listen at module load, stash it, and replay it on demand.
 *
 * Note: in dev the Workbox SW is disabled, so this never fires there — it's a
 * production-only capability (same constraint as push).
 */

interface BeforeInstallPromptEvent extends Event {
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt(): Promise<void>
}

let deferred: BeforeInstallPromptEvent | null = null
const subscribers = new Set<() => void>()
let initialized = false

function notify() {
  for (const fn of subscribers) fn()
}

function init() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  window.addEventListener('beforeinstallprompt', (e) => {
    // Stop Chrome's default mini-infobar; we surface our own banner instead.
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}
init()

/**
 * Android/Chromium one-tap install. `canInstall` is true once the browser has
 * offered a deferred prompt; `promptInstall()` replays it and resolves to true
 * if the user accepted. The prompt is single-use — it's consumed after one call.
 */
export function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState(deferred !== null)

  useEffect(() => {
    const update = () => setCanInstall(deferred !== null)
    subscribers.add(update)
    update()
    return () => {
      subscribers.delete(update)
    }
  }, [])

  const promptInstall = async (): Promise<boolean> => {
    if (!deferred) return false
    await deferred.prompt()
    const choice = await deferred.userChoice
    deferred = null
    notify()
    return choice.outcome === 'accepted'
  }

  return { canInstall, promptInstall }
}
