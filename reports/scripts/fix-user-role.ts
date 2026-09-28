import { config } from 'dotenv'

config({ path: '.env.local' })

import { eq, isNull } from 'drizzle-orm'
import { db } from '../lib/db'
import { roles, user } from '../lib/db/schema'
import { ROLES } from '../lib/modules'

async function fixUserRole() {
  // Get user ID or email from command line arguments
  const userIdOrEmail = process.argv[2]
  const roleId = process.argv[3] || ROLES.ADMIN

  try {
    // Validate role exists
    const role = await db.query.roles.findFirst({
      where: eq(roles.id, roleId),
    })

    if (!role) {
      console.error(`❌ Role '${roleId}' does not exist.`)
      console.log('Available roles: admin, doctor, receptionist')
      console.log('Please run: npx tsx scripts/seed-rbac.ts')
      process.exit(1)
    }

    let dbUser

    // Try to find by ID first, then by email
    if (userIdOrEmail) {
      if (userIdOrEmail.includes('@')) {
        // It's an email
        dbUser = await db.query.user.findFirst({
          where: eq(user.email, userIdOrEmail),
        })
      } else {
        // It's a user ID
        dbUser = await db.query.user.findFirst({
          where: eq(user.id, userIdOrEmail),
        })
      }
    } else {
      // No argument provided - find all users without roles
      const usersWithoutRoles = await db.query.user.findMany({
        where: isNull(user.roleId),
      })

      if (usersWithoutRoles.length === 0) {
        console.log('✅ All users have roles assigned.')
        process.exit(0)
      }

      console.log(`Found ${usersWithoutRoles.length} user(s) without roles:`)
      for (const u of usersWithoutRoles) {
        console.log(`  - ${u.email} (ID: ${u.id})`)
      }

      // Assign admin role to all users without roles
      for (const u of usersWithoutRoles) {
        await db.update(user).set({ roleId: roleId }).where(eq(user.id, u.id))
        console.log(`✅ Assigned role '${roleId}' to ${u.email}`)
      }

      console.log(`\n✅ Successfully assigned roles to ${usersWithoutRoles.length} user(s).`)
      process.exit(0)
    }

    if (!dbUser) {
      console.error(`❌ User not found: ${userIdOrEmail}`)
      process.exit(1)
    }

    // Update user's role
    await db.update(user).set({ roleId: roleId }).where(eq(user.id, dbUser.id))

    console.log(`✅ Successfully assigned role '${roleId}' to user: ${dbUser.email} (${dbUser.id})`)
  } catch (error) {
    console.error('❌ Error assigning role:', error)
    process.exit(1)
  }

  process.exit(0)
}

fixUserRole()
