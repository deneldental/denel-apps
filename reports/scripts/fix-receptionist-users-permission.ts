import { config } from 'dotenv'

config({ path: '.env.local' })

import { db } from '@/lib/db'
import { rolePermissions } from '@/lib/db/schema'
import { ACTIONS, MODULES, ROLES } from '@/lib/modules'

async function fixReceptionistPermissions() {
  console.log('🔧 Adding USERS module permissions for receptionist...')

  try {
    // Get all actions for USERS module
    const actions = Object.values(ACTIONS)

    for (const action of actions) {
      // Find the permission
      const permission = await db.query.permissions.findFirst({
        where: (perms, { and, eq }) =>
          and(eq(perms.module, MODULES.USERS), eq(perms.action, action)),
      })

      if (permission) {
        // Assign to receptionist if not already assigned
        await db
          .insert(rolePermissions)
          .values({
            roleId: ROLES.RECEPTIONIST,
            permissionId: permission.id,
          })
          .onConflictDoNothing()

        console.log(`✓ Added ${action} permission for USERS module to receptionist`)
      } else {
        console.log(`✗ Permission not found: ${action} on USERS`)
      }
    }

    console.log('✅ Done! Receptionist can now read users (doctors list).')
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
  process.exit(0)
}

fixReceptionistPermissions()
