import { config } from 'dotenv'

config({ path: '.env.local' })

import { eq } from 'drizzle-orm'
import { db } from '../lib/db'
import { account } from '../lib/db/schema'

async function main() {
  console.log('--- START DEBUG ---')
  const users = await db.query.user.findMany()
  for (const u of users) {
    console.log(`USER: ${u.email}`)
    const accounts = await db.select().from(account).where(eq(account.userId, u.id))
    if (accounts.length === 0) console.log('  NO ACCOUNT')
    for (const acc of accounts) {
      const p = acc.password || 'NULL'
      console.log(`  HASH_PREFIX: ${p.substring(0, 15)}`)
      console.log(`  FULL_LENGTH: ${p.length}`)
    }
  }
  console.log('--- END DEBUG ---')
}
main()
  .catch((e) => console.error(e))
  .then(() => process.exit(0))
