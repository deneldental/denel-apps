import { api } from '@/lib/api-client'

export type BrandingConfig = {
  name: string
  shortName: string
  logoUrl: string | null
  faviconUrl: string | null
  logoIconUrl: string | null
  logoHorizontalUrl: string | null
  portalLoginImageUrl: string | null
  /** Login panel photos in order; the panel cross-fades through them. */
  portalLoginImageUrls: string[]
  portalLoginImagePosition: string
  pwaLoginImageUrl: string | null
  pwaLoginImagePosition: string
  accentColor: string
  smsSenderId: string
  emailFromName: string
  emailFromAddress: string
  phones: string[]
  email: string | null
  address: string | null
  website: string | null
  copyrightHolder: string
  themeColor: string
  social: {
    facebook?: string
    instagram?: string
    tiktok?: string
    youtube?: string
    linkedin?: string
    snapchat?: string
  }
}

/**
 * Branding for the whole app.
 *
 * The full config is session-guarded, which the auth screens cannot satisfy —
 * they render signed out. Fall back to the public subset there so the login
 * panel still gets the clinic's own photos, logo and colours instead of the
 * built-in defaults. `suppressSessionExpired` keeps that expected 401 from
 * firing the global session-expired handler on the login page itself.
 */
export async function getBranding() {
  const full = await api.get<BrandingConfig>('/api/integrations/branding', {
    suppressSessionExpired: true,
  })
  if (full.success) return full
  return api.get<BrandingConfig>('/api/integrations/branding/public')
}

export const saveBranding = (payload: Partial<BrandingConfig>) =>
  api.put('/api/integrations/branding', payload)

export type BrandingUploadKind =
  | 'logo'
  | 'favicon'
  | 'logo-icon'
  | 'logo-horizontal'
  | 'portal-login-image'
  | 'pwa-login-image'

/** Multipart upload of a branding asset. Returns the public URL on success. */
export async function uploadBrandingFile(file: File, kind: BrandingUploadKind) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('kind', kind)
  return api.post<{ url: string; kind: BrandingUploadKind }>(
    '/api/integrations/branding/logo',
    fd,
    {}
  )
}
