import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'

async function applyMigration() {
  try {
    const migrationPath = join(process.cwd(), 'migrations', '0024_add_user_role_field.sql')
    const migrationSQL = readFileSync(migrationPath, 'utf-8')

    console.log('Applying migration: 0024_add_user_role_field.sql')
    console.log('SQL:', migrationSQL)

    const result = await db.execute(sql.raw(migrationSQL))

    console.log('Migration applied successfully!')
    console.log('Result:', result)
    process.exit(0)
  } catch (error) {
    console.error('Error applying migration:', error)
    process.exit(1)
  }
}

applyMigration()
