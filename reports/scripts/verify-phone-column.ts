import { config } from 'dotenv'

config({ path: '.env.local' })

import pg from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined')
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
})

async function verifyPhoneColumn() {
  const client = await pool.connect()
  try {
    // Check if column exists
    const result = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'user' AND column_name = 'phone'
        `)

    if (result.rows.length > 0) {
      console.log('✅ Phone column exists:', result.rows[0])
    } else {
      console.log('❌ Phone column does NOT exist')
      console.log('Adding column...')
      await client.query(`ALTER TABLE "user" ADD COLUMN "phone" text;`)
      console.log('✅ Phone column added')
    }

    // Also check all columns in user table
    const allColumns = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'user'
            ORDER BY ordinal_position
        `)
    console.log('\nAll columns in user table:')
    allColumns.rows.forEach((col) => {
      console.log(`  - ${col.column_name} (${col.data_type})`)
    })
  } catch (error) {
    console.error('Error:', error)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

verifyPhoneColumn()
  .then(() => {
    console.log('\n✅ Verification complete')
    process.exit(0)
  })
  .catch((err) => {
    console.error('❌ Failed:', err)
    process.exit(1)
  })
