import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { account, user as userSchema, userScopes } from '../db/schema'
import { setUserPassword } from '../lib/account-sessions'
import { createAuditLog } from '../lib/audit'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { hashPassword } from '../lib/password'
import { requirePasswordChange } from '../lib/password-change'
import { checkPasswordPolicy } from '../lib/password-policy'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { denyUnless } from '../lib/route-access'
import type { HonoEnv } from '../lib/types'

const usersApp = new Hono<HonoEnv>()

usersApp.get('/', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, currentUser.id, MODULES.USERS as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const data = await db.query.user.findMany({ with: { role: true } })
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

usersApp.get('/roles', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)
  const denied = await denyUnless(c, currentUser.id, {
    apps: ['portal'],
    anyOf: [[MODULES.USERS, ACTIONS.READ]],
  })
  if (denied) return denied

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const data = await db.query.roles.findMany()
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

usersApp.get('/:id', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)

  const targetUserId = c.req.param('id')

  // Allow fetching self, otherwise require READ permission
  if (
    currentUser.id !== targetUserId &&
    !(await checkPermission(c, currentUser.id, MODULES.USERS as string, ACTIONS.READ as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const data = await db.query.user.findFirst({
      where: eq(userSchema.id, targetUserId),
      with: { role: true },
    })
    if (!data) return c.json({ error: 'User not found' }, 404)
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

usersApp.patch('/:id', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(c, currentUser.id, MODULES.USERS as string, ACTIONS.UPDATE as string))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const targetUserId = c.req.param('id')
  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const updates: any = {}
    if (body.name) updates.name = body.name
    if (body.phone) updates.phone = body.phone
    if (body.roleId) updates.roleId = body.roleId
    if (typeof body.email === 'string' && body.email.trim().length > 0) {
      const email = body.email.trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return c.json({ error: 'Invalid email format', code: 'INVALID_EMAIL' }, 400)
      }
      updates.email = email
    }

    const targetUser = await db.query.user.findFirst({
      where: eq(userSchema.id, targetUserId),
    })

    if (Object.keys(updates).length > 0) {
      await db.update(userSchema).set(updates).where(eq(userSchema.id, targetUserId))
    }

    if (body.password) {
      // L9 — enforced here too. Better Auth's own minimum is the only thing that
      // applied on this path, so an admin could set a password the staff-facing
      // routes would have rejected.
      const policy = checkPasswordPolicy(body.password, targetUser?.email)
      if (!policy.ok) {
        return c.json({ error: policy.error }, 400)
      }
      if (!targetUser) return c.json({ error: 'User not found' }, 404)
      // Written and revoked as one operation by our own helper. This used to call
      // Better Auth's `auth.api.setUserPassword({ body })` with no headers, and that
      // endpoint requires an admin SESSION, so every attempt threw UNAUTHORIZED and
      // answered 500 "Failed" (F44) — after the other fields had already been saved.
      await setUserPassword(db, targetUserId, body.password)
      // The admin chose it, so the person must replace it (F20) — unless the admin is
      // setting their own, which is just a password change.
      if (targetUserId !== currentUser.id) await requirePasswordChange(db, targetUserId)
    }

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: currentUser.id,
      action: 'update',
      module: 'users',
      entityId: targetUserId,
      entityName: targetUser?.name || targetUser?.email || 'User',
      changes: body,
    })

    // Re-fetch and return the post-update row so the caller can compare what
    // they sent vs what actually persisted. Closes a class of "I clicked save
    // but the value didn't change" debugging questions.
    const after = await db.query.user.findFirst({
      where: eq(userSchema.id, targetUserId),
      columns: { id: true, name: true, email: true, phone: true, roleId: true },
    })
    return c.json({
      success: true,
      data: after,
      updatedFields: Object.keys(updates),
    })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

usersApp.post('/', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(c, currentUser.id, MODULES.USERS as string, ACTIONS.CREATE as string))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !name || !password) {
    return c.json({ error: 'email, name and password are required' }, 400)
  }

  const policy = checkPasswordPolicy(password, email)
  if (!policy.ok) return c.json({ error: policy.error }, 400)

  try {
    const existing = await db.query.user.findFirst({ where: eq(userSchema.email, email) })
    if (existing) return c.json({ error: 'A user with that email already exists' }, 409)

    // Provisioned directly rather than through `auth.api.signUpEmail`.
    //
    // That call used to be how this worked, and it has been dead since
    // `disableSignUp: true` was set: Better Auth checks the flag INSIDE the
    // endpoint handler, with no exemption for a server-side caller
    // (`dist/api/routes/sign-up.mjs` — the very first statement throws
    // EMAIL_PASSWORD_SIGN_UP_DISABLED). So the fix that correctly closed public
    // registration also silently broke the only supported way to create a
    // staff account, and this route answered 500 for every attempt.
    //
    // The authorisation for this is the USERS:CREATE check above, not a Better
    // Auth session role — so it does not go through the admin plugin's
    // `/admin/create-user` either, which gates on `user.role` and would tie
    // staff provisioning back to the column L11 just removed from every
    // decision. The password goes through `hashPassword` (argon2id), which is
    // the same function the kernel is configured to use.
    const now = new Date()
    const userId = crypto.randomUUID()
    await db.transaction(async (tx) => {
      await tx.insert(userSchema).values({
        id: userId,
        name,
        email,
        phone: body.phone || null,
        roleId: body.roleId || null,
        emailVerified: true,
        // The admin chose this password: the person replaces it first (F20).
        mustChangePassword: true,
        createdAt: now,
        updatedAt: now,
      })
      await tx.insert(account).values({
        id: crypto.randomUUID(),
        accountId: userId,
        providerId: 'credential',
        userId,
        password: await hashPassword(password),
        createdAt: now,
        updatedAt: now,
      })
    })

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: currentUser.id,
      action: 'create',
      module: 'users',
      entityId: userId,
      entityName: name || email,
      changes: { email, name, phone: body.phone ?? null, roleId: body.roleId ?? null },
    })

    return c.json({ success: true, id: userId })
  } catch (error: unknown) {
    logError(error, { context: '[users] Failed to create user' })
    return c.json({ error: 'Failed' }, 500)
  }
})

// ─── User scope overrides ─────────────────────────────────────────────────────
// GET  /api/users/:id/scopes  — return effective scopes for a user
usersApp.get('/:id/scopes', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, currentUser.id, MODULES.USERS as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const targetUserId = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const rows = await db.query.userScopes.findMany({
      where: eq(userScopes.userId, targetUserId),
    })
    return c.json({ success: true, data: rows })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// PUT /api/users/:id/scopes  — set user-level scope overrides
// Body: { scopes: ['portal', 'pwa'] }  — replaces ALL scope overrides for this user
usersApp.put('/:id/scopes', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(c, currentUser.id, MODULES.USERS as string, ACTIONS.UPDATE as string))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const targetUserId = c.req.param('id')
  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  const validScopes = ['portal', 'pwa']
  const requestedScopes: string[] = body.scopes ?? []

  if (!Array.isArray(requestedScopes) || requestedScopes.some((s) => !validScopes.includes(s))) {
    return c.json({ error: 'scopes must be an array of: portal | pwa' }, 400)
  }

  try {
    const targetUser = await db.query.user.findFirst({ where: eq(userSchema.id, targetUserId) })
    if (!targetUser) return c.json({ error: 'User not found' }, 404)

    // Delete existing scope overrides and re-insert
    await db.delete(userScopes).where(eq(userScopes.userId, targetUserId))

    if (requestedScopes.length > 0) {
      await db.insert(userScopes).values(
        requestedScopes.map((scope) => ({
          userId: targetUserId,
          interfaceScope: scope,
          granted: true,
          grantedById: currentUser.id,
        }))
      )
    }

    await createAuditLog(db, {
      userId: currentUser.id,
      action: 'update',
      module: 'users',
      entityId: targetUserId,
      entityName: targetUser.name || targetUser.email || 'User',
      changes: { scopes: requestedScopes },
    })

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

usersApp.delete('/:id', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(c, currentUser.id, MODULES.USERS as string, ACTIONS.DELETE as string))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const targetUserId = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const targetUser = await db.query.user.findFirst({
      where: eq(userSchema.id, targetUserId),
    })

    await db.delete(userSchema).where(eq(userSchema.id, targetUserId))

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: currentUser.id,
      action: 'delete',
      module: 'users',
      entityId: targetUserId,
      entityName: targetUser?.name || targetUser?.email || 'User',
    })

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

export { usersApp }
