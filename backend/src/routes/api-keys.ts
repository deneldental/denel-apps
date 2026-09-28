// Admin-only CRUD for API keys (generate, list, revoke, test).
// Plaintext is returned exactly once at generation time.

import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { apiKeys } from '../db/schema'
import { type ApiKeyScope, generateApiKey, sha256, verifyApiKey } from '../lib/api-keys'
import { createAuditLog } from '../lib/audit'
import { logError } from '../lib/logger'
import { ROLES } from '../lib/modules'
import { getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const apiKeysApp = new Hono<HonoEnv>()

const VALID_SCOPES: ReadonlySet<ApiKeyScope> = new Set(['website_bookings.create'])

function isAdmin(roleId: string | null | undefined): boolean {
  return roleId === ROLES.ADMIN
}

// GET / — list all keys (no plaintext, no hashes).
apiKeysApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isAdmin(user.roleId)) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const rows = await db
      .select({
        id: apiKeys.id,
        label: apiKeys.label,
        keyPrefix: apiKeys.keyPrefix,
        scope: apiKeys.scope,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .orderBy(desc(apiKeys.createdAt))
    return c.json({ success: true, data: rows })
  } catch (error) {
    logError(error, { route: 'api-keys.list', userId: user.id })
    return c.json({ error: 'Failed to list API keys', code: 'API_KEYS_LIST_FAILED' }, 500)
  }
})

// POST / — generate a new key. Returns plaintext ONCE.
apiKeysApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isAdmin(user.roleId)) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as { label?: string; scope?: string }
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 100) : ''
  const scope = typeof body.scope === 'string' ? body.scope : ''

  if (!label) return c.json({ error: 'label is required', code: 'INVALID_LABEL' }, 400)
  if (!VALID_SCOPES.has(scope as ApiKeyScope)) {
    return c.json(
      { error: `scope must be one of: ${[...VALID_SCOPES].join(', ')}`, code: 'INVALID_SCOPE' },
      400
    )
  }

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const { plaintext, prefix, hash } = generateApiKey()
    const [created] = await db
      .insert(apiKeys)
      .values({
        label,
        keyPrefix: prefix,
        keyHash: hash,
        scope,
        createdById: user.id,
      })
      .returning()

    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'api_keys',
      entityId: created.id,
      entityName: `API key "${created.label}" (${created.scope})`,
    })

    return c.json({
      success: true,
      data: {
        id: created.id,
        label: created.label,
        keyPrefix: created.keyPrefix,
        scope: created.scope,
        plaintext,
      },
    })
  } catch (error) {
    logError(error, { route: 'api-keys.create', userId: user.id })
    return c.json({ error: 'Failed to create API key', code: 'API_KEY_CREATE_FAILED' }, 500)
  }
})

// POST /:id/revoke — soft-delete (sets revokedAt). Idempotent.
apiKeysApp.post('/:id/revoke', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isAdmin(user.roleId)) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const id = c.req.param('id')
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const [existing] = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1)
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.revokedAt) return c.json({ success: true, data: { alreadyRevoked: true } })

    await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id))

    await createAuditLog(db, {
      userId: user.id,
      action: 'delete',
      module: 'api_keys',
      entityId: id,
      entityName: `Revoked API key "${existing.label}"`,
    })

    return c.json({ success: true })
  } catch (error) {
    logError(error, { route: 'api-keys.revoke', userId: user.id, keyId: id })
    return c.json({ error: 'Failed to revoke API key', code: 'API_KEY_REVOKE_FAILED' }, 500)
  }
})

// POST /:id/test — admin tests a key by id (looks up the row by id, not by
// plaintext, so we never need the secret again). Returns whether the key is
// active and would pass scope checks.
apiKeysApp.post('/:id/test', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isAdmin(user.roleId)) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const id = c.req.param('id')
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1)
    if (!row) return c.json({ error: 'Not found' }, 404)

    const active = row.revokedAt === null
    return c.json({
      success: true,
      data: {
        active,
        scope: row.scope,
        lastUsedAt: row.lastUsedAt,
        revokedAt: row.revokedAt,
      },
    })
  } catch (error) {
    logError(error, { route: 'api-keys.test', userId: user.id, keyId: id })
    return c.json({ error: 'Test failed', code: 'API_KEY_TEST_FAILED' }, 500)
  }
})

// POST /verify — accepts a plaintext key in the body and confirms it. Useful
// when the admin pastes a key from the website's env to verify it matches what
// they generated. Returns no secret material.
apiKeysApp.post('/verify', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isAdmin(user.roleId)) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as { key?: string; scope?: string }
  const plaintext = typeof body.key === 'string' ? body.key.trim() : ''
  const scope = typeof body.scope === 'string' ? body.scope : 'website_bookings.create'

  if (!plaintext || !VALID_SCOPES.has(scope as ApiKeyScope)) {
    return c.json({ success: true, data: { valid: false } })
  }

  const verified = await verifyApiKey(plaintext, scope as ApiKeyScope)
  if (!verified) {
    // Probe whether the hash exists but is revoked, so the UI can show
    // "revoked" vs "unknown key".
    const db = getDb(process.env.DATABASE_URL!)
    const [row] = await db
      .select({ revokedAt: apiKeys.revokedAt })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, sha256(plaintext)))
      .limit(1)
    return c.json({
      success: true,
      data: { valid: false, reason: row?.revokedAt ? 'revoked' : 'unknown' },
    })
  }
  return c.json({ success: true, data: { valid: true, scope: verified.scope } })
})

export { apiKeysApp }
