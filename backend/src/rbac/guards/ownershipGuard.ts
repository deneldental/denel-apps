/**
 * ownershipGuard â€” ABAC: ensures a staff member can only access their own records
 *
 * Used for external trainers and any scenario where a staff member should only
 * see/modify their own data (requests, performance, training progress, profile).
 *
 * The guard compares the requested resource's staffId/userId against the
 * authenticated user's linked staff record.
 *
 * Usage (inline â€” call inside route handler):
 *
 *   const staff = await getStaffByUserId(authUser.id, db)
 *   if (!staff) return c.json({ error: 'No staff record' }, 403)
 *
 *   const guard = ownershipGuard(staff.id)
 *   const ok = await guard.check(resourceStaffId)
 *   if (!ok) return c.json({ error: 'Access denied' }, 403)
 *
 * NOTE: ABAC checks are intentionally simple for now â€” ownership only.
 * Time-window and department-based checks are stubs for future use.
 */

import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '../../db/schema'

type DB = NodePgDatabase<typeof schema>

export class OwnershipGuard {
  private callerStaffId: string

  constructor(callerStaffId: string) {
    this.callerStaffId = callerStaffId
  }

  /**
   * Returns true if the caller is the owner of the resource,
   * or if the caller has admin/manager access (bypasses ownership check).
   */
  isOwner(resourceStaffId: string): boolean {
    return this.callerStaffId === resourceStaffId
  }
}

/**
 * Look up the staff record for the authenticated user.
 * Returns null if no staff record is linked (user is not a staff member).
 *
 * `role` is nullable because newly-created staff have no role until Access
 * Management assigns one. Callers that need to gate on a role must handle null.
 */
export async function getStaffForUser(
  db: DB,
  userId: string
): Promise<{ id: string; isExternalTrainer: boolean; role: string | null } | null> {
  // Role lives on the auth user now — staff.role was dropped. Look up both.
  const result = await db.query.staff.findFirst({
    where: eq(schema.staff.userId, userId),
    columns: { id: true, isExternalTrainer: true },
  })
  if (!result) return null
  const u = await db.query.user.findFirst({
    where: eq(schema.user.id, userId),
    columns: { role: true },
  })
  return { id: result.id, isExternalTrainer: result.isExternalTrainer, role: u?.role ?? null }
}

/**
 * Middleware factory: blocks external trainers from accessing a route.
 * For routes that standard staff can access but external trainers cannot.
 *
 * Usage:
 *   app.get('/staff-portal/requests', verifySession(), blockExternalTrainers(), handler)
 */
import type { MiddlewareHandler } from 'hono'
import { env } from '../../config/env'
import { getDb } from '../../db'
import type { HonoEnv } from '../../lib/types'

export function blockExternalTrainers(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const user = c.var.user
    if (!user) return c.json({ error: 'Not authenticated' }, 401)

    const db = getDb(env.DATABASE_URL)
    const staffRecord = await getStaffForUser(db, user.id)

    if (staffRecord?.isExternalTrainer) {
      return c.json({ error: 'External trainers cannot access this feature' }, 403)
    }

    await next()
  }
}

// ─── Reusable resource-ownership guard ──────────────────────────────────────
//
// Use this factory on routes whose `:id` (or similar) path param references a
// row that should only be readable/writable by its owner. Stops trivial IDOR:
// a valid session calling /api/resource/<someone-else's-id>.
//
// The guard does NOT replace RBAC — `verifySession()` + `checkPermission()`
// still run first. Ownership is the per-row layer underneath.
//
// Typical usage:
//
//   const guard = resourceOwnershipGuard({
//     paramName: 'id',
//     loadOwnerId: async (db, id) => {
//       const row = await db.query.invoices.findFirst({
//         where: eq(invoices.id, id),
//         columns: { patientId: true },
//       })
//       return row?.patientId ?? null
//     },
//     getCallerId: async (c) => {
//       const patient = await getSessionPatient(c)
//       return patient?.id ?? null
//     },
//   })
//
//   app.get('/:id', guard, handler)
//
// `loadOwnerId` returning null → 404 (don't leak existence).
// `getCallerId` returning null → 401.
// IDs differ → 403.

export interface ResourceOwnershipOptions<TDb> {
  /** Path param name that holds the resource id. Defaults to `'id'`. */
  paramName?: string
  /** Returns the owner identifier for the resource, or null if not found. */
  loadOwnerId: (db: TDb, resourceId: string) => Promise<string | null>
  /** Returns the caller's owner identifier (e.g. patientId, staffId, userId). */
  getCallerId: (c: import('hono').Context<HonoEnv>) => Promise<string | null>
  /**
   * Optional bypass — return true to skip the ownership check entirely
   * (e.g. admins, support roles). Default: never bypass.
   */
  bypass?: (c: import('hono').Context<HonoEnv>) => Promise<boolean>
}

export function resourceOwnershipGuard<TDb = ReturnType<typeof getDb>>(
  opts: ResourceOwnershipOptions<TDb>
): MiddlewareHandler<HonoEnv> {
  const paramName = opts.paramName ?? 'id'

  return async (c, next) => {
    if (opts.bypass && (await opts.bypass(c))) {
      return next()
    }

    const callerId = await opts.getCallerId(c)
    if (!callerId) return c.json({ error: 'Not authenticated' }, 401)

    const resourceId = c.req.param(paramName)
    if (!resourceId) return c.json({ error: 'Missing resource id' }, 400)

    const db = getDb(env.DATABASE_URL) as unknown as TDb
    const ownerId = await opts.loadOwnerId(db, resourceId)

    // 404 (not 403) when the row doesn't exist — avoids confirming the id
    // belongs to someone else.
    if (ownerId == null) return c.json({ error: 'Not found' }, 404)

    if (ownerId !== callerId) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    return next()
  }
}
