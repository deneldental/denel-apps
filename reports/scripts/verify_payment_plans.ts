import { sql } from 'drizzle-orm'
import { db } from '../lib/db'
import { paymentPlans } from '../lib/db/schema'

async function verify() {
  const result = await db.select({ count: sql<number>`count(*)` }).from(paymentPlans)
  console.log('Total payment plans:', result[0].count)

  const sample = await db.query.paymentPlans.findFirst()
  console.log('Sample plan:', JSON.stringify(sample, null, 2))
  process.exit(0)
}

verify().catch(console.error)
