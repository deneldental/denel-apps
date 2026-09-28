import { config } from 'dotenv'

config({ path: '.dev.vars' })

import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { migrate } from 'drizzle-orm/neon-http/migrator'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set in .dev.vars')
  process.exit(1)
}

async function main() {
  console.log('Connecting to database...')
  const sql = neon(DATABASE_URL)
  const db = drizzle(sql)

  console.log('Running migrations...')
  await migrate(db, { migrationsFolder: './migrations' })
  console.log('Migrations complete!')
  process.exit(0)
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
