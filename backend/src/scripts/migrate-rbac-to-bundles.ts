/**
 * migrate-rbac-to-bundles.ts — Phase 3.1: one-time migration of role_permissions → bundles
 *
 * For any role that has rows in role_permissions but NO rows in role_bundles,
 * this script creates a "legacy" bundle for that role, moves its permissions
 * into that bundle, and links the role to the bundle.
 *
 * Idempotent: safe to run multiple times. Already-migrated roles are skipped.
 * The role_permissions rows are NOT deleted — drop the table separately once
 * the legacy fallback code has been removed and you've verified production.
 *
 * Run with:
 *   doppler run -- pnpm tsx src/scripts/migrate-rbac-to-bundles.ts
 */

import { eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../db/schema'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is required')

const cleanUrl = DATABASE_URL.replace(/([?&])sslmode=[^&]*/g, '$1')
  .replace(/[?&]$/, '')
  .replace(/\?&/, '?')

const pool = new Pool({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } })
const db = drizzle(pool, { schema })

async function main() {
  console.log('Phase 3.1 — Migrating role_permissions → permission_bundles\n')

  // Find all roles that still have role_permissions rows
  const allRoleIds = [
    ...new Set(
      (await db.select({ roleId: schema.rolePermissions.roleId }).from(schema.rolePermissions)).map(
        (r) => r.roleId
      )
    ),
  ]

  if (allRoleIds.length === 0) {
    console.log('No role_permissions rows found. Nothing to migrate.')
    await pool.end()
    return
  }

  // Of those, find which already have bundles assigned (already migrated)
  const alreadyMigrated = (
    await db
      .select({ roleId: schema.roleBundles.roleId })
      .from(schema.roleBundles)
      .where(inArray(schema.roleBundles.roleId, allRoleIds))
  ).map((r) => r.roleId)

  const needsMigration = allRoleIds.filter((id) => !alreadyMigrated.includes(id))

  if (needsMigration.length === 0) {
    console.log(
      `All ${allRoleIds.length} role(s) with role_permissions already have bundles. Nothing to do.`
    )
    await pool.end()
    return
  }

  console.log(`Migrating ${needsMigration.length} role(s): ${needsMigration.join(', ')}\n`)

  for (const roleId of needsMigration) {
    // Fetch the role's existing permissions
    const rows = await db
      .select({ permissionId: schema.rolePermissions.permissionId })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, roleId))

    if (rows.length === 0) {
      console.log(`  Skipping ${roleId} — no permission rows (empty role).`)
      continue
    }

    const bundleId = `legacy_${roleId}`
    const bundleName = `Legacy permissions for role: ${roleId}`

    // Create the bundle (skip if already exists from a previous partial run)
    const existingBundle = await db.query.permissionBundles.findFirst({
      where: eq(schema.permissionBundles.id, bundleId),
    })

    if (!existingBundle) {
      await db.insert(schema.permissionBundles).values({
        id: bundleId,
        name: bundleName,
        description: `Auto-migrated from role_permissions during Phase 3.1 migration.`,
        scope: 'portal',
        isSystem: false,
      })
      console.log(`  Created bundle: ${bundleId}`)
    } else {
      console.log(`  Bundle already exists: ${bundleId} (from previous partial run)`)
    }

    // Link permissions to the bundle
    await db.delete(schema.bundlePermissions).where(eq(schema.bundlePermissions.bundleId, bundleId))
    await db
      .insert(schema.bundlePermissions)
      .values(rows.map((r) => ({ bundleId, permissionId: r.permissionId })))

    // Link the role to this bundle
    await db.delete(schema.roleBundles).where(eq(schema.roleBundles.roleId, roleId))
    await db.insert(schema.roleBundles).values({ roleId, bundleId })

    console.log(`  Migrated ${rows.length} permission(s) for role: ${roleId}`)
  }

  console.log('\n✅ Migration complete.')
  console.log('Next: verify effective permissions for all roles, then remove the legacy fallback')
  console.log(
    'in BundleResolver and deploy. After a week in production, drop the role_permissions table.'
  )

  await pool.end()
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
