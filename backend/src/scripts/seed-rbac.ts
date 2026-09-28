/**
 * seed-rbac.ts — Seeds the RBAC v2 tables from config definitions
 *
 * Run with: pnpm tsx src/scripts/seed-rbac.ts
 *
 * Safe to run multiple times (upsert logic). Idempotent.
 *
 * What this does:
 * 1. Upserts all permission (module, action) pairs from permissions.config
 * 2. Upserts system bundles from bundles.config, expanding wildcards
 * 3. Upserts system roles from roles.config with isSystem = true
 * 4. Seeds role_scopes for system roles
 * 5. Seeds role_bundles for system roles
 * 6. Adds isSystem = true to existing built-in roles
 */

import * as dotenv from 'dotenv'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { SYSTEM_BUNDLES } from '../config/bundles.config'
import { PERMISSION_DEFINITIONS } from '../config/permissions.config'
import { SYSTEM_ROLES } from '../config/roles.config'
import * as schema from '../db/schema'
import { sslOptionFor } from '../lib/db-ssl'
import { expandPermissionString } from '../rbac/utils/wildcardMatch'

dotenv.config({ path: '.dev.vars' })

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL environment variable is required')

// Strip sslmode — newer pg treats sslmode=require as verify-full, which fails
// against DigitalOcean/Neon self-signed CA certs.
const cleanUrl = DATABASE_URL.replace(/([?&])sslmode=[^&]*/g, '$1')
  .replace(/[?&]$/, '')
  .replace(/\?&/, '?')

// Local Postgres (dev:local, and the VPS's in-network `db` service) has no
// TLS — only force SSL for remote hosts. See lib/db-ssl.ts.
const pool = new Pool({
  connectionString: cleanUrl,
  ssl: sslOptionFor(cleanUrl),
})
const db = drizzle(pool, { schema })

async function main() {
  console.log('🌱 Seeding RBAC v2 tables...\n')

  // ── 1. Permissions ─────────────────────────────────────────────────────────
  console.log(`Seeding ${PERMISSION_DEFINITIONS.length} permissions...`)

  for (const def of PERMISSION_DEFINITIONS) {
    await db
      .insert(schema.permissions)
      .values({
        id: schema.permissions.id.default,
        module: def.module,
        action: def.action,
        description: def.description,
      })
      .onConflictDoUpdate({
        target: [schema.permissions.module, schema.permissions.action],
        set: { description: def.description },
      })
      .catch(() => {
        // Ignore if onConflictDoUpdate isn't available in this drizzle version
      })
  }

  // Fetch the full permissions map for lookup by module+action
  const allPermissions = await db.select().from(schema.permissions)
  const permissionsByKey = new Map(allPermissions.map((p) => [`${p.module}:${p.action}`, p.id]))
  console.log(`  ✓ ${allPermissions.length} permissions in DB\n`)

  // ── 2. System bundles ──────────────────────────────────────────────────────
  console.log(`Seeding ${SYSTEM_BUNDLES.length} system bundles...`)

  for (const bundle of SYSTEM_BUNDLES) {
    // Upsert bundle
    const existing = await db.query.permissionBundles.findFirst({
      where: eq(schema.permissionBundles.id, bundle.id),
    })

    if (!existing) {
      await db.insert(schema.permissionBundles).values({
        id: bundle.id,
        name: bundle.name,
        description: bundle.description,
        scope: bundle.scope,
        isSystem: true,
      })
    } else {
      await db
        .update(schema.permissionBundles)
        .set({
          name: bundle.name,
          description: bundle.description,
          scope: bundle.scope,
          isSystem: true,
        })
        .where(eq(schema.permissionBundles.id, bundle.id))
    }

    // Expand and upsert bundle permissions
    const resolvedPermissions = bundle.permissions.flatMap((p) => expandPermissionString(p))
    const permissionIds = resolvedPermissions
      .map(({ module, action }) => permissionsByKey.get(`${module}:${action}`))
      .filter((id): id is string => !!id)

    // Remove existing bundle permissions and re-insert
    await db
      .delete(schema.bundlePermissions)
      .where(eq(schema.bundlePermissions.bundleId, bundle.id))

    if (permissionIds.length > 0) {
      await db
        .insert(schema.bundlePermissions)
        .values(permissionIds.map((permissionId) => ({ bundleId: bundle.id, permissionId })))
    }

    console.log(`  ✓ ${bundle.name} (${permissionIds.length} permissions)`)
  }
  console.log()

  // ── 3. System roles ────────────────────────────────────────────────────────
  console.log(`Seeding ${SYSTEM_ROLES.length} system roles...`)

  for (const role of SYSTEM_ROLES) {
    const existing = await db.query.roles.findFirst({
      where: eq(schema.roles.id, role.id),
    })

    if (!existing) {
      await db.insert(schema.roles).values({
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: true,
      })
    } else {
      await db
        .update(schema.roles)
        .set({ name: role.name, description: role.description, isSystem: true })
        .where(eq(schema.roles.id, role.id))
    }

    // ── Role scopes ──────────────────────────────────────────────────────────
    await db.delete(schema.roleScopes).where(eq(schema.roleScopes.roleId, role.id))
    if (role.scopes.length > 0) {
      await db
        .insert(schema.roleScopes)
        .values(role.scopes.map((scope) => ({ roleId: role.id, interfaceScope: scope })))
    }

    // ── Role bundles ─────────────────────────────────────────────────────────
    await db.delete(schema.roleBundles).where(eq(schema.roleBundles.roleId, role.id))
    if (role.bundleIds.length > 0) {
      await db
        .insert(schema.roleBundles)
        .values(role.bundleIds.map((bundleId) => ({ roleId: role.id, bundleId })))
    }

    // Clear legacy matrix permissions for this system role so it resolves via bundles
    await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, role.id))

    console.log(`  ✓ ${role.name} (${role.scopes.join(', ')}) → ${role.bundleIds.length} bundles`)
  }

  console.log('\n✅ RBAC v2 seed complete.')
  await pool.end()
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
