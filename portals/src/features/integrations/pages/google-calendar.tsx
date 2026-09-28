import { useState } from 'react'
import { GoogleAuthMethodSelector } from '@/features/integrations/components/google-auth-method-selector'
import { GoogleCalendarConfigCard } from '@/features/integrations/components/google-calendar-config-card'
import { CalendarSharesCard } from '@/features/integrations/components/google-calendar-shares-card'
import { GoogleContactsConfigCard } from '@/features/integrations/components/google-contacts-config-card'
import { GoogleOAuthCredentialsCard } from '@/features/integrations/components/google-oauth-credentials-card'
import { GoogleServiceAccountCard } from '@/features/integrations/components/google-service-account-card'
import { PerDoctorCalendarsCard } from '@/features/integrations/components/per-doctor-calendars-card'
import { getActiveAuthMethod } from '@/lib/actions/google-calendar'
import { useApiQuery } from '@/lib/query'

// NOTE: this key literal is duplicated (deliberately — see query.ts docs on
// local module-scoped keys) in `components/google-auth-method-selector.tsx`,
// which reads the same `/api/google-calendar/auth-method` endpoint. Keep the
// two in sync so both observers share one cache entry — the selector's own
// toggle then keeps this page's gating in sync for free.
const AUTH_METHOD_KEY = ['integrations', 'google-calendar', 'auth-method'] as const

export default function GoogleCalendarConfigPage() {
  // Bump on any cross-card change so siblings (especially the per-user connect
  // card) refetch their status.
  const [reloadKey, setReloadKey] = useState(0)

  // Page-level fetch so we know which sections to render before the children
  // mount — avoids a flash of the OAuth connect card when SA is active.
  // Shares its cache entry with GoogleAuthMethodSelector's own query, so a
  // successful toggle there updates this gating without an extra round trip.
  const authMethodQuery = useApiQuery(AUTH_METHOD_KEY, getActiveAuthMethod)
  const activeMethod = authMethodQuery.data
    ? authMethodQuery.data.method
    : authMethodQuery.isError
      ? 'oauth'
      : null

  const bump = () => setReloadKey((k) => k + 1)

  return (
    <div className="p-6 space-y-4">
      <GoogleAuthMethodSelector onChange={() => bump()} />

      {/* Both credential cards are always visible — admin can toggle which
          one drives event sync via the selector above. The inactive card
          renders dimmed with an "Inactive" note. */}
      <GoogleOAuthCredentialsCard isActive={activeMethod === 'oauth'} onSaved={bump} />
      <GoogleServiceAccountCard isActive={activeMethod === 'service_account'} onSaved={bump} />

      {/* Calendar sharing only matters in SA mode — the workaround for no DWD. */}
      <CalendarSharesCard visible={activeMethod === 'service_account'} />

      {/* Per-doctor calendar audit — confirms each doctor has their own
          isolated calendar instead of all events landing on the SA fallback. */}
      <PerDoctorCalendarsCard visible={activeMethod === 'service_account'} />

      {/* Per-user connect card only matters when OAuth is the active method. */}
      {activeMethod === 'oauth' && <GoogleCalendarConfigCard key={reloadKey} />}

      {/* Google Contacts (§21.4) reuses the same OAuth client/credentials, so it
          only applies in OAuth mode. Push patient contacts → your Google account. */}
      {activeMethod === 'oauth' && <GoogleContactsConfigCard key={`contacts-${reloadKey}`} />}
    </div>
  )
}
