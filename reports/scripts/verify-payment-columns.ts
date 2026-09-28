import { config } from 'dotenv'

config({ path: '.env.local' })

import pg from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined')
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
})

async function verifyPaymentColumns() {
  const client = await pool.connect()
  try {
    // Check if paymentPlanId column exists
    const paymentPlanIdCheck = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'payments' AND column_name = 'paymentPlanId'
        `)

    if (paymentPlanIdCheck.rows.length === 0) {
      console.log('❌ paymentPlanId column does NOT exist')
      console.log('Adding paymentPlanId column...')
      await client.query(`
                ALTER TABLE "payments" ADD COLUMN "paymentPlanId" uuid;
            `)
      console.log('✅ paymentPlanId column added')
    } else {
      console.log('✅ paymentPlanId column exists:', paymentPlanIdCheck.rows[0])
    }

    // Check if sendNotification column exists
    const sendNotificationCheck = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'payments' AND column_name = 'sendNotification'
        `)

    if (sendNotificationCheck.rows.length === 0) {
      console.log('❌ sendNotification column does NOT exist')
      console.log('Adding sendNotification column...')
      await client.query(`
                ALTER TABLE "payments" ADD COLUMN "sendNotification" boolean DEFAULT false NOT NULL;
            `)
      console.log('✅ sendNotification column added')
    } else {
      console.log('✅ sendNotification column exists:', sendNotificationCheck.rows[0])
    }

    // Add foreign key constraint if it doesn't exist
    const fkCheck = await client.query(`
            SELECT constraint_name
            FROM information_schema.table_constraints 
            WHERE constraint_name = 'payments_paymentPlanId_payment_plans_id_fk'
        `)

    if (fkCheck.rows.length === 0) {
      console.log('Adding foreign key constraint...')
      await client.query(`
                ALTER TABLE "payments" 
                ADD CONSTRAINT "payments_paymentPlanId_payment_plans_id_fk" 
                FOREIGN KEY ("paymentPlanId") 
                REFERENCES "public"."payment_plans"("id") 
                ON DELETE set null ON UPDATE no action;
            `)
      console.log('✅ Foreign key constraint added')
    } else {
      console.log('✅ Foreign key constraint already exists')
    }

    // Show all columns in payments table
    const allColumns = await client.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'payments'
            ORDER BY ordinal_position
        `)
    console.log('\nAll columns in payments table:')
    allColumns.rows.forEach((col) => {
      console.log(
        `  - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`
      )
    })
  } catch (error) {
    console.error('Error:', error)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

verifyPaymentColumns()
  .then(() => {
    console.log('\n✅ Verification complete')
    process.exit(0)
  })
  .catch((err) => {
    console.error('Verification failed:', err)
    process.exit(1)
  })
