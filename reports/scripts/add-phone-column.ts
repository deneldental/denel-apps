import { config } from 'dotenv'

config({ path: '.env.local' })

import pg from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined')
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
})

async function addPhoneColumn() {
  const client = await pool.connect()
  try {
    // Check if column already exists
    const checkResult = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'user' AND column_name = 'phone'
        `)

    if (checkResult.rows.length > 0) {
      console.log('Phone column already exists')
      return
    }

    // Add the column
    await client.query(`
            ALTER TABLE "user" ADD COLUMN "phone" text;
        `)

    console.log('Phone column added successfully')
  } catch (error) {
    console.error('Error adding phone column:', error)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

addPhoneColumn()
  .then(() => {
    console.log('Done')
    process.exit(0)
  })
  .catch((err) => {
    console.error('Failed:', err)
    process.exit(1)
  })
