import { config } from 'dotenv'

config({ path: '.env.local' })

import { db } from '@/lib/db'
import { permissions, rolePermissions, roles } from '@/lib/db/schema'
import { ACTIONS, MODULES, ROLES } from '@/lib/modules'

async function seed() {
  console.log('🌱 Seeding database...')

  // 1. Create Roles
  console.log('Creating roles...')
  const roleList = [
    { id: ROLES.ADMIN, name: 'Admin', description: 'Administrator with full access' },
    { id: ROLES.DOCTOR, name: 'Doctor', description: 'Medical professional' },
    { id: ROLES.RECEPTIONIST, name: 'Receptionist', description: 'Front desk staff' },
  ]

  for (const r of roleList) {
    await db.insert(roles).values(r).onConflictDoNothing()
  }

  // 2. Create Permissions & Assign to Roles
  console.log('Creating permissions...')
  const allModules = Object.values(MODULES)
  const allActions = Object.values(ACTIONS)

  for (const moduleName of allModules) {
    for (const action of allActions) {
      // Upsert permission
      let permissionId: string

      // Try to find existing
      const existing = await db.query.permissions.findFirst({
        where: (perms, { and, eq }) => and(eq(perms.module, moduleName), eq(perms.action, action)),
      })

      if (existing) {
        permissionId = existing.id
      } else {
        const [perm] = await db
          .insert(permissions)
          .values({
            module: moduleName,
            action,
            description: `${action} ${moduleName}`,
          })
          .returning()
        permissionId = perm.id
      }

      // Assign ALL permissions to ADMIN
      await db
        .insert(rolePermissions)
        .values({
          roleId: ROLES.ADMIN,
          permissionId: permissionId,
        })
        .onConflictDoNothing()

      // Assign specific permissions to DOCTOR
      if (
        [
          MODULES.PATIENTS.toString(),
          MODULES.APPOINTMENTS.toString(),
          MODULES.MEDICAL_RECORDS.toString(),
          MODULES.MESSAGING.toString(),
          MODULES.REPORTS.toString(),
          MODULES.ORTHO_CONSENT.toString(),
        ].includes(moduleName)
      ) {
        await db
          .insert(rolePermissions)
          .values({
            roleId: ROLES.DOCTOR,
            permissionId: permissionId,
          })
          .onConflictDoNothing()
      }

      // Assign specific permissions to RECEPTIONIST
      if (
        [
          MODULES.PATIENTS.toString(),
          MODULES.APPOINTMENTS.toString(),
          MODULES.PAYMENTS.toString(),
          MODULES.MESSAGING.toString(),
          MODULES.INVENTORY.toString(),
          MODULES.PRODUCTS.toString(),
          MODULES.EXPENSES.toString(),
          MODULES.REPORTS.toString(),
          MODULES.ORTHO_CONSENT.toString(),
          MODULES.USERS.toString(),
        ].includes(moduleName)
      ) {
        await db
          .insert(rolePermissions)
          .values({
            roleId: ROLES.RECEPTIONIST,
            permissionId: permissionId,
          })
          .onConflictDoNothing()
      }
    }
  }

  console.log('✅ Seeding complete! (Roles & Permissions set up)')
}

seed()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .then(() => {
    process.exit(0)
  })
