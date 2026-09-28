/**
 * Turn a caught error into a client-safe message, including the underlying
 * cause chain.
 *
 * `DrizzleQueryError.message` is just "Failed query: <sql> params: <params>"
 * — the actual reason (duplicate key, FK violation, check constraint, …)
 * lives on `err.cause`, one or more levels down. Routes that returned
 * `err.message` alone reported a query dump with no explanation, undiagnosable
 * from the client without VPS/log access. Walk the chain and append each
 * cause's own message.
 *
 * Already-exposed precedent: `err.message` on a DrizzleQueryError includes the
 * full SQL and every bound parameter, so appending the Postgres error text
 * (e.g. "duplicate key value violates unique constraint …") adds nothing more
 * sensitive — these routes require an authenticated staff session already.
 */
export function errMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error) || !err.message) return fallback
  let msg = err.message
  let cause = (err as { cause?: unknown }).cause
  const seen = new Set<unknown>([err])
  while (cause instanceof Error && !seen.has(cause)) {
    seen.add(cause)
    if (cause.message) msg += ` — ${cause.message}`
    cause = (cause as { cause?: unknown }).cause
  }
  return msg
}
