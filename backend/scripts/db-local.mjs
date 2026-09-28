/**
 * db-local.mjs — bring the local dev Postgres up / down / reset with either
 * Podman or Docker. Cross-platform (PowerShell, cmd, bash); no shell-specific
 * syntax.
 *
 *   node scripts/db-local.mjs up      # start the container, wait until it accepts connections
 *   node scripts/db-local.mjs down    # stop it (the named volume survives)
 *   node scripts/db-local.mjs reset   # wipe the volume, then `up`
 *
 * Engine selection:
 *   1. $FRAMADA_CONTAINER_ENGINE   (e.g. "podman" or "docker")
 *   2. otherwise the first of `podman`, `docker` found on PATH
 *
 * The compose spec (docker-compose.dev.yml) is plain Compose and is identical
 * for both engines — only the CLI that drives it changes. `--wait` is NOT used:
 * `podman-compose` (the Python fallback provider) doesn't support it, so instead
 * we poll `pg_isready` inside the container, which every engine supports.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const COMPOSE_FILE = 'docker-compose.dev.yml'
const CONTAINER = 'framada-dev-db'
const PORT = process.env.FRAMADA_DB_PORT ?? '5433'
const READY_TIMEOUT_MS = 90_000

// `dev-local.mjs` reads this to build DATABASE_URL. Normally "localhost"; on a
// Podman/WSL machine that doesn't forward published ports to the Windows host,
// `pinHost()` writes the machine IP that IS reachable. Gitignored, per-machine.
const HOST_FILE = path.join(backendDir, '.db-local-host')

const action = process.argv[2]
if (!['up', 'down', 'reset'].includes(action)) {
  console.error('usage: node scripts/db-local.mjs <up|down|reset>')
  process.exit(2)
}

// Every token below is a trusted literal (engine name, compose file, static
// subcommands), so a shell string is safe here and sidesteps DEP0190 (passing
// an args array with `shell: true`). A shell is required on Windows so
// `podman` / `docker` resolve to their `.exe` / `.cmd` on PATH.
function sh(cmd, opts = {}) {
  return spawnSync(cmd, { shell: true, ...opts })
}

function have(bin) {
  return sh(`${bin} --version`, { stdio: 'ignore' }).status === 0
}

const engine =
  process.env.FRAMADA_CONTAINER_ENGINE?.trim() ||
  (have('podman') ? 'podman' : have('docker') ? 'docker' : null)

if (!engine) {
  console.error(
    '[db-local] neither `podman` nor `docker` is on PATH.\n' +
      '           Install Podman (https://podman.io) or Docker, or set FRAMADA_CONTAINER_ENGINE.'
  )
  process.exit(1)
}

/** Synchronous sleep — no subprocess, no busy-wait. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function compose(...args) {
  const res = sh(`${engine} compose -f ${COMPOSE_FILE} ${args.join(' ')}`, {
    stdio: 'inherit',
    cwd: backendDir,
  })
  if (res.status !== 0) process.exit(res.status ?? 1)
}

function waitForPostgres() {
  const deadline = Date.now() + READY_TIMEOUT_MS
  process.stdout.write(`[db-local] waiting for Postgres via ${engine} `)
  while (Date.now() < deadline) {
    const res = sh(`${engine} exec ${CONTAINER} pg_isready -U framada -d framada`, {
      stdio: 'ignore',
    })
    if (res.status === 0) {
      console.log('— ready')
      return
    }
    process.stdout.write('.')
    sleep(1000)
  }
  console.error(`\n[db-local] Postgres did not become ready within ${READY_TIMEOUT_MS / 1000}s`)
  process.exit(1)
}

/** Can this (host) process open a TCP connection to <host>:PORT? */
function hostCanReach(host) {
  const probe =
    `const s=require('net').connect(${PORT},${JSON.stringify(host)});s.setTimeout(2500);` +
    `s.on('connect',()=>{s.end();process.exit(0)});` +
    `s.on('timeout',()=>process.exit(1));s.on('error',()=>process.exit(1));`
  return spawnSync(process.execPath, ['-e', probe], { stdio: 'ignore' }).status === 0
}

/** All non-loopback IPv4 addresses inside the Podman machine (eth0 first). */
function podmanMachineIps() {
  // `hostname -I` isn't in the machine image; parse `ip addr` instead.
  const r = sh(`${engine} machine ssh "ip -4 -o addr show"`, { encoding: 'utf8' })
  if (r.status !== 0) return []
  const found = []
  for (const line of (r.stdout || '').split('\n')) {
    const m = line.match(/^\d+:\s+(\S+)\s+inet\s+(\d+\.\d+\.\d+\.\d+)/)
    if (m && m[1] !== 'lo' && !m[2].startsWith('127.')) found.push({ dev: m[1], ip: m[2] })
  }
  // eth0 (the WSL NAT interface Windows routes to) before the internal
  // podman-usermode / podman bridge addresses.
  found.sort((a, b) => (a.dev === 'eth0' ? -1 : b.dev === 'eth0' ? 1 : 0))
  return found.map((f) => f.ip)
}

/**
 * Decide which host `dev-local.mjs` should put in DATABASE_URL and write it to
 * `.db-local-host`. Docker (and a well-behaved Podman) forward the published
 * port to localhost; a Podman machine on WSL often does not, but a machine IP
 * is routable from the host — so probe each and use the first that answers.
 */
function pinHost() {
  let host = null
  if (hostCanReach('localhost') || hostCanReach('127.0.0.1')) {
    host = 'localhost'
  } else if (engine === 'podman') {
    host = podmanMachineIps().find((ip) => hostCanReach(ip)) ?? null
    if (host) {
      console.log(
        `[db-local] localhost:${PORT} isn't forwarded to the host on this Podman/WSL setup — ` +
          `pinning the DB host to ${host} (backend/.db-local-host).`
      )
    }
  }
  if (!host) {
    console.warn(
      `[db-local] WARNING: Postgres is up but unreachable from the host on localhost:${PORT} ` +
        `or any Podman machine IP. dev:local / db:local:setup will fail to connect.\n` +
        `           Workarounds: FRAMADA_CONTAINER_ENGINE=docker, or see ` +
        `project-docs/local-dev-database.md.`
    )
    host = 'localhost'
  }
  fs.writeFileSync(HOST_FILE, `${host}\n`)
}

if (action === 'down') {
  compose('down')
  fs.rmSync(HOST_FILE, { force: true })
} else if (action === 'reset') {
  compose('down', '-v')
  fs.rmSync(HOST_FILE, { force: true })
  compose('up', '-d')
  waitForPostgres()
  pinHost()
} else {
  compose('up', '-d')
  waitForPostgres()
  pinHost()
}
