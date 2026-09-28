import { config } from 'dotenv'
import pg from 'pg'

config({ path: '.env.local' })

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const sql = `ALTER TABLE "products" ALTER COLUMN "costPrice" DROP NOT NULL;`

pool
  .query(sql)
  .then(() => {
    console.log('costPrice column made nullable successfully')
    pool.end()
  })
  .catch((e) => {
    console.error('Error:', e.message)
    pool.end()
  })
