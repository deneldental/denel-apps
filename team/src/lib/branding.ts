import { useEffect, useState } from 'react'
import { env } from '@/config/env'

export type PublicBranding = {
  name: string
  logoIconUrl: string | null
  logoHorizontalUrl: string | null
  logoUrl: string | null
  portalLoginImageUrl: string | null
  portalLoginImagePosition: string
  pwaLoginImageUrl: string | null
  pwaLoginImagePosition: string
  themeColor: string
  accentColor: string
}

const DEFAULT_BRANDING: PublicBranding = {
  name: import.meta.env.VITE_CLINIC_NAME || 'Denel Dental Clinic',
  logoIconUrl: null,
  logoHorizontalUrl: null,
  logoUrl: null,
  portalLoginImageUrl: null,
  portalLoginImagePosition: 'center center',
  pwaLoginImageUrl: null,
  pwaLoginImagePosition: 'center center',
  themeColor: '#24296a',
  accentColor: '#B8873A',
}

let cached: PublicBranding | null = null
let promise: Promise<PublicBranding> | null = null

function fetchBranding(): Promise<PublicBranding> {
  if (cached) return Promise.resolve(cached)
  if (!promise) {
    // Public endpoint — no auth needed, but include X-App-Id to match the
    // pattern every other API call uses (so backend rate-limiting / audit
    // logs see this request as coming from the PWA, not anonymous).
    promise = fetch(`${env.VITE_API_URL}/api/integrations/branding/public`, {
      headers: { 'X-App-Id': 'pwa' },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((json) => {
        cached = { ...DEFAULT_BRANDING, ...(json.data ?? {}) }
        return cached!
      })
      .catch(() => {
        promise = null
        return DEFAULT_BRANDING
      })
  }
  return promise
}

export function useBranding(): PublicBranding {
  const [branding, setBranding] = useState<PublicBranding>(cached ?? DEFAULT_BRANDING)

  useEffect(() => {
    let mounted = true
    fetchBranding().then((b) => {
      if (mounted) setBranding(b)
    })
    return () => {
      mounted = false
    }
  }, [])

  return branding
}
