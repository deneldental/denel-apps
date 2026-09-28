import { config } from 'dotenv'

config({ path: '.env.local' })

import { hash } from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { account, user } from '@/lib/db/schema'

async function resetAdminPassword() {
  console.log('🔄 Resetting admin password...')

  const email = 'admin@example.com'
  const password = process.env.ADMIN_PASSWORD
  if (!password) {
    console.error('Error: ADMIN_PASSWORD environment variable is required')
    process.exit(1)
  }
  const hashedPassword = await hash(password, 10)

  // 1. Check if user exists
  const existingUser = await db.query.user.findFirst({
    where: eq(user.email, email),
  })

  if (!existingUser) {
    console.error('❌ Admin user not found! Please run the seed script first.')
    process.exit(1)
  }

  console.log(`👤 Found user: ${existingUser.name} (${existingUser.id})`)

  // 2. Check for existing account
  const existingAccount = await db.query.account.findFirst({
    where: eq(account.userId, existingUser.id),
  })

  if (existingAccount) {
    console.log('📝 Updating existing account password...')
    await db
      .update(account)
      .set({
        password: hashedPassword,
        updatedAt: new Date(),
      })
      .where(eq(account.id, existingAccount.id))
  } else {
    console.log('➕ Creating new account record...')
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: existingUser.id,
      providerId: 'credential',
      userId: existingUser.id,
      password: hashedPassword,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  console.log('✅ Admin password reset successfully')
}

resetAdminPassword()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .then(() => {
    process.exit(0)
  })
