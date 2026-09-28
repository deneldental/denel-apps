import { config } from 'dotenv'

config({ path: '.env.local' })

import pg from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined')
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
})

async function addPaymentBalanceColumn() {
  const client = await pool.connect()
  try {
    // Check if column exists
    const result = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'payments' AND column_name = 'balance'
        `)

    if (result.rows.length > 0) {
      console.log('✅ Balance column already exists:', result.rows[0])
    } else {
      console.log('❌ Balance column does NOT exist')
      console.log('Adding column...')
      await client.query(`ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "balance" integer;`)
      console.log('✅ Balance column added successfully')
    }
  } catch (error) {
    console.error('Error:', error)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

addPaymentBalanceColumn()
  .then(() => {
    console.log('\n✅ Migration complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Migration failed:', error)
    process.exit(1)
  })
