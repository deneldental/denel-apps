import { config } from 'dotenv'

config({ path: '.env.local' })

import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db } from './lib/db'

async function main() {
  console.log('Running migrations...')
  await migrate(db, { migrationsFolder: './migrations' })
  console.log('Migrations complete!')
  process.exit(0)
}

main().catch((err) => {
  console.error('Migration failed!')
  console.error(err)
  process.exit(1)
})
