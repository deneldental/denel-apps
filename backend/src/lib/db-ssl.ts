/**
 * Single source of truth for "does this Postgres URL point at a local,
 * TLS-less server?".
 *
 * This predicate used to be copy-pasted into every standalone script. When
 * `db` / `framada-db-1` — the Docker Compose service and container names the
 * Hetzner VPS uses — were added to the whitelist, only some copies were
 * updated. The stale ones kept forcing `ssl: { rejectUnauthorized: false }`
 * against an in-network Postgres that does not speak TLS, so the production
 * deploy's seed step died with:
 *
 *   Error: The server does not support SSL connections
 *
 * Import from here rather than re-deriving it.
 */

const LOCAL_HOST_PATTERN =
  /@(localhost|127\.0\.0\.1|host\.docker\.internal|framada-db-1|db)([:/]|$)/

/**
 * True when the URL's host is a local/in-network Postgres with no TLS.
 *
 * `FRAMADA_LOCAL_DB=1` (set by scripts/dev-local.mjs) is an explicit override
 * for the `db:local` flow, where the host can be a bare Podman/WSL machine IP
 * the pattern above can't match — without it every seed script would force an
 * SSL handshake the container rejects.
 */
export function isLocalHostUrl(url: string): boolean {
  return process.env.FRAMADA_LOCAL_DB === '1' || LOCAL_HOST_PATTERN.test(url)
}

/**
 * The `ssl` option to hand `pg.Pool` / `pg.Client` for a given URL:
 * `false` for local hosts, permissive TLS for remote managed Postgres.
 */
export function sslOptionFor(url: string): false | { rejectUnauthorized: boolean } {
  return isLocalHostUrl(url) ? false : { rejectUnauthorized: false }
}
