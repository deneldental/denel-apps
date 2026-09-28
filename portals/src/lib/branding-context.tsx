// Branding context — fetched once on app mount, cached, and exposed via the
// `useBranding()` hook. The default value seeds from env vars so the very
// first render before the API call resolves matches today's behavior; once
// the fetch returns, all consumers re-render with the live values.
//
// Backend single source of truth lives at GET /api/integrations/branding,
// which itself layers integration_branding KV → clinic_info KV → env →
// literal default.

import { createContext, type ReactNode, useContext, useEffect } from 'react'
import { type BrandingConfig, getBranding } from '@/lib/actions/branding'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'

const DEFAULT_BRANDING: BrandingConfig = {
  name: import.meta.env.VITE_CLINIC_NAME || 'Denel Dental Clinic',
  shortName: 'Denel',
  logoUrl: null,
  faviconUrl: null,
  logoIconUrl: null,
  logoHorizontalUrl: null,
  portalLoginImageUrl: null,
  portalLoginImageUrls: [],
  portalLoginImagePosition: 'center center',
  pwaLoginImageUrl: null,
  pwaLoginImagePosition: 'center center',
  accentColor: '#B8873A',
  smsSenderId: 'Denel',
  emailFromName: 'Denel Dental',
  emailFromAddress: 'info@deneldental.com',
  phones: import.meta.env.VITE_CLINIC_PHONE ? [import.meta.env.VITE_CLINIC_PHONE] : [],
  email: null,
  address: import.meta.env.VITE_CLINIC_ADDRESS || null,
  website: null,
  copyrightHolder: import.meta.env.VITE_CLINIC_NAME || 'Denel Dental Clinic',
  themeColor: '#24296a',
  social: {},
}

const BrandingContext = createContext<BrandingConfig>(DEFAULT_BRANDING)

export function BrandingProvider({ children }: { children: ReactNode }) {
  const brandingQuery = useApiQuery(queryKeys.settings.branding(), () => getBranding(), {
    // Branding is effectively static reference data — avoid refetch storms
    // while still eventually picking up a change made in Settings.
    staleTime: 5 * 60_000,
  })
  // Merge rather than replace: signed-out pages get the public subset, which
  // omits fields like shortName and smsSenderId that the rest of the app reads.
  const branding = brandingQuery.data
    ? { ...DEFAULT_BRANDING, ...brandingQuery.data }
    : DEFAULT_BRANDING

  useEffect(() => {
    if (brandingQuery.error) {
      console.warn('[BrandingProvider] Failed to fetch branding:', brandingQuery.error)
    }
  }, [brandingQuery.error])

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>
}

/** Read the live branding config. Falls back to env-derived defaults until the
 * initial fetch resolves. Components that just need clinic name should call
 * this hook instead of reading `import.meta.env.VITE_CLINIC_NAME` directly. */
export function useBranding(): BrandingConfig {
  return useContext(BrandingContext)
}
