/**
 * Push-notification client helpers for the staff PWA.
 *
 * Wired to `/api/push/{subscribe,unsubscribe}` — the browser's PushSubscription
 * is registered server-side in `push_subscriptions`, then `/api/push/send`
 * delivers via the `web-push` library using the VAPID keypair.
 *
 * Browser-API contract (per Wave 1E §9.2.A):
 * - Permission is requested only on user gesture (Profile → "Enable notifications").
 * - VAPID public key is fetched from the backend at runtime
 *   (GET /api/push/vapid-public-key) — no build-time key needed.
 * - iOS 16.4+ requires the PWA to be added to Home Screen first; surface that
 *   caveat in the onboarding flow, not here.
 */

import { api } from '@/lib/api'

export type PushPermissionState = 'default' | 'granted' | 'denied' | 'unsupported'

let cachedVapidKey: string | null = null
/** Fetch (and cache) the VAPID public key from the backend at runtime. It's the
 *  public half of the keypair, served openly at GET /api/push/vapid-public-key. */
async function getVapidPublicKey(): Promise<string | null> {
  if (cachedVapidKey) return cachedVapidKey
  const res = await api.get<{ publicKey: string }>('/api/push/vapid-public-key', {
    suppressSessionExpiredHook: true,
  })
  const key = (res.data as { publicKey?: string } | undefined)?.publicKey
  if (res.success && key) cachedVapidKey = key
  return cachedVapidKey
}

/** Pure check for browser support — Notification + Service Worker + Push APIs all required. */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  )
}

/** Current permission. Returns 'unsupported' if APIs missing. */
export function getPushPermission(): PushPermissionState {
  if (!isPushSupported()) return 'unsupported'
  return Notification.permission as PushPermissionState
}

/**
 * Resolve a push-capable service-worker registration.
 *
 * - Production: the Workbox SW (which `importScripts('push-sw.js')`) is already
 *   registered, so we wait for it to become ready.
 * - Dev / preview where the Workbox SW is disabled (`devOptions.enabled:false`):
 *   `navigator.serviceWorker.ready` would hang forever, so we register the
 *   self-contained `/push-sw.js` directly. It has only `push` + `notificationclick`
 *   handlers (no `fetch`), so it adds push support without touching caching/HMR.
 *
 * Never hangs: the wait for activation is capped.
 */
async function getPushRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration()
  if (!existing) {
    // No SW controls this scope (dev, or first run). Register the standalone
    // push worker so we have an active SW to subscribe through.
    await navigator.serviceWorker.register('/push-sw.js')
  }
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<ServiceWorkerRegistration>((_, reject) =>
      setTimeout(
        () => reject(new Error('The notification service did not start. Please reload and retry.')),
        10_000
      )
    ),
  ])
}

/**
 * Request notification permission AND subscribe to push.
 * - Throws if !isPushSupported().
 * - Throws if VAPID key missing.
 * - Returns the PushSubscription on success.
 * - On permission denied returns null.
 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!isPushSupported()) {
    throw new Error('Push notifications not supported in this browser')
  }

  // Fetch the VAPID public key from the backend at runtime (no build-time env
  // dependency). Returns null if push isn't configured server-side.
  const vapidKey = await getVapidPublicKey()
  if (!vapidKey) {
    throw new Error('Push notifications are not configured')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return null
  }

  const registration = await getPushRegistration()
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
  })

  // Register the subscription server-side. `suppressSessionExpiredHook` keeps
  // a stale session from redirecting the Profile screen mid-toggle.
  const json = subscription.toJSON() as {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  }
  await api.post(
    '/api/push/subscribe',
    {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      userAgent: navigator.userAgent,
    },
    { suppressSessionExpiredHook: true }
  )

  return subscription
}

/** Unsubscribe locally and on the server. */
export async function unsubscribeFromPush(): Promise<boolean> {
  const subscription = await getCurrentSubscription()
  if (!subscription) return false

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()

  await api.delete('/api/push/unsubscribe', {
    body: { endpoint },
    suppressSessionExpiredHook: true,
  })

  return true
}

/** Returns the current PushSubscription if any (null otherwise). Uses
 *  getRegistration() (not `.ready`) so it resolves to null instead of hanging
 *  when no service worker is registered (e.g. dev with the Workbox SW off). */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return null
  return registration.pushManager.getSubscription()
}

/** Helper — convert a base64 VAPID key to Uint8Array as required by pushManager.subscribe. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const out = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i)
  return out
}

/**
 * Fire a local notification to verify display, without a real push server. Used
 * by the dev-only "Send test notification" button.
 *
 * Goes through `ServiceWorkerRegistration.showNotification()` — the SAME API
 * real pushes use (`push-sw.js`). The `new Notification()` constructor is NOT
 * allowed on Android/PWA contexts (throws "Illegal constructor") and is flaky
 * when a SW controls the page, which is why no notification appeared. We fall
 * back to the constructor only when there's genuinely no service worker.
 *
 * Returns false if permission isn't granted or display fails.
 */
export async function sendTestNotification(payload: {
  title: string
  body?: string
  icon?: string
  tag?: string
}): Promise<boolean> {
  if (getPushPermission() !== 'granted') return false
  const options: NotificationOptions = {
    body: payload.body,
    icon: payload.icon ?? '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag,
  }
  try {
    // Prefer the SW path (works on desktop + mobile). Register the standalone
    // push worker first if nothing is active yet (dev with the Workbox SW off).
    const registration =
      (await navigator.serviceWorker?.getRegistration()) ?? (await getPushRegistration())
    if (registration) {
      await registration.showNotification(payload.title, options)
      return true
    }
  } catch {
    // Fall through to the constructor fallback below.
  }
  try {
    new Notification(payload.title, options)
    return true
  } catch {
    return false
  }
}
