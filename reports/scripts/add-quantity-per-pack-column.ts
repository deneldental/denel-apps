import { config } from 'dotenv'
import pg from 'pg'

config({ path: '.env.local' })

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const sql = `
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "quantityPerPack" integer DEFAULT 1 NOT NULL;
`

pool
  .query(sql)
  .then(() => {
    console.log('quantityPerPack column added successfully')
    pool.end()
  })
  .catch((e) => {
    console.error('Error:', e.message)
    pool.end()
  })
