import { config } from 'dotenv'

config({ path: '.env.local' })

import { eq } from 'drizzle-orm'
import { db } from '../lib/db'
import { roles, user } from '../lib/db/schema'
import { ROLES } from '../lib/modules'

async function assignRole() {
  // Get email and role from command line arguments
  const email = process.argv[2]
  const roleId = process.argv[3] || ROLES.ADMIN

  if (!email) {
    console.error('Usage: npm run tsx scripts/assign-role.ts <email> [role]')
    console.error('Roles: admin, doctor, receptionist')
    process.exit(1)
  }

  // Validate role
  const validRoles = [ROLES.ADMIN, ROLES.DOCTOR, ROLES.RECEPTIONIST] as const
  if (!validRoles.includes(roleId as (typeof validRoles)[number])) {
    console.error(`Invalid role: ${roleId}. Must be one of: ${validRoles.join(', ')}`)
    process.exit(1)
  }

  try {
    // Check if role exists
    const role = await db.query.roles.findFirst({
      where: eq(roles.id, roleId),
    })

    if (!role) {
      console.error(
        `Role '${roleId}' does not exist. Please run the seed script first: npm run tsx scripts/seed-rbac.ts`
      )
      process.exit(1)
    }

    // Find user by email
    const dbUser = await db.query.user.findFirst({
      where: eq(user.email, email),
    })

    if (!dbUser) {
      console.error(`User with email '${email}' not found.`)
      process.exit(1)
    }

    // Update user's role
    await db.update(user).set({ roleId: roleId }).where(eq(user.id, dbUser.id))

    console.log(`✅ Successfully assigned role '${roleId}' to user: ${email}`)
  } catch (error) {
    console.error('Error assigning role:', error)
    process.exit(1)
  }

  process.exit(0)
}

assignRole()
