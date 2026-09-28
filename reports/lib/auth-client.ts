import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  baseURL:
    import.meta.env.VITE_API_URL || import.meta.env.VITE_BETTER_AUTH_URL || 'http://localhost:8788',
  fetchOptions: { headers: { 'X-App-Id': 'reports' } },
})
