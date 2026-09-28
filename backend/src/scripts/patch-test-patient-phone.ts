import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../db/schema'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is required')

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
const db = drizzle(pool, { schema })

async function main() {
  const [updated] = await db
    .update(schema.patients)
    .set({ phone: '0553424972', updatedAt: new Date() })
    .where(eq(schema.patients.patientId, '#FDM000001'))
    .returning({ patientId: schema.patients.patientId, phone: schema.patients.phone })

  console.log(updated ?? 'Patient #FDM000001 not found — run the seed first')
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
