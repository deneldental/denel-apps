/**
 * Which database is this process actually talking to?
 *
 * Local dev has two live candidates — the local container Postgres (`db:local:up`,
 * Podman or Docker) and the Neon `framada-dev` branch — and which one you get
 * depends on how the server was launched (`doppler run -- pnpm dev` → Neon,
 * `scripts/dev-local.mjs` → the local container).
 * That is invisible from the UI, and guessing wrong costs real debugging time:
 * you can "fix" a schema drift in one database while the server reads the other.
 *
 * This classifies the connection by hostname alone. It never returns the URL,
 * the credentials, or the host itself — only a coarse provider label.
 */

export type DbProvider = 'docker' | 'neon' | 'digitalocean' | 'unknown'

export type DbFlavor = {
  provider: DbProvider
  /** Display label for the dev-only indicator pill. */
  label: string
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal'])

/**
 * Classify a Postgres connection string. Unparseable input is `unknown` rather
 * than a throw — this only ever feeds a diagnostic badge, so it must not be able
 * to take down the healthcheck.
 */
export function describeDbFlavor(databaseUrl: string | undefined): DbFlavor {
  if (!databaseUrl) return { provider: 'unknown', label: 'Unknown' }

  let hostname: string
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase()
  } catch {
    return { provider: 'unknown', label: 'Unknown' }
  }

  if (LOCAL_HOSTS.has(hostname)) return { provider: 'docker', label: 'Docker' }
  if (hostname.endsWith('.neon.tech')) return { provider: 'neon', label: 'Neon' }
  if (hostname.endsWith('.ondigitalocean.com')) {
    return { provider: 'digitalocean', label: 'DigitalOcean' }
  }
  return { provider: 'unknown', label: 'Unknown' }
}
