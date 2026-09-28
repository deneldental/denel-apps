import * as dotenv from 'dotenv'
import { Pool } from 'pg'

dotenv.config({ path: '.dev.vars' })

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://framada:framada@localhost:5432/framada'
if (!DATABASE_URL) throw new Error('DATABASE_URL environment variable is required')

const cleanUrl = DATABASE_URL.replace(/([?&])sslmode=[^&]*/g, '$1')
  .replace(/[?&]$/, '')
  .replace(/\?&/, '?')

const isLocal = cleanUrl.includes('localhost') || cleanUrl.includes('127.0.0.1')
const pool = new Pool({
  connectionString: cleanUrl,
  ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
})

async function main() {
  console.log('Adding isSystem to patient_tags...')
  try {
    await pool.query(
      `ALTER TABLE patient_tags ADD COLUMN IF NOT EXISTS "isSystem" boolean NOT NULL DEFAULT false;`
    )
    console.log('Success')
  } catch (err) {
    console.error(err)
  }
  process.exit(0)
}

main()
