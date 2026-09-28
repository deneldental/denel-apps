import { neon } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '.env.local' })

const sql = neon(process.env.DATABASE_URL!)

async function createSequence() {
  try {
    console.log('Creating patient_id_seq sequence...')

    // Create the sequence
    await sql`CREATE SEQUENCE IF NOT EXISTS patient_id_seq START WITH 1`

    console.log('✓ Sequence created successfully')

    // Get the current max patient number
    const result = await sql`
      SELECT COALESCE(MAX(CAST(SUBSTRING("patientId" FROM '#FDM([0-9]+)') AS INTEGER)), 0) as max_num
      FROM patients
      WHERE "patientId" IS NOT NULL AND "patientId" ~ '^#FDM[0-9]+$'
    `

    const maxNum = result[0]?.max_num || 0
    console.log(`Current max patient number: ${maxNum}`)

    // Set the sequence to start from max + 1
    await sql`SELECT setval('patient_id_seq', ${maxNum + 1}, false)`

    console.log(`✓ Sequence initialized to start from ${maxNum + 1}`)
    console.log('\nSequence setup complete!')
  } catch (error) {
    console.error('Error creating sequence:', error)
    process.exit(1)
  }
}

createSequence()
