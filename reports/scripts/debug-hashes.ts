import { config } from 'dotenv'

config({ path: '.env.local' })

import { eq } from 'drizzle-orm'
import { db } from '../lib/db'
import { account } from '../lib/db/schema'

async function main() {
  const users = await db.query.user.findMany()
  console.log(`Found ${users.length} users`)
  for (const u of users) {
    console.log(`\nUser: ${u.email} (${u.roleId})`)
    const accounts = await db.select().from(account).where(eq(account.userId, u.id))
    for (const acc of accounts) {
      console.log(`  Provider: ${acc.providerId}`)
      const pwd = acc.password || ''
      if (pwd) {
        console.log(`  Hash Prefix: ${pwd.substring(0, 15)}...`)
        console.log(`  Hash Length: ${pwd.length}`)

        if (pwd.startsWith('$2')) console.log('  Type: Likely Bcrypt')
        else if (pwd.includes(':')) console.log('  Type: Likely Scrypt (Custom/BetterAuth)')
        else console.log('  Type: Unknown/Other')
      } else {
        console.log('  Hash: NULL')
      }
    }
  }
}

main()
  .catch(console.error)
  .then(() => process.exit(0))
