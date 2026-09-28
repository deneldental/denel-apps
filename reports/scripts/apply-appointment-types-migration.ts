import { config } from 'dotenv'

config({ path: '.env.local' })

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined')
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

async function applyMigration() {
  try {
    const sql = readFileSync(
      join(process.cwd(), 'migrations', '0015_add_appointment_types.sql'),
      'utf-8'
    )

    console.log('Applying migration: 0015_add_appointment_types.sql')
    await pool.query(sql)
    console.log('Migration applied successfully!')
  } catch (error) {
    console.error('Migration failed!', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

applyMigration()
