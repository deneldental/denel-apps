// Keeps private files private while every screen keeps working with plain links.
//   Responses: each stored reference the server issued becomes a 60–75 minute
//              signed link; a reference whose tag does not verify never does.
//   Requests:  each of our signed links (verified) becomes its reference again.
// See project-docs/private-file-storage-design.md (4.3, 4.4).

import type { MiddlewareHandler } from 'hono'
import { bodyLimitFor } from './body-limit'
import { logError, logger } from './logger'
import {
  configuredPrivateTargets,
  createTargetCache,
  eachPrivateRef,
  MAX_LINK_AGE_MS,
  makePrivateRef,
  PRIVATE_REF_MARKER,
  PrivateFileSecretMissingError,
  refFromSignedUrl,
  replacePrivateRefs,
  signedLinkDate,
  signPrivateRef,
} from './private-files'

/**
 * Replace every reference the server issued in `text` with a signed link. A
 * reference whose tag does not verify (planted by a client) is never signed; one
 * that cannot be signed (storage not configured) is left in place. Failures are
 * logged once.
 */
export async function signPrivateRefsInText(text: string, now: Date = new Date()): Promise<string> {
  if (!text.includes(PRIVATE_REF_MARKER)) return text
  const targets = createTargetCache()
  const links = new Map<string, string>()
  let failure: unknown = null
  let untrusted = 0
  try {
    for (const { raw, ref, tagValid } of eachPrivateRef(text, { unique: true })) {
      if (!tagValid) {
        untrusted += 1
        continue
      }
      try {
        links.set(raw, await signPrivateRef(ref, now, targets))
      } catch (err) {
        failure ??= err
      }
    }
  } catch (err) {
    // PRIVATE_FILE_REF_SECRET missing: nothing can be checked, so nothing is signed.
    logError(err, { context: '[private-files] cannot check file references' })
    return text
  }
  if (failure) logError(failure, { context: '[private-files] could not sign a file reference' })
  if (untrusted > 0) {
    logger.warn(
      { untrusted },
      '[private-files] left file references the server did not issue unsigned'
    )
  }
  return replacePrivateRefs(text, links)
}

export type UnsignResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'untrusted' | 'stale' | 'too-many' }

/** A URL inside JSON text — ends at whitespace, a quote, a bracket or a backslash. */
const URL_PATTERN = /https:\/\/[^\s"'<>\\]+/g

/**
 * Screens send a handful of files per save; more than this many distinct links
 * or references is not a screen. It also bounds the work done on a body before
 * anyone has signed in.
 */
export const MAX_LINKS_PER_REQUEST = 200

/**
 * Turn each of our signed links in `text` into its reference. Refused
 * (`ok: false`): a raw reference whose tag does not verify, a genuine link older
 * than MAX_LINK_AGE_MS, or more than MAX_LINKS_PER_REQUEST distinct links or
 * references. Checking stops at the first refusal.
 */
export async function unsignPrivateUrlsInText(
  text: string,
  now: Date = new Date()
): Promise<UnsignResult> {
  let references = 0
  for (const found of eachPrivateRef(text, { unique: true })) {
    if (!found.tagValid) return { ok: false, reason: 'untrusted' }
    references += 1
    if (references > MAX_LINKS_PER_REQUEST) return { ok: false, reason: 'too-many' }
  }
  if (!text.includes('X-Amz-Signature')) return { ok: true, text }

  const candidates = new Set<string>()
  for (const [candidate] of text.matchAll(URL_PATTERN)) {
    if (!candidate.includes('X-Amz-Signature')) continue
    candidates.add(candidate)
    if (candidates.size > MAX_LINKS_PER_REQUEST) return { ok: false, reason: 'too-many' }
  }

  const targets = await configuredPrivateTargets()
  if (targets.length === 0) return { ok: true, text }

  const refs = new Map<string, string>()
  for (const candidate of candidates) {
    // Rich-text editors serialise `&` inside attributes as `&amp;`.
    const url = candidate.replaceAll('&amp;', '&')
    const ref = await refFromSignedUrl(url, targets)
    if (!ref) continue
    const signedAt = signedLinkDate(url)
    if (!signedAt || now.getTime() - signedAt.getTime() > MAX_LINK_AGE_MS) {
      return { ok: false, reason: 'stale' }
    }
    refs.set(candidate, makePrivateRef(ref.provider, ref.key))
  }
  if (refs.size === 0) return { ok: true, text }
  return { ok: true, text: text.replace(URL_PATTERN, (url) => refs.get(url) ?? url) }
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const REFUSALS = {
  untrusted: {
    status: 400,
    error: 'This request contains a file reference the server did not issue',
  },
  stale: { status: 409, error: 'This page is out of date — reload it and save again' },
  'too-many': { status: 400, error: 'This request contains too many file links' },
  'too-deep': { status: 400, error: 'This request is nested too deeply to check' },
  'too-large': { status: 413, error: 'Payload too large' },
  'not-set-up': { status: 503, error: 'Private files are not set up on this server yet' },
} as const

/**
 * The body as a route will see it: JSON escapes (escaped slashes, unicode
 * escapes) undone, so neither a link nor a reference can hide behind them.
 * Non-JSON text is returned as is. Null: valid JSON too deeply nested to
 * re-serialise — it cannot be checked, so it is refused.
 */
function canonicalBody(text: string): string | null {
  if (!text.includes('\\')) return text
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return text
  }
  try {
    return JSON.stringify(parsed)
  } catch {
    return null
  }
}

/** The request's boundary, when its Content-Type says multipart. */
function multipartBoundary(contentType: string): string | null {
  if (!contentType.toLowerCase().includes('multipart/form-data')) return null
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)
  return match ? (match[1] ?? match[2]) : null
}

/**
 * Whether the body really starts like a multipart upload with this boundary.
 * Only the first bytes are read, so large uploads are not buffered here.
 */
async function isRealMultipart(request: Request, boundary: string): Promise<boolean> {
  const reader = request.clone().body?.getReader()
  if (!reader) return false
  const expected = `--${boundary}`
  let head = ''
  try {
    while (head.length < expected.length + 2) {
      const { done, value } = await reader.read()
      if (done) break
      head += Buffer.from(value).toString('latin1')
    }
  } finally {
    // Not awaited: cancelling one copy of a tee'd body only settles once the
    // other copy — the one the route reads next — is read, so waiting deadlocks.
    void reader.cancel().catch(() => {})
  }
  return head.replace(/^(\r\n)+/, '').startsWith(expected)
}

/** The body as text, or null when it is larger than `limit` bytes. */
async function readBodyCapped(request: Request, limit: number): Promise<string | null> {
  const reader = request.clone().body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      void reader.cancel().catch(() => {}) // not awaited — see isRealMultipart
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function privateFileLinks(): MiddlewareHandler {
  return async (c, next) => {
    // Every write body a route could parse — whatever its Content-Type claims
    // (`c.req.json()` ignores it). Only a body that really is a multipart
    // upload is skipped (file bytes; references planted there are never signed
    // or read, since both check the tag). Sign-in bodies carry credentials.
    if (WRITE_METHODS.has(c.req.method) && !c.req.path.startsWith('/api/auth/')) {
      const boundary = multipartBoundary(c.req.header('content-type') ?? '')
      const multipart = boundary !== null && (await isRealMultipart(c.req.raw, boundary))
      if (!multipart) {
        const check = await checkRequestBody(c.req.raw, c.req.path)
        if ('refuse' in check) return c.json({ error: check.refuse.error }, check.refuse.status)
        if (check.rewrite !== null) {
          const headers = new Headers(c.req.raw.headers)
          headers.delete('content-length')
          c.req.raw = new Request(c.req.raw.url, {
            method: c.req.method,
            headers,
            body: check.rewrite,
          })
          c.req.bodyCache = {}
        }
      }
    }

    await next()

    // A backup export (settings, table export) keeps the permanent references,
    // so the file can be re-imported any time later.
    if (c.get('keepPrivateRefs')) return
    const res = c.res
    if (!res.body || !(res.headers.get('content-type') ?? '').includes('application/json')) return
    const text = await res.clone().text()
    if (!text.includes(PRIVATE_REF_MARKER)) return
    const signed = await signPrivateRefsInText(text)
    if (signed === text) return

    const headers = new Headers(res.headers)
    headers.delete('content-length')
    // Clear first: Hono's `res` setter would otherwise copy the old headers —
    // including the stale Content-Length — onto the new response.
    c.res = undefined
    c.res = new Response(signed, { status: res.status, statusText: res.statusText, headers })
  }
}

type Refusal = (typeof REFUSALS)[keyof typeof REFUSALS]

/**
 * Check one non-multipart request body: a refusal to send, or the rewritten
 * body (null: pass the request through unchanged).
 */
async function checkRequestBody(
  request: Request,
  path: string
): Promise<{ refuse: Refusal } | { rewrite: string | null }> {
  const raw = await readBodyCapped(request, bodyLimitFor(path))
  if (raw === null) return { refuse: REFUSALS['too-large'] }
  const text = canonicalBody(raw)
  if (text === null) return { refuse: REFUSALS['too-deep'] }
  if (!text.includes('X-Amz-Signature') && !text.includes(PRIVATE_REF_MARKER)) {
    return { rewrite: null }
  }
  let result: UnsignResult
  try {
    result = await unsignPrivateUrlsInText(text)
  } catch (err) {
    if (err instanceof PrivateFileSecretMissingError) return { refuse: REFUSALS['not-set-up'] }
    throw err
  }
  if (!result.ok) return { refuse: REFUSALS[result.reason] }
  return { rewrite: result.text === text ? null : result.text }
}
