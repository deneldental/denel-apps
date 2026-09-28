import { config } from 'dotenv'

config({ path: '.env.local' })

import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user } from '@/lib/db/schema'
import { ROLES } from '@/lib/modules'

async function resetAdminWithAPI() {
  console.log('🔄 Resetting admin user using Better Auth API...')

  const email = 'admin@example.com'
  const password = process.env.ADMIN_PASSWORD
  if (!password) {
    console.error('Error: ADMIN_PASSWORD environment variable is required')
    process.exit(1)
  }
  const name = 'Admin User'

  // 1. Delete existing user to ensure clean state
  console.log('🗑️ Deleting existing admin user...')
  try {
    const existingUser = await db.query.user.findFirst({
      where: eq(user.email, email),
    })

    if (existingUser) {
      await db.delete(user).where(eq(user.id, existingUser.id))
      console.log('✅ Deleted existing user')
    }
  } catch (e) {
    console.warn('⚠️ Error checking/deleting user (might not exist):', e)
  }

  // 2. Create user using Better Auth API
  console.log('✨ Creating new admin user...')
  try {
    const _res = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name,
      },
    })

    // Response might be the user object or session, depending on version
    console.log('✅ User created via API')

    // 3. Force role update (in case API didn't set it, though we didn't pass it)
    // We need to fetch the new user ID
    const newUser = await db.query.user.findFirst({
      where: eq(user.email, email),
    })

    if (newUser) {
      console.log(`👤 Found new user: ${newUser.id}`)
      await db
        .update(user)
        .set({
          roleId: ROLES.ADMIN, // Our RBAC role
          role: 'admin', // Better Auth admin plugin role
          emailVerified: true, // Auto-verify
        })
        .where(eq(user.id, newUser.id))
      console.log('👮 assigned ADMIN roles')
    } else {
      console.error('❌ Could not find the newly created user to assign roles!')
    }

    // 4. Verify login matches
    console.log('🔐 Verifying login credentials...')
    try {
      const _loginRes = await auth.api.signInEmail({
        body: {
          email,
          password,
        },
      })
      console.log('✅ Login verification SUCCESSFUL!')
    } catch (e) {
      console.error('❌ Login verification FAILED within script:', e)
    }
  } catch (e) {
    console.error('❌ Failed to create user via API:', e)
    process.exit(1)
  }
}

resetAdminWithAPI()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .then(() => {
    process.exit(0)
  })
