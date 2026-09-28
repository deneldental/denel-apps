/**
 * Read the account identifier out of a Better Auth request body.
 *
 * ─── Why this is not just `request.json()` ─────────────────────────────────
 *
 * The per-account throttle in `app.ts` keys on the submitted email. It used to
 * get that email with `c.req.raw.clone().json()`, which only ever succeeds for
 * a JSON body — but Better Auth does not only accept JSON:
 *
 *   - `/sign-in/email` declares
 *     `allowedMediaTypes: ["application/x-www-form-urlencoded", "application/json"]`
 *     (`better-auth/dist/api/routes/sign-in.mjs`).
 *   - `/request-password-reset` declares no `allowedMediaTypes` at all, so
 *     better-call's `getBody` sniffs the Content-Type and accepts urlencoded,
 *     multipart and text alike.
 *
 * So the same credentials sent as `application/x-www-form-urlencoded` were
 * authenticated normally by the kernel while `json()` threw, the identifier
 * stayed null, and the throttle, the failure counter AND the auth-event record
 * were all skipped. One header defeated the whole C2 remediation. This mirrors
 * better-call's parsing rules instead, so the layer that counts an attempt sees
 * exactly what the layer that authenticates it sees.
 *
 * The return type distinguishes three outcomes on purpose — the caller must
 * fail closed on anything but `found`, because "I could not attribute this
 * attempt" is precisely the bypass:
 *
 *   { kind: 'found' }         — an identifier string was read
 *   { kind: 'absent' }        — body parsed, but carried no usable identifier
 *   { kind: 'unparseable' }   — body could not be read in any supported form
 */

/** better-call's own JSON detection (`dist/utils.mjs`), including `+json` suffixes. */
const JSON_CONTENT_TYPE = /^application\/([a-z0-9.+-]*\+)?json/i

export type IdentifierResult =
  | { kind: 'found'; identifier: string }
  | { kind: 'absent' }
  | { kind: 'unparseable' }

/**
 * Extract `field` (default `email`) from `request`'s body, honouring the same
 * content types better-call will honour when it hands the body to Better Auth.
 *
 * The request is cloned, so the caller's own body stays unconsumed and the
 * kernel can still read it.
 */
export async function readAuthIdentifier(
  request: Request,
  field = 'email'
): Promise<IdentifierResult> {
  if (!request.body) return { kind: 'absent' }

  const contentType = (request.headers.get('content-type') ?? '').toLowerCase()

  try {
    if (JSON_CONTENT_TYPE.test(contentType)) {
      const body = (await request.clone().json()) as Record<string, unknown> | null
      const value = body?.[field]
      return typeof value === 'string' && value
        ? { kind: 'found', identifier: value }
        : { kind: 'absent' }
    }

    if (
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data')
    ) {
      const form = await request.clone().formData()
      const value = form.get(field)
      return typeof value === 'string' && value
        ? { kind: 'found', identifier: value }
        : { kind: 'absent' }
    }

    // No recognised Content-Type. better-call falls through to `request.text()`
    // and hands Better Auth a string, which fails its zod body schema — but a
    // *missing* Content-Type with a JSON payload is still worth attributing
    // rather than waving through, so try JSON before giving up.
    const text = await request.clone().text()
    if (!text) return { kind: 'absent' }
    const parsed = JSON.parse(text) as Record<string, unknown> | null
    const value = parsed?.[field]
    return typeof value === 'string' && value
      ? { kind: 'found', identifier: value }
      : { kind: 'absent' }
  } catch {
    return { kind: 'unparseable' }
  }
}
