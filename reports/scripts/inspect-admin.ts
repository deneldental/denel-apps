import { config } from 'dotenv'

config({ path: '.env.local' })

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { account, user } from '@/lib/db/schema'

async function inspectAdmin() {
  console.log('🔍 Inspecting admin user...')

  const email = 'admin@example.com'

  const foundUser = await db.query.user.findFirst({
    where: eq(user.email, email),
    with: {
      role: true, // Only if relation exists in schema (it does: userRelations)
    },
  })

  if (!foundUser) {
    console.log('❌ Admin user NOT found in "user" table.')
  } else {
    console.log('✅ Admin user FOUND:')
    console.log({
      id: foundUser.id,
      email: foundUser.email,
      roleId: foundUser.roleId,
      roleName: foundUser.role ? foundUser.role : 'N/A', // Better Auth role field
    })

    // Check account
    const accounts = await db.query.account.findMany({
      where: eq(account.userId, foundUser.id),
    })

    console.log(`Found ${accounts.length} account(s) for this user.`)

    for (const acc of accounts) {
      console.log('--- Account ---')
      console.log({
        id: acc.id,
        providerId: acc.providerId,
        hasPassword: !!acc.password,
        passwordLength: acc.password ? acc.password.length : 0,
        passwordPrefix: acc.password ? `${acc.password.substring(0, 10)}...` : 'N/A',
      })
    }
  }

  // Also check if there are orphaned accounts for this email?
  // Account doesn't have email usually, but let's check if any other user has this email? (constraint says unique)
}

inspectAdmin()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .then(() => {
    process.exit(0)
  })
