// Private file references — the permanent value stored for a file kept in the
// private bucket. Screens never see one: lib/private-file-links.ts turns
// references into short-lived signed links on the way out and our signed links
// back into references on the way in. See project-docs/private-file-storage-design.md.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../config/env'
import { getPrivateTarget, type PrivateProvider, type PrivateTarget } from './storage-providers'

export type { PrivateProvider, PrivateTarget }
export type PrivateRef = { provider: PrivateProvider; key: string }

/** Every reference starts with this — a cheap test before any parsing. */
export const PRIVATE_REF_MARKER = 'private-file://'

/** A whole reference inside any text: JSON, an HTML attribute, a plain value. */
const PRIVATE_REF_PATTERN = /private-file:\/\/(r2|do_spaces)\/([A-Za-z0-9._~%/-]+)#([0-9a-f]{16})/g

/** Private files cannot be stored or shown: PRIVATE_FILE_REF_SECRET is not set. */
export class PrivateFileSecretMissingError extends Error {
  constructor() {
    super(
      'PRIVATE_FILE_REF_SECRET is not set — private files cannot be stored or shown until it is (Doppler; see project-docs/secrets-and-integrations.md)'
    )
    this.name = 'PrivateFileSecretMissingError'
  }
}

let cachedTagKey: { secret: string; key: Buffer } | null = null

/**
 * Keyed by its own secret, not the sign-in one: rotating BETTER_AUTH_SECRET must
 * not make every stored file unviewable. Derived once per secret value.
 */
function tagKey(): Buffer {
  const secret = env.PRIVATE_FILE_REF_SECRET
  if (!secret) throw new PrivateFileSecretMissingError()
  if (cachedTagKey?.secret !== secret) {
    cachedTagKey = {
      secret,
      key: createHash('sha256').update(`denel.private-file-ref.v1:${secret}`, 'utf8').digest(),
    }
  }
  return cachedTagKey.key
}

function tagFor(provider: PrivateProvider, key: string): string {
  return createHmac('sha256', tagKey())
    .update(`${provider}/${key}`, 'utf8')
    .digest('hex')
    .slice(0, 16)
}

/** Percent-encode each path segment — plus ! ' ( ) *, so no quote or bracket survives. */
function encodeKey(key: string): string {
  return key
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
      )
    )
    .join('/')
}

export function decodeKey(encoded: string): string | null {
  try {
    return encoded
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/')
  } catch {
    return null
  }
}

export function makePrivateRef(provider: PrivateProvider, key: string): string {
  return `${PRIVATE_REF_MARKER}${provider}/${encodeKey(key)}#${tagFor(provider, key)}`
}

export type FoundRef = { raw: string; ref: PrivateRef; tagValid: boolean }

/**
 * Every well-formed reference in `text`, in order — one at a time, so a caller
 * can stop at the first one that fails. With `unique`, a repeated reference is
 * skipped before its tag is computed.
 */
export function* eachPrivateRef(
  text: string,
  { unique = false }: { unique?: boolean } = {}
): Generator<FoundRef> {
  const seen = new Set<string>()
  for (const match of text.matchAll(PRIVATE_REF_PATTERN)) {
    if (unique) {
      if (seen.has(match[0])) continue
      seen.add(match[0])
    }
    const provider = match[1] as PrivateProvider
    const key = decodeKey(match[2])
    if (key === null) continue
    const tagValid = timingSafeEqual(
      Buffer.from(tagFor(provider, key), 'utf8'),
      Buffer.from(match[3], 'utf8')
    )
    yield { raw: match[0], ref: { provider, key }, tagValid }
  }
}

/** Every well-formed reference in `text`, in order, duplicates included. */
export function findPrivateRefs(text: string): FoundRef[] {
  return [...eachPrivateRef(text)]
}

/**
 * A value that is exactly one reference this server issued (its tag verifies),
 * or null. A stored value can have been planted by a client through a path the
 * request layer does not see, so the tag is always checked.
 */
export function parsePrivateRef(value: string): PrivateRef | null {
  const [first] = findPrivateRefs(value)
  return first && first.raw === value && first.tagValid ? first.ref : null
}

/** Swap each reference for its replacement (keyed by the raw reference text). */
export function replacePrivateRefs(text: string, replacement: Map<string, string>): string {
  return text.replace(PRIVATE_REF_PATTERN, (raw) => replacement.get(raw) ?? raw)
}

// ── Signed links ────────────────────────────────────────────────────────────

export const LINK_WINDOW_MS = 15 * 60 * 1000
export const LINK_EXPIRES_SECONDS = 75 * 60

/**
 * Start of the 15-minute window `now` falls in. Links signed in the same window
 * are identical (the browser can cache the image) and valid 60–75 minutes.
 */
export function signingWindowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / LINK_WINDOW_MS) * LINK_WINDOW_MS)
}

function presign(
  target: PrivateTarget,
  key: string,
  signingDate: Date,
  expiresIn: number
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: target.bucket, Key: key })
  // biome-ignore lint/suspicious/noExplicitAny: AWS SDK presigner typings mismatch
  return getSignedUrl(target.client as any, command as any, { expiresIn, signingDate })
}

/** Per-response memo of the private targets, so settings are read once. */
export type TargetCache = { get(provider: PrivateProvider): Promise<PrivateTarget> }

export function createTargetCache(): TargetCache {
  const cache = new Map<PrivateProvider, Promise<PrivateTarget>>()
  return {
    get(provider) {
      let target = cache.get(provider)
      if (!target) {
        target = getPrivateTarget(provider)
        cache.set(provider, target)
      }
      return target
    },
  }
}

export async function signPrivateRef(
  ref: PrivateRef,
  now: Date,
  targets: TargetCache
): Promise<string> {
  const target = await targets.get(ref.provider)
  return presign(target, ref.key, signingWindowStart(now), LINK_EXPIRES_SECONDS)
}

/** Every private target that is configured right now (missing ones are skipped). */
export async function configuredPrivateTargets(): Promise<PrivateTarget[]> {
  const results = await Promise.allSettled([getPrivateTarget('r2'), getPrivateTarget('do_spaces')])
  return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
}

function parseAmzDate(value: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value)
  if (!m) return null
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
}

const prefixCache = new WeakMap<PrivateTarget, Promise<string>>()

/**
 * What our signer puts before a key: `https://<bucket>.<host>/`. Worked out once
 * per target object (targets are built per request), so checking many links in
 * one request costs one probe, not one per link.
 */
function signedUrlPrefix(target: PrivateTarget): Promise<string> {
  let prefix = prefixCache.get(target)
  if (!prefix) {
    prefix = presign(target, 'probe', new Date(0), 60).then((url) => {
      const probe = new URL(url)
      return `${probe.origin}${probe.pathname.slice(0, -'probe'.length)}`
    })
    prefixCache.set(target, prefix)
  }
  return prefix
}

/** How old a genuine link may be when a form sends it back (spec 4.4). */
export const MAX_LINK_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** The moment a signed link was signed (its `X-Amz-Date`), or null. */
export function signedLinkDate(url: string): Date | null {
  try {
    const amzDate = new URL(url).searchParams.get('X-Amz-Date')
    return amzDate ? parseAmzDate(amzDate) : null
  } catch {
    return null
  }
}

/** SigV4's ceiling; the SDK refuses to presign beyond it. */
const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60

/**
 * The reference behind one of our signed links, or null. The signature is
 * recomputed with our credentials for the link's own key, date and expiry, so a
 * fabricated or altered link never converts. Expiry is deliberately not checked:
 * a form left open past the hour must still save the right file.
 */
export async function refFromSignedUrl(
  url: string,
  targets: PrivateTarget[]
): Promise<PrivateRef | null> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const signature = parsed.searchParams.get('X-Amz-Signature')
  const amzDate = parsed.searchParams.get('X-Amz-Date')
  const expires = Number(parsed.searchParams.get('X-Amz-Expires'))
  const signingDate = amzDate ? parseAmzDate(amzDate) : null
  if (!signature || !signingDate || !Number.isInteger(expires)) return null
  // A client-supplied expiry outside SigV4's range is never one of ours — and
  // would make the SDK throw, turning a bad link into a 500.
  if (expires <= 0 || expires > MAX_PRESIGN_SECONDS) return null

  const base = `${parsed.origin}${parsed.pathname}`
  for (const target of targets) {
    const prefix = await signedUrlPrefix(target)
    if (!base.startsWith(prefix)) continue
    const key = decodeKey(base.slice(prefix.length))
    if (!key) continue
    let expected: string | null
    try {
      expected = new URL(await presign(target, key, signingDate, expires)).searchParams.get(
        'X-Amz-Signature'
      )
    } catch {
      continue
    }
    if (
      expected &&
      expected.length === signature.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    ) {
      return { provider: target.provider, key }
    }
  }
  return null
}

/**
 * The bytes of a stored file: a reference this server issued is read from its
 * private bucket, a plain link over HTTP. Any other reference is refused — the
 * server must never copy out a file on the strength of a client-made reference.
 */
export async function readStoredFile(value: string): Promise<Uint8Array> {
  const ref = parsePrivateRef(value)
  if (!ref && value.startsWith(PRIVATE_REF_MARKER)) {
    throw new Error('This file reference was not issued by this server')
  }
  if (ref) {
    const target = await getPrivateTarget(ref.provider)
    const object = await target.client.send(
      new GetObjectCommand({ Bucket: target.bucket, Key: ref.key })
    )
    if (!object.Body) throw new Error(`Stored file has no content: ${ref.key}`)
    return object.Body.transformToByteArray()
  }
  const response = await fetch(value)
  if (!response.ok) throw new Error(`Could not download ${value}: HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}
