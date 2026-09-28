import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'

async function applyMigration() {
  try {
    const migrationPath = join(process.cwd(), 'migrations', '0026_add_better_auth_admin_fields.sql')
    const migrationSQL = readFileSync(migrationPath, 'utf-8')

    console.log('Applying migration: 0026_add_better_auth_admin_fields.sql')
    console.log('SQL:', migrationSQL)

    // Split by semicolon and execute each statement
    const statements = migrationSQL.split(';').filter((s) => s.trim().length > 0)

    for (const statement of statements) {
      if (statement.trim()) {
        console.log('Executing:', statement.trim())
        await db.execute(sql.raw(statement.trim()))
      }
    }

    console.log('Migration applied successfully!')
    process.exit(0)
  } catch (error) {
    console.error('Error applying migration:', error)
    process.exit(1)
  }
}

applyMigration()
