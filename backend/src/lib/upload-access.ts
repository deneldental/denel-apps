/**
 * May THIS person upload THIS kind of file, from the app they are using? (F22 / D9)
 *
 * The kinds themselves are in `upload-policy.ts` (pure); this is the part that needs the request,
 * the permission engine and, for the Team app, the database.
 */
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { getDb } from '../db'
import { staff } from '../db/schema'
import { resolveAppScope } from '../rbac/middleware/detectInterface'
import type { AuthUser } from './rbac'
import { hasAnyPermission } from './route-access'
import type { HonoEnv } from './types'
import type { UploadApp, UploadKind } from './upload-policy'

export type UploadAccess = { ok: true; staffId?: string } | { ok: false; error: string }

export async function authorizeUpload(
  c: Context<HonoEnv>,
  user: AuthUser,
  kind: UploadKind
): Promise<UploadAccess> {
  const app = resolveAppScope(c) as UploadApp
  if (!kind.apps.includes(app)) {
    return { ok: false, error: 'This kind of file cannot be uploaded from this app.' }
  }

  switch (kind.need.type) {
    case 'self-user':
      return { ok: true }

    case 'self-staff': {
      // The Team app writes only into the caller's own area, found through the staff record that is
      // linked to the login: never through anything the request says.
      const db = getDb(process.env.DATABASE_URL as string)
      const row = await db.query.staff.findFirst({
        where: eq(staff.userId, user.id),
        columns: { id: true },
      })
      if (!row) return { ok: false, error: 'Your login is not linked to a staff record.' }
      return { ok: true, staffId: row.id }
    }

    case 'permission':
      return (await hasAnyPermission(c, user.id, kind.need.anyOf))
        ? { ok: true }
        : { ok: false, error: 'You do not have permission to upload this kind of file.' }
  }
}
