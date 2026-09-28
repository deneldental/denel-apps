/**
 * verifySession — Hono middleware
 *
 * Validates the Better Auth session cookie and attaches the authenticated
 * user to the Hono context as `c.var.user`.
 *
 * Uses Better Auth's getSession() — NOT JWT decode.
 * The shared `.deneldental.com` cookie is validated by Better Auth's session table,
 * keeping Portal and PWA on the same session without re-authentication.
 *
 * On failure: returns 401 with JSON error body.
 * On success: calls next() with c.var.user populated.
 */

import type { MiddlewareHandler } from 'hono'
import { getAuth } from '../../auth'
import { logger } from '../../lib/logger'
import { getSessionStaff } from '../../lib/staff-session'
import type { HonoEnv } from '../../lib/types'

interface SessionUserWithRole {
  id: string
  email: string
  name: string
  roleId?: string | null
  role?: string | null
}

declare module 'hono' {
  interface ContextVariableMap {
    user: {
      id: string
      email: string
      name: string
      roleId: string | null
      role: string | null
    }
  }
}

export function verifySession(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    let sessionUser: SessionUserWithRole | null = null
    let isStaffSession = false

    try {
      // Dual-source: custom staff (phone+OTP) session first, then Better Auth.
      const staffSession = await getSessionStaff(c)
      if (staffSession) {
        sessionUser = staffSession.user
        isStaffSession = true
      } else {
        const auth = getAuth(c)
        const session = await auth.api.getSession({
          headers: c.req.raw.headers,
        })
        if (session?.user) {
          sessionUser = session.user as SessionUserWithRole
        }
      }
    } catch (err) {
      logger.warn({ err }, '[verifySession] Session validation failed')
      return c.json({ error: 'Not authenticated' }, 401)
    }

    if (!sessionUser) {
      return c.json({ error: 'Not authenticated' }, 401)
    }

    c.set('user', {
      id: sessionUser.id,
      email: sessionUser.email,
      name: sessionUser.name,
      roleId: sessionUser.roleId ?? null,
      role: sessionUser.role ?? null,
    })

    await next()
  }
}
