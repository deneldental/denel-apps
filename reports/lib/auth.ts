import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import { db } from './db' // Adjust path if needed

import * as schema from './db/schema'
import { sendEmail } from './email'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }, _request) => {
      if (process.env.RESEND_API_KEY) {
        const { success, error } = await sendEmail({
          to: user.email,
          subject: 'Reset your password',
          html: `<p>Use this link to reset your password: <a href="${url}">${url}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
        })
        if (!success) {
          console.error('[Password reset] Failed to send email:', error?.message)
        }
      } else {
        console.log('[Password reset] RESEND_API_KEY not set; link for', user.email, ':', url)
      }
    },
    onPasswordReset: async ({ user }, _request) => {
      console.log(`Password reset completed for ${user.email}`)
    },
  },
  plugins: [admin()],
})
