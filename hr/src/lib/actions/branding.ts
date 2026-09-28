// Clinic branding — name, logo, contact, theme colour. Backed by the
// `integration_branding` KV on the backend and exposed publicly for display
// surfaces (login pages, payslips, etc.). Used here to brand the payslip layout.

import { api } from '@/lib/api-client'

export interface PublicBranding {
  name: string
  logoUrl: string | null
  logoIconUrl: string | null
  logoHorizontalUrl: string | null
  themeColor: string
  accentColor: string
  phones: string[]
  email: string | null
  address: string | null
}

export function getPublicBranding() {
  return api.get<PublicBranding>('/api/integrations/branding/public')
}
