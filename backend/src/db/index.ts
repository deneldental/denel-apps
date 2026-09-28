import { setDefaultResultOrder } from 'node:dns'
import { Pool as NeonPool, neonConfig, types as neonTypes } from '@neondatabase/serverless'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool, types as pgTypes } from 'pg'
import ws from 'ws'
import { logError } from '../lib/logger'
import * as schema from './schema'

// The Neon serverless driver talks to Neon over a WebSocket. In a Node runtime
// (as opposed to an edge runtime with a built-in global) it needs a WebSocket
// implementation supplied explicitly. Node 20 — our pinned runtime — has no
// stable global WebSocket, so we wire up the `ws` package. This is required for
// `db.transaction()` to work: the neon-http driver does NOT support
// transactions, so any transactional write path 500s under it.
neonConfig.webSocketConstructor = ws

// Force IPv4-first DNS resolution. Without this, Node may pick an AAAA
// address for hosts like Neon and silently hang on networks where IPv6
// outbound is blocked. Equivalent to NODE_OPTIONS=--dns-result-order=ipv4first
// but applied in-process so it can't be missed by the shell.
setDefaultResultOrder('ipv4first')

// Money columns use `numeric(15, 2)`. By default node-postgres returns
// numerics as strings to preserve precision; that would break every existing
// route that does arithmetic on `invoice.amount`, `payment.amount`, etc.
// Clinic-scale balances fit comfortably in a JS number (max safe integer
// covers ~90 trillion GHS), so we parse numerics as floats. Code paths that
// accumulate hundreds of operations should still go through the `Money`
// helper in `@denel/utils` to avoid float drift.
// OID 1700 is Postgres NUMERIC.
pgTypes.setTypeParser(1700, (value) => Number(value))
// The Neon serverless driver bundles its own copy of pg-types and does not see
// the parser registered above on node-postgres' `pg`. Register the same NUMERIC
// parser on Neon's registry so raw `sql` queries return numbers on the Neon
// (dev/staging) path, matching the node-postgres (production) path. (Drizzle
// still maps declared `numeric` columns to strings on both drivers — this only
// affects raw query results.)
neonTypes.setTypeParser(1700, (value: string) => Number(value))

export type DB = NodePgDatabase<typeof schema>

// One pool per connection string — reused across requests instead of
// creating a new connection on every request.
const pools = new Map<string, DB>()

// Strip sslmode from the URL — newer pg versions treat sslmode=require as
// verify-full, which fails against DigitalOcean/Neon self-signed CA certs.
// We handle SSL explicitly via { ssl: { rejectUnauthorized: false } } instead.
function stripSslMode(url: string): string {
  return url
    .replace(/([?&])sslmode=[^&]*/g, '$1')
    .replace(/[?&]$/, '')
    .replace(/\?&/, '?')
}

export function getDb(connectionString: string): DB {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not defined.')
  }
  if (!pools.has(connectionString)) {
    if (connectionString.includes('.neon.tech')) {
      // Neon: use the WebSocket serverless driver. Unlike the neon-http driver
      // it supports `db.transaction()` (required by the payment/journal/invoice
      // write paths), while still handling Neon's compute suspension gracefully
      // — the pool reconnects on the next checkout instead of crashing.
      //
      // Pool options match the node-postgres branch below so dev/staging (Neon)
      // and production (DO Postgres) have the same concurrency behaviour and
      // one predicts the other. `NeonPool` extends node-postgres' `Pool`, so it
      // takes the same config.
      //
      // `idleTimeoutMillis` is the one that actually matters here. The pg
      // default is 10 s, and a WebSocket connect to Neon costs 0.6–3.2 s
      // (measured), so on the sparse request pattern of local dev every request
      // arriving >10 s after the last one paid a full reconnect. Holding idle
      // sockets for 30 s instead keeps them warm across a working session; a
      // steady-state query then round-trips in ~140 ms, the same as raw pg.
      //
      // `keepAlive` is a TCP-socket option that the Neon WS client does not use
      // (its transport is a WebSocket, not a raw socket). It is passed anyway so
      // the two branches stay literally comparable; it is inert, not harmful.
      const neonPool = new NeonPool({
        connectionString: stripSslMode(connectionString),
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 30_000,
        keepAlive: true,
      })
      neonPool.on('error', (err: Error) => {
        logError(err, { context: '[db] idle neon client error' })
      })
      pools.set(connectionString, drizzleNeon(neonPool, { schema }) as unknown as DB)
    } else {
      // A local Postgres (the opt-in `dev:local` flow) has no TLS, so only force
      // SSL for remote hosts. Production (DO managed Postgres) is non-localhost,
      // so it keeps SSL exactly as before. `FRAMADA_LOCAL_DB=1` (set by
      // scripts/dev-local.mjs) covers the case where the host is a bare
      // Podman/WSL machine IP the URL regex can't recognise.
      const isLocalHost =
        process.env.FRAMADA_LOCAL_DB === '1' ||
        /@(localhost|127\.0\.0\.1|host\.docker\.internal|framada-db-1|db)([:/]|$)/.test(
          connectionString
        )
      const pool = new Pool({
        connectionString: stripSslMode(connectionString),
        ssl: isLocalHost ? false : { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 30_000,
        keepAlive: true,
      })
      // Swallow background pool errors so a single dropped idle connection
      // doesn't crash the process — the next checkout will create a fresh client.
      pool.on('error', (err) => {
        logError(err, { context: '[db] idle pg client error' })
      })
      pools.set(connectionString, drizzle(pool, { schema }))
    }
  }
  return pools.get(connectionString)!
}

export { schema }
