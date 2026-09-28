/**
 * Run a backend command against the local Postgres container (docker-compose.dev.yml,
 * started with `db:local:up` via Podman or Docker) while still pulling every
 * OTHER secret from Doppler.
 *
 * It overrides ONLY `DATABASE_URL` and hands off to Doppler with
 * `--preserve-env`, so Doppler injects the rest of the dev config but leaves
 * our local DB URL intact. Cross-platform (no shell-specific env syntax), so it
 * works the same in PowerShell, cmd, and bash.
 *
 *   node scripts/dev-local.mjs                     -> tsx watch src/node.ts
 *   node scripts/dev-local.mjs node migrate.mjs    -> run migrations locally
 *   node scripts/dev-local.mjs tsx src/scripts/seed-rbac.ts
 *
 * Port: the container publishes on FRAMADA_DB_PORT (default 5433 — NOT 5432,
 * so it can't collide with a system Postgres or another project's container).
 * docker-compose.dev.yml reads the same variable, so the two never drift.
 * Override the whole URL with LOCAL_DATABASE_URL if your local DB differs.
 *
 * Container engine: `db:local:up` uses Podman if present, else Docker; force it
 * with FRAMADA_CONTAINER_ENGINE. This script only needs the DB reachable on the
 * port above, so it doesn't care which engine started it.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(backendDir, '..')

// Put the workspace bins on PATH so `tsx`/`drizzle-kit` resolve even when this
// script is invoked with plain `node` rather than through a pnpm script.
const binDirs = [
  path.join(backendDir, 'node_modules', '.bin'),
  path.join(repoRoot, 'node_modules', '.bin'),
]

const PORT = process.env.FRAMADA_DB_PORT ?? '5433'

// Host resolution: LOCAL_DATABASE_URL (full override) > FRAMADA_DB_HOST >
// `.db-local-host` (pinned by `db:local:up` — a Podman/WSL machine IP when
// localhost isn't forwarded) > "localhost".
function localDbHost() {
  if (process.env.FRAMADA_DB_HOST) return process.env.FRAMADA_DB_HOST
  try {
    const pinned = fs.readFileSync(path.join(backendDir, '.db-local-host'), 'utf8').trim()
    if (pinned) return pinned
  } catch {
    // not pinned — fine
  }
  return 'localhost'
}

const LOCAL_DB =
  process.env.LOCAL_DATABASE_URL ??
  `postgresql://framada:framada@${localDbHost()}:${PORT}/framada`

// Windows env vars are case-insensitive, so patch whichever key is actually set.
const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'

const passthrough = process.argv.slice(2)
const command = passthrough.length > 0 ? passthrough : ['tsx', 'watch', 'src/node.ts']

const child = spawn(
  'doppler',
  [
    'run',
    // MUST be ONE comma-separated flag: `--preserve-env` is a single string
    // flag, so passing it twice silently drops the first list and the backend
    // ends up on the remote Neon DB instead of the local container.
    '--preserve-env=DATABASE_URL,SEED_ADMIN_PASSWORD,FRAMADA_LOCAL_DB',
    '--',
    ...command,
  ],
  {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      DATABASE_URL: LOCAL_DB,
      // Tells getDb()/migrate.mjs the target is a local, no-TLS Postgres — the
      // host may be a bare IP (Podman/WSL) that the "looks local" URL regex
      // won't recognise, which would otherwise force an SSL handshake the
      // container rejects.
      FRAMADA_LOCAL_DB: '1',
      SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD || 'password123',
      [pathKey]: [...binDirs, process.env[pathKey] ?? ''].join(path.delimiter),
    },
  }
)

child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error('[dev-local] failed to launch — is the Doppler CLI installed?', err.message)
  process.exit(1)
})
