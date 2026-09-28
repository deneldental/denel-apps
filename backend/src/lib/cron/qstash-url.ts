/**
 * QStash base URL normalization.
 *
 * Users frequently get this wrong in the Integrations UI — they paste the
 * regional hostname without `/v2`, or include a trailing slash. Both produce
 * a 404 "page not found" from QStash that looks like an auth failure. This
 * helper makes the common variations all work.
 */

const DEFAULT_QSTASH_BASE = 'https://qstash.upstash.io/v2'

/**
 * Normalize the QStash base URL.
 *   ''                                       → default (qstash.upstash.io/v2)
 *   'https://qstash.upstash.io'              → '/v2' auto-appended
 *   'https://qstash.upstash.io/v2/'          → trailing slash stripped
 *   'https://qstash-eu-central-1.upstash.io' → '/v2' auto-appended
 *   'http://127.0.0.1:8080/v2'               → unchanged (local dev)
 */
export function normalizeQstashBase(input: string | undefined): string {
  const trimmed = (input ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) return DEFAULT_QSTASH_BASE
  // Matches /v2, /v3, etc. — future-proof against new API versions.
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v2`
}
