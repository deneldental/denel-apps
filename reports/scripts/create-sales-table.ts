import { config } from 'dotenv'
import pg from 'pg'

config({ path: '.env.local' })

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const sql = `
CREATE TABLE IF NOT EXISTS "sales" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "productId" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
    "quantity" integer NOT NULL,
    "unitPrice" integer NOT NULL,
    "costPrice" integer NOT NULL,
    "totalAmount" integer NOT NULL,
    "profit" integer NOT NULL,
    "saleDate" timestamp DEFAULT now() NOT NULL,
    "createdAt" timestamp DEFAULT now() NOT NULL
);
`

pool
  .query(sql)
  .then(() => {
    console.log('Sales table created successfully')
    pool.end()
  })
  .catch((e) => {
    console.error('Error:', e.message)
    pool.end()
  })
