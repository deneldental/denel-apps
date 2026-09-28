import { config } from 'dotenv'

config({ path: '.env.local' })
config({ path: '.env' })

import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { DEFAULT_CONNECTION_TIMEOUT, DEFAULT_IDLE_TIMEOUT, DEFAULT_POOL_SIZE } from '../constants'
import { logger } from '../logger'

import * as schema from './schema'

const connectionString = process.env.DATABASE_URL || process.env.STAGING_DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is not defined')
}

console.log(`[DB] Environment: ${process.env.NODE_ENV}`)
console.log(
  `[DB] Using: ${process.env.NODE_ENV === 'production' ? 'Production' : 'Staging'} Database`
)

const globalForDb = globalThis as unknown as {
  pool: pg.Pool | undefined
}

const pool =
  globalForDb.pool ??
  new pg.Pool({
    connectionString,
    max: DEFAULT_POOL_SIZE,
    idleTimeoutMillis: DEFAULT_IDLE_TIMEOUT,
    connectionTimeoutMillis: DEFAULT_CONNECTION_TIMEOUT,
  })

// Only attach listeners if creating a new pool to avoid duplicate listeners on hot reload
if (!globalForDb.pool) {
  // Log pool errors
  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected database pool error')
  })

  // Log when pool is connected
  pool.on('connect', () => {
    logger.debug('New database client connected')
  })
}

if (process.env.NODE_ENV !== 'production') {
  globalForDb.pool = pool
}

export const db = drizzle(pool, { schema })
