import { adminClient, inferAdditionalFields } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/**
 * Better Auth client for the portal. Email + password only — no OTP step.
 * PWA's device-trust OTP layer is implemented separately and never reaches
 * portal code paths.
 */
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_BETTER_AUTH_URL,
  fetchOptions: { headers: { 'X-App-Id': 'portal' } },
  plugins: [
    adminClient(),
    // Declare the same additionalFields as the backend so the client
    // properly types and receives roleId and phone in the session user object.
    inferAdditionalFields({
      user: {
        roleId: {
          type: 'string',
          required: false,
        },
        phone: {
          type: 'string',
          required: false,
        },
        // F20 / D8 — an administrator set this person's password; they must choose their
        // own before anything else (see DashboardLayout and the change-password page).
        mustChangePassword: {
          type: 'boolean',
          required: false,
        },
      },
    }),
  ],
})
