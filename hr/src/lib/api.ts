/**
 * HR-app API client. Built from `@denel/app-kit`'s `createApiClient`, bound to
 * the backend URL and `X-App-Id: hr`, with the HR error reporter wired in for
 * timeout / network telemetry. Feature code imports `{ api }` from here.
 */
import { createApiClient } from '@denel/app-kit'
import { reportError } from '@/shared/lib/error-reporting'

export const api = createApiClient({
  apiUrl: import.meta.env.VITE_API_URL,
  appId: 'hr',
  reportError,
})
