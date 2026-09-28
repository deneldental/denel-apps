# Private file storage — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every file except branding private on R2 — a private bucket reached
only through 60–75 minute signed links — while every screen keeps working unchanged.

**Architecture:** Private uploads store a tagged reference
(`private-file://<provider>/<key>#<tag>`) in the existing text columns. One Hono
middleware turns references into signed links in every JSON response and turns
our (verified) signed links back into references in every JSON request. Branding
stays in a public bucket with permanent links.

**Tech Stack:** Hono 4.12.4 · @aws-sdk/client-s3 + s3-request-presigner 3.1000.0 ·
zod 4.3.6 · sanitize-html · vitest 4 · React 19 portal with Testing Library.

**Spec:** `project-docs/private-file-storage-design.md` (read it first).

## Global Constraints

- **No git commands** — not `add`, not `commit`, not `stash` (the user's rule).
- Reference format, exactly: `private-file://<r2|do_spaces>/<key, each segment
  encodeURIComponent'd plus ! ' ( ) *>#<16 lowercase hex>`.
- Tag: first 16 hex chars of `HMAC-SHA256(key = SHA-256("denel.private-file-ref.v1:" + BETTER_AUTH_SECRET), message = "<provider>/<key>")`.
- Links: signing date = now rounded down to 15 minutes; `expiresIn` = 4500 s.
- Uploads are private unless the caller passes `'public'`; only the branding
  upload does.
- S3 clients: `requestChecksumCalculation: 'WHEN_REQUIRED'` and
  `responseChecksumValidation: 'WHEN_REQUIRED'` (keeps presigned GETs plain — no
  `x-amz-checksum-mode`).
- Biome: 0 errors; no new warnings (`node scripts/lint-ratchet.mjs` must pass). No
  `!` non-null assertions. The only allowed `any` is the presigner call, with the
  same `biome-ignore` comment `storage-router.ts` already uses.
- Typecheck clean: `cd backend && npx tsc --noEmit -p tsconfig.json`,
  `cd portals && npx tsc --noEmit -p tsconfig.json`.
- Backend unit/route tests: `cd backend && env -u DATABASE_URL npx vitest run <file>`.
- Integration tests only against a throwaway Postgres on port **5499**, never the
  user's `framada-dev-db` (5433).
- Never start, stop or restart the user's dev servers; tell them what to restart.
- Do not touch `reports/`, `website/`, `hr/`, `team/`, `patient/` source.

## Review Focus

1. **File names with spaces, apostrophes, brackets and accents**
   (`patients/p 1/Ama's x-ray (1) ü.jpg`) must survive reference → signed link →
   reference unchanged — tests in Task 1 (step 1) and Task 5 (step 1).
2. **Rich-text editors re-serialise `&` as `&amp;`** inside a signed link in HTML;
   it must still convert — Task 5 (step 1).
3. **A form saved after its links expired** (open > 75 minutes) must still save
   the right file — Task 5 (step 1).
4. **Screens with hundreds of files** (a patient's photo gallery) must not read
   the R2 settings hundreds of times per response — Task 4 (step 1).
5. **Storage settings removed after files exist** — screens still load (file
   unavailable) and saving such a record keeps its file — Task 4 (step 1) and
   Task 5 (step 1).

---

### Task 1: Private file references

**Files:**
- Create: `backend/src/lib/private-files.ts`
- Test: `backend/tests/unit/private-files-refs.test.ts`

**Interfaces:**
- Produces:
  - `type PrivateProvider = 'r2' | 'do_spaces'` (re-exported from `storage-providers.ts` from Task 2 on; defined locally in this task)
  - `type PrivateRef = { provider: PrivateProvider; key: string }`
  - `const PRIVATE_REF_MARKER = 'private-file://'`
  - `makePrivateRef(provider: PrivateProvider, key: string): string`
  - `type FoundRef = { raw: string; ref: PrivateRef; tagValid: boolean }`
  - `findPrivateRefs(text: string): FoundRef[]`
  - `parsePrivateRef(value: string): PrivateRef | null` (whole value is one reference; tag not checked — for trusted database values)
  - `replacePrivateRefs(text: string, replacement: Map<string, string>): string`

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/unit/private-files-refs.test.ts
/**
 * Private file references: what private uploads store instead of a link.
 * The tag proves the backend issued a reference; nothing else may mint one.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/config/env', () => ({
  env: { BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!' },
}))

import {
  findPrivateRefs,
  makePrivateRef,
  parsePrivateRef,
  replacePrivateRefs,
} from '../../src/lib/private-files'

const TRICKY_KEY = "patients/p 1/Ama's x-ray (1) ü.jpg"

describe('private file references', () => {
  it('round-trips a key with spaces, apostrophes, brackets and accents', () => {
    const ref = makePrivateRef('r2', TRICKY_KEY)

    expect(findPrivateRefs(ref)).toEqual([
      { raw: ref, ref: { provider: 'r2', key: TRICKY_KEY }, tagValid: true },
    ])
  })

  it('contains no quote, bracket or space, so it is safe inside HTML and JSON', () => {
    expect(makePrivateRef('r2', TRICKY_KEY)).toMatch(
      /^private-file:\/\/r2\/[A-Za-z0-9._~%/-]+#[0-9a-f]{16}$/
    )
  })

  it('marks a reference whose key was altered as untrusted', () => {
    const tampered = makePrivateRef('r2', 'patients/a/scan.jpg').replace('scan', 'scam')

    expect(findPrivateRefs(tampered)[0].tagValid).toBe(false)
  })

  it('does not let a tag move between providers', () => {
    const moved = makePrivateRef('r2', 'a/b.jpg').replace('://r2/', '://do_spaces/')

    expect(findPrivateRefs(moved)[0].tagValid).toBe(false)
  })

  it('finds references inside JSON-encoded HTML', () => {
    const ref = makePrivateRef('r2', 'memos/2026/diagram.png')
    const json = JSON.stringify({ html: `<p>See</p><img src="${ref}">` })

    expect(findPrivateRefs(json).map((f) => f.ref.key)).toEqual(['memos/2026/diagram.png'])
  })

  it('parses a stored value only when it is exactly one reference', () => {
    const ref = makePrivateRef('do_spaces', 'staff/cv.pdf')

    expect(parsePrivateRef(ref)).toEqual({ provider: 'do_spaces', key: 'staff/cv.pdf' })
    expect(parsePrivateRef(`see ${ref}`)).toBeNull()
    expect(parsePrivateRef('https://pub-test.r2.dev/SYS/branding/logo.png')).toBeNull()
  })

  it('replaces every occurrence of a reference', () => {
    const ref = makePrivateRef('r2', 'a/b.jpg')
    const text = `${ref} and again ${ref}`

    expect(replacePrivateRefs(text, new Map([[ref, 'LINK']]))).toBe('LINK and again LINK')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && env -u DATABASE_URL npx vitest run tests/unit/private-files-refs.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/lib/private-files"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/lib/private-files.ts
// Private file references — the permanent value stored for a file kept in the
// private bucket. Screens never see one: lib/private-file-links.ts turns
// references into short-lived signed links on the way out and our signed links
// back into references on the way in. See project-docs/private-file-storage-design.md.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env'

export type PrivateProvider = 'r2' | 'do_spaces'
export type PrivateRef = { provider: PrivateProvider; key: string }

/** Every reference starts with this — a cheap test before any parsing. */
export const PRIVATE_REF_MARKER = 'private-file://'

/** A whole reference inside any text: JSON, an HTML attribute, a plain value. */
const PRIVATE_REF_PATTERN = /private-file:\/\/(r2|do_spaces)\/([A-Za-z0-9._~%/-]+)#([0-9a-f]{16})/g

function tagKey(): Buffer {
  return createHash('sha256')
    .update(`denel.private-file-ref.v1:${env.BETTER_AUTH_SECRET}`, 'utf8')
    .digest()
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

/** Every well-formed reference in `text`, in order, duplicates included. */
export function findPrivateRefs(text: string): FoundRef[] {
  const found: FoundRef[] = []
  for (const match of text.matchAll(PRIVATE_REF_PATTERN)) {
    const provider = match[1] as PrivateProvider
    const key = decodeKey(match[2])
    if (key === null) continue
    const tagValid = timingSafeEqual(
      Buffer.from(tagFor(provider, key), 'utf8'),
      Buffer.from(match[3], 'utf8')
    )
    found.push({ raw: match[0], ref: { provider, key }, tagValid })
  }
  return found
}

/**
 * A stored value that is exactly one reference, or null. The tag is not checked:
 * use this for values read from the database, which only the backend writes.
 */
export function parsePrivateRef(value: string): PrivateRef | null {
  const [first] = findPrivateRefs(value)
  return first && first.raw === value ? first.ref : null
}

/** Swap each reference for its replacement (keyed by the raw reference text). */
export function replacePrivateRefs(text: string, replacement: Map<string, string>): string {
  return text.replace(PRIVATE_REF_PATTERN, (raw) => replacement.get(raw) ?? raw)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && env -u DATABASE_URL npx vitest run tests/unit/private-files-refs.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint the new files**

Run: `cd backend && npx biome check --max-diagnostics=none src/lib/private-files.ts tests/unit/private-files-refs.test.ts`
Expected: `Checked 2 files` with no errors or warnings (run `npx biome format --write` on the two files if it only reports formatting).

---

### Task 2: Private storage targets, signed links and link verification

**Files:**
- Modify: `backend/src/lib/integrations.ts` (`R2Config`)
- Modify: `backend/src/lib/storage-providers.ts`
- Modify: `backend/src/lib/private-files.ts`
- Test: `backend/tests/unit/private-files-signing.test.ts`

**Interfaces:**
- Consumes: Task 1 (`decodeKey`, `PrivateRef`, `PrivateProvider`).
- Produces (in `storage-providers.ts`):
  - `S3CompatAdapter.supportsObjectAcl: boolean` (r2 `false`, do_spaces `true`)
  - `type PrivateProvider = S3CompatAdapter['id']`
  - `type PrivateTarget = { provider: PrivateProvider; client: S3Client; bucket: string }`
  - `getPrivateTarget(provider: PrivateProvider): Promise<PrivateTarget>`
- Produces (in `private-files.ts`):
  - `LINK_WINDOW_MS = 900_000`, `LINK_EXPIRES_SECONDS = 4500`
  - `signingWindowStart(now: Date): Date`
  - `type TargetCache = { get(provider: PrivateProvider): Promise<PrivateTarget> }`
  - `createTargetCache(): TargetCache`
  - `signPrivateRef(ref: PrivateRef, now: Date, targets: TargetCache): Promise<string>`
  - `configuredPrivateTargets(): Promise<PrivateTarget[]>`
  - `refFromSignedUrl(url: string, targets: PrivateTarget[]): Promise<PrivateRef | null>`

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/unit/private-files-signing.test.ts
/**
 * Signed links for private files and the check that turns one of OUR signed
 * links back into its reference. Signing is local HMAC work — no network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  r2: null as Record<string, unknown> | null,
}))

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
  },
}))
vi.mock('../../src/lib/integrations', () => ({
  getR2Config: vi.fn(async () => state.r2),
  getDoSpacesConfig: vi.fn(async () => null),
  getCloudinaryConfig: vi.fn(async () => null),
}))

import {
  configuredPrivateTargets,
  createTargetCache,
  refFromSignedUrl,
  signPrivateRef,
} from '../../src/lib/private-files'
import { getPrivateTarget } from '../../src/lib/storage-providers'

const R2 = {
  endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
  bucket: 'denel-public',
  privateBucket: 'denel-private',
  region: 'auto',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secretEXAMPLE',
  publicUrl: 'https://pub-test.r2.dev',
}
const TRICKY = { provider: 'r2' as const, key: "patients/p 1/Ama's x-ray (1) ü.jpg" }
const at = (iso: string) => new Date(iso)

afterEach(() => {
  state.r2 = null
})

describe('private targets', () => {
  it('uses the private bucket for R2', async () => {
    state.r2 = R2

    expect((await getPrivateTarget('r2')).bucket).toBe('denel-private')
  })

  it('refuses when the R2 private bucket is not configured', async () => {
    state.r2 = { ...R2, privateBucket: '' }

    await expect(getPrivateTarget('r2')).rejects.toThrow(
      'Cloudflare R2: the private bucket is not configured — Settings → Integrations → R2'
    )
  })

  it('lists only the targets that are configured', async () => {
    state.r2 = R2

    expect((await configuredPrivateTargets()).map((t) => t.provider)).toEqual(['r2'])
  })
})

describe('signed links', () => {
  it('points at the private bucket, is a plain GET, and lives 75 minutes', async () => {
    state.r2 = R2

    const url = new URL(await signPrivateRef(TRICKY, at('2026-09-26T10:01:00Z'), createTargetCache()))

    expect(url.host).toBe('denel-private.0123456789abcdef.r2.cloudflarestorage.com')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('4500')
    expect(url.searchParams.get('X-Amz-Date')).toBe('20260926T100000Z')
    expect(url.searchParams.has('x-amz-checksum-mode')).toBe(false)
  })

  it('is identical within a 15-minute window and changes in the next', async () => {
    state.r2 = R2
    const cache = createTargetCache()

    const a = await signPrivateRef(TRICKY, at('2026-09-26T10:01:00Z'), cache)
    const b = await signPrivateRef(TRICKY, at('2026-09-26T10:14:59Z'), cache)
    const c = await signPrivateRef(TRICKY, at('2026-09-26T10:15:00Z'), cache)

    expect(b).toBe(a)
    expect(c).not.toBe(a)
  })
})

describe('turning our signed links back into references', () => {
  it('recognises a genuine link, tricky key included', async () => {
    state.r2 = R2
    const url = await signPrivateRef(TRICKY, at('2026-09-26T10:01:00Z'), createTargetCache())

    expect(await refFromSignedUrl(url, await configuredPrivateTargets())).toEqual(TRICKY)
  })

  it('still recognises a genuine link long after it expired', async () => {
    state.r2 = R2
    const url = await signPrivateRef(TRICKY, at('2020-01-01T00:00:00Z'), createTargetCache())

    expect(await refFromSignedUrl(url, await configuredPrivateTargets())).toEqual(TRICKY)
  })

  it('rejects a link whose key or signature was altered', async () => {
    state.r2 = R2
    const url = await signPrivateRef(
      { provider: 'r2', key: 'patients/a/scan.jpg' },
      at('2026-09-26T10:01:00Z'),
      createTargetCache()
    )
    const targets = await configuredPrivateTargets()

    expect(await refFromSignedUrl(url.replace('scan.jpg', 'scam.jpg'), targets)).toBeNull()
    expect(
      await refFromSignedUrl(url.replace(/X-Amz-Signature=[0-9a-f]/, 'X-Amz-Signature=0'), targets)
    ).toBeNull()
  })

  it('rejects a link signed with other credentials', async () => {
    state.r2 = { ...R2, accessKeyId: 'OTHERKEY', secretAccessKey: 'otherSecret' }
    const foreign = await signPrivateRef(TRICKY, at('2026-09-26T10:01:00Z'), createTargetCache())
    state.r2 = R2

    expect(await refFromSignedUrl(foreign, await configuredPrivateTargets())).toBeNull()
  })

  it('ignores links to other hosts', async () => {
    state.r2 = R2

    expect(
      await refFromSignedUrl(
        'https://example.com/a.jpg?X-Amz-Date=20260926T100000Z&X-Amz-Expires=4500&X-Amz-Signature=abc',
        await configuredPrivateTargets()
      )
    ).toBeNull()
  })

  it('treats an out-of-range expiry as not ours instead of failing', async () => {
    state.r2 = R2
    const url = await signPrivateRef(TRICKY, at('2026-09-26T10:01:00Z'), createTargetCache())

    expect(
      await refFromSignedUrl(
        url.replace('X-Amz-Expires=4500', 'X-Amz-Expires=99999999'),
        await configuredPrivateTargets()
      )
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && env -u DATABASE_URL npx vitest run tests/unit/private-files-signing.test.ts`
Expected: FAIL — `getPrivateTarget` / `signPrivateRef` are not exported.

- [ ] **Step 3: Add `privateBucket` to the R2 config type**

In `backend/src/lib/integrations.ts`, inside `export type R2Config = {`, after `publicUrl: string`:

```ts
  /** Bucket for private files — no public access; same endpoint and API token. */
  privateBucket?: string
```

- [ ] **Step 4: Private targets and a shared client builder in `storage-providers.ts`**

Replace the `S3CompatAdapter` type's `endpointIsPubliclyReadable` block end with an extra field, set it on both adapters, add the client builder, and use it in `buildS3CompatRuntime`:

```ts
// in `export type S3CompatAdapter = {`, after `endpointIsPubliclyReadable: boolean`
  /**
   * Whether objects carry their own ACL. DO Spaces: yes — public and private
   * files share one bucket. R2: no — private files need their own bucket.
   */
  supportsObjectAcl: boolean
```

```ts
// in STORAGE_PROVIDERS.r2, after `endpointIsPubliclyReadable: false,`
    supportsObjectAcl: false,
// in STORAGE_PROVIDERS.do_spaces, after `endpointIsPubliclyReadable: true,`
    supportsObjectAcl: true,
```

Add below `listProviders()`:

```ts
// ── S3-compat client builder ────────────────────────────────────────────────

/**
 * Optional checksums off. The AWS SDK (≥ 3.729) adds CRC32 headers to uploads
 * and `x-amz-checksum-mode=ENABLED` to every presigned GET by default; R2's S3
 * API documents neither, and a download link must stay a plain GET.
 */
function makeS3Client(endpoint: string, region: string, cfg: S3CompatConfig): S3Client {
  return new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
}

export type PrivateProvider = S3CompatAdapter['id']
export type PrivateTarget = { provider: PrivateProvider; client: S3Client; bucket: string }

/**
 * Where private files live for a provider: R2's separate private bucket (R2 has
 * no per-object ACL), or the DO Spaces bucket itself (objects are private by ACL).
 */
export async function getPrivateTarget(provider: PrivateProvider): Promise<PrivateTarget> {
  const adapter = getProvider(provider)
  if (adapter.kind !== 's3-compat') throw new Error(`${adapter.label} cannot store private files`)
  const cfg = await adapter.loadConfig()
  if (!cfg?.endpoint || !cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error(`${adapter.label} is not configured`)
  }
  const bucket = adapter.supportsObjectAcl
    ? cfg.bucket
    : 'privateBucket' in cfg
      ? cfg.privateBucket
      : undefined
  if (!bucket) {
    throw new Error(
      adapter.supportsObjectAcl
        ? `${adapter.label} is not configured`
        : `${adapter.label}: the private bucket is not configured — Settings → Integrations → R2`
    )
  }
  const endpoint = adapter.normalizeEndpoint(cfg.endpoint, bucket)
  return { provider, client: makeS3Client(endpoint, cfg.region || 'auto', cfg), bucket }
}
```

In `buildS3CompatRuntime`, replace the `client: new S3Client({ … }),` property with:

```ts
    client: makeS3Client(endpoint, region, cfg),
```

- [ ] **Step 5: Signing and verification in `private-files.ts`**

Replace the Task 1 local `export type PrivateProvider = 'r2' | 'do_spaces'` line with an import/re-export, and add the imports:

```ts
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getPrivateTarget, type PrivateProvider, type PrivateTarget } from './storage-providers'

export type { PrivateProvider, PrivateTarget }
```

Append:

```ts
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

/** What our signer puts before a key: `https://<bucket>.<host>/`. */
async function signedUrlPrefix(target: PrivateTarget): Promise<string> {
  const probe = new URL(await presign(target, 'probe', new Date(0), 60))
  return `${probe.origin}${probe.pathname.slice(0, -'probe'.length)}`
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && env -u DATABASE_URL npx vitest run tests/unit/private-files-signing.test.ts tests/unit/private-files-refs.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 7: Typecheck and lint**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json` → 0 errors (this also type-checks `tests/`).
Run: `cd backend && npx biome check --max-diagnostics=none src/lib/private-files.ts src/lib/storage-providers.ts src/lib/integrations.ts tests/unit/private-files-signing.test.ts` → 0 errors.
Run (repo root): `node scripts/lint-ratchet.mjs` → passes (no workspace's warning count went up).

---

### Task 3: Private by default — uploads, statements and the callers

**Files:**
- Modify: `backend/src/lib/storage-router.ts`
- Modify: `backend/src/routes/integrations.ts` (branding upload → public)
- Modify: `backend/src/routes/staff-registration.ts:524-527` (CV → private)
- Modify: `backend/src/lib/backup-scheduler.ts` (random key)
- Test: `backend/tests/unit/storage-visibility.test.ts`
- Test: `backend/tests/routes/integrations-branding-upload.test.ts`

**Interfaces:**
- Consumes: `getPrivateTarget` (Task 2), `makePrivateRef`, `parsePrivateRef` (Task 1).
- Produces:
  - `type Visibility = 'public' | 'private'`
  - `uploadToCategory(category, key, body, contentType, visibility: Visibility = 'private'): Promise<{ url: string; providerId: StorageProviderId }>` — `url` is a public link for `'public'`, a reference for `'private'`.
  - `deleteFromCategory(category, key)` and `getSignedDownloadUrlForCategory(category, key, opts)` act on the **private** target.
  - `backupObjectKey(schedule: string, stamp: string): string` (exported from `backup-scheduler.ts`).

- [ ] **Step 1: Write the failing unit test**

```ts
// backend/tests/unit/storage-visibility.test.ts
/**
 * Where an upload lands. Private is the default; only callers that ask for
 * 'public' get a permanent public link. The S3 client is faked at `send`.
 */
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  r2: null as Record<string, unknown> | null,
  doSpaces: null as Record<string, unknown> | null,
  routing: null as Record<string, string> | null,
}))

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
  },
}))
vi.mock('../../src/lib/integrations', () => ({
  getR2Config: vi.fn(async () => state.r2),
  getDoSpacesConfig: vi.fn(async () => state.doSpaces),
  getCloudinaryConfig: vi.fn(async () => ({
    cloudName: 'c',
    apiKey: 'k',
    apiSecret: 's',
    uploadFolder: '',
    enabled: true,
  })),
  getStorageRouting: vi.fn(async () => state.routing),
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { backupObjectKey } from '../../src/lib/backup-scheduler'
import { parsePrivateRef } from '../../src/lib/private-files'
import {
  deleteFromCategory,
  getSignedDownloadUrlForCategory,
  uploadToCategory,
} from '../../src/lib/storage-router'

const R2 = {
  endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
  bucket: 'denel-public',
  privateBucket: 'denel-private',
  region: 'auto',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secretEXAMPLE',
  publicUrl: 'https://pub-test.r2.dev',
}
const DO = {
  endpoint: 'https://fra1.digitaloceanspaces.com',
  bucket: 'denel-space',
  region: 'fra1',
  accessKeyId: 'DOKEY',
  secretAccessKey: 'doSecret',
  publicUrl: 'https://denel-space.fra1.cdn.digitaloceanspaces.com',
}

let sent: unknown[]
beforeEach(() => {
  sent = []
  state.r2 = R2
  vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
    sent.push(command)
    return {} as never
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  state.doSpaces = null
  state.routing = null
})

const puts = () =>
  sent.filter((c): c is PutObjectCommand => c instanceof PutObjectCommand).map((c) => c.input)

describe('uploadToCategory', () => {
  it('stores in the R2 private bucket by default and returns a reference', async () => {
    const { url } = await uploadToCategory('patient_records', 'xrays/a.jpg', Buffer.from('x'), 'image/jpeg')

    expect(puts()).toEqual([
      expect.objectContaining({ Bucket: 'denel-private', Key: 'xrays/a.jpg', ContentType: 'image/jpeg' }),
    ])
    expect(puts()[0]).not.toHaveProperty('ACL')
    expect(parsePrivateRef(url)).toEqual({ provider: 'r2', key: 'xrays/a.jpg' })
  })

  it("stores 'public' uploads in the R2 public bucket and returns the public link", async () => {
    const { url } = await uploadToCategory(
      'system_docs',
      'SYS/branding/logo.png',
      Buffer.from('x'),
      'image/png',
      'public'
    )

    expect(puts()[0]).toEqual(expect.objectContaining({ Bucket: 'denel-public' }))
    expect(url).toBe('https://pub-test.r2.dev/SYS/branding/logo.png')
  })

  it('uses per-object ACLs on DigitalOcean Spaces', async () => {
    state.doSpaces = DO
    state.routing = { patient_records: 'do_spaces', staff: 'do_spaces', system_docs: 'do_spaces', misc: 'do_spaces' }

    const priv = await uploadToCategory('patient_records', 'a.pdf', Buffer.from('x'), 'application/pdf')
    await uploadToCategory('system_docs', 'SYS/branding/logo.png', Buffer.from('x'), 'image/png', 'public')

    expect(puts().map((p) => [p.Bucket, p.ACL])).toEqual([
      ['denel-space', 'private'],
      ['denel-space', 'public-read'],
    ])
    expect(parsePrivateRef(priv.url)).toEqual({ provider: 'do_spaces', key: 'a.pdf' })
  })

  it('refuses a private upload routed to Cloudinary, without uploading', async () => {
    state.routing = { patient_records: 'cloudinary', staff: 'r2', system_docs: 'r2', misc: 'r2' }

    await expect(
      uploadToCategory('patient_records', 'a.jpg', Buffer.from('x'), 'image/jpeg')
    ).rejects.toThrow(
      `Cloudinary can't store private files — in Settings → Integrations → Storage routing, send the "patient_records" category to Cloudflare R2 or DigitalOcean Spaces.`
    )
    expect(sent).toHaveLength(0)
  })

  it('fails clearly when the R2 private bucket is missing', async () => {
    state.r2 = { ...R2, privateBucket: '' }

    await expect(
      uploadToCategory('staff', 'cv.pdf', Buffer.from('x'), 'application/pdf')
    ).rejects.toThrow('the private bucket is not configured')
  })
})

describe('statements: signed download and delete use the private bucket', () => {
  it('signs a download from the private bucket', async () => {
    const url = new URL(await getSignedDownloadUrlForCategory('patient_records', 'statements/s.pdf'))

    expect(url.host).toBe('denel-private.0123456789abcdef.r2.cloudflarestorage.com')
  })

  it('deletes from the private bucket', async () => {
    await deleteFromCategory('patient_records', 'statements/s.pdf')

    const deletes = sent.filter((c): c is DeleteObjectCommand => c instanceof DeleteObjectCommand)
    expect(deletes.map((d) => d.input)).toEqual([{ Bucket: 'denel-private', Key: 'statements/s.pdf' }])
  })
})

describe('backup object keys', () => {
  it('add an unguessable part to the timestamp', () => {
    const a = backupObjectKey('daily-6pm', '2026-09-26T18-00-00-000Z')
    const b = backupObjectKey('daily-6pm', '2026-09-26T18-00-00-000Z')

    expect(a).toMatch(/^SYS\/backups\/daily-6pm\/2026-09-26T18-00-00-000Z-[0-9a-f]{16}\.sql\.gz$/)
    expect(b).not.toBe(a)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && env -u DATABASE_URL npx vitest run tests/unit/storage-visibility.test.ts`
Expected: FAIL — `backupObjectKey` is not exported; the default upload goes to `denel-public` with `ACL: 'public-read'`.

- [ ] **Step 3: Implement visibility in `storage-router.ts`**

Replace the imports and the three functions (`uploadToCategory`, `deleteFromCategory`, `getSignedDownloadUrlForCategory`) with:

```ts
import type { Readable } from 'node:stream'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getStorageRouting, type StorageProviderId, type StorageRouting } from './integrations'
import { makePrivateRef } from './private-files'
import {
  buildS3CompatRuntime,
  getPrivateTarget,
  getProvider,
  type ProviderAdapter,
  uploadViaCloudinary,
} from './storage-providers'

export type FileCategory = keyof StorageRouting
export type Visibility = 'public' | 'private'
```

```ts
/**
 * Upload a file to whichever provider is configured for the category.
 *
 * Private by default: the file goes to the provider's private target and the
 * returned `url` is a private reference (lib/private-files.ts) that callers
 * store as they stored links before — the API edge turns it into a short-lived
 * link for screens. Only `'public'` uploads (branding) get a permanent link.
 */
export async function uploadToCategory(
  category: FileCategory,
  key: string,
  body: Buffer | Uint8Array | Readable,
  contentType: string,
  visibility: Visibility = 'private'
): Promise<{ url: string; providerId: StorageProviderId }> {
  const adapter = await getActiveAdapter(category)

  if (adapter.kind === 'cloudinary') {
    if (visibility === 'private') {
      throw new Error(
        `Cloudinary can't store private files — in Settings → Integrations → Storage routing, send the "${category}" category to Cloudflare R2 or DigitalOcean Spaces.`
      )
    }
    const url = await uploadViaCloudinary(adapter, key, body, contentType)
    return { url, providerId: adapter.id }
  }

  if (visibility === 'public') {
    const { client, bucket, publicUrlBase } = await buildS3CompatRuntime(adapter)
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(adapter.supportsObjectAcl ? { ACL: 'public-read' as const } : {}),
      })
    )
    return { url: `${publicUrlBase}/${key}`, providerId: adapter.id }
  }

  const target = await getPrivateTarget(adapter.id)
  await target.client.send(
    new PutObjectCommand({
      Bucket: target.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...(adapter.supportsObjectAcl ? { ACL: 'private' as const } : {}),
    })
  )
  return { url: makePrivateRef(adapter.id, key), providerId: adapter.id }
}

/**
 * Best-effort delete of a PRIVATE object (the only caller, patient statements,
 * stores private files). Cloudinary deletes are not supported here.
 *
 * Caveat: if routing changed since the upload, the active provider won't have
 * the object.
 */
export async function deleteFromCategory(category: FileCategory, key: string): Promise<void> {
  const adapter = await getActiveAdapter(category)
  if (adapter.kind === 'cloudinary') return
  const target = await getPrivateTarget(adapter.id)
  await target.client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: key }))
}
```

```ts
/**
 * Presigned, time-limited GET URL for a PRIVATE object (patient statements).
 * Optionally forces a download with a friendly filename via Content-Disposition.
 * S3-compatible providers only.
 */
export async function getSignedDownloadUrlForCategory(
  category: FileCategory,
  key: string,
  opts: { expiresIn?: number; downloadFilename?: string } = {}
): Promise<string> {
  const adapter = await getActiveAdapter(category)
  if (adapter.kind === 'cloudinary') {
    throw new Error('Cloudinary objects cannot be presigned from a key')
  }
  const target = await getPrivateTarget(adapter.id)
  const command = new GetObjectCommand({
    Bucket: target.bucket,
    Key: key,
    ...(opts.downloadFilename
      ? { ResponseContentDisposition: `attachment; filename="${opts.downloadFilename}"` }
      : {}),
  })
  // The presigner and client-s3 resolve slightly different AWS SDK type copies,
  // so their Client<…>/Command<…> generics don't line up at compile time even
  // though `getSignedUrl(s3Client, getObjectCommand)` is the documented runtime
  // usage. Suppress the typings-only mismatch at this single seam.
  // biome-ignore lint/suspicious/noExplicitAny: AWS SDK presigner typings mismatch
  return getSignedUrl(target.client as any, command as any, { expiresIn: opts.expiresIn ?? 300 })
}
```

Keep `getActiveProviderId`, `getActiveAdapter` and `getPublicUrlForCategory` as they are.

- [ ] **Step 4: Backup keys in `backup-scheduler.ts`**

Add `import { randomBytes } from 'node:crypto'` to the imports, add the function above `runBackupNow`, and use it:

```ts
/** Backups are private and their key carries 64 random bits, so it cannot be guessed. */
export function backupObjectKey(schedule: string, stamp: string): string {
  return `SYS/backups/${schedule}/${stamp}-${randomBytes(8).toString('hex')}.sql.gz`
}
```

```ts
    const key = backupObjectKey(cfg.schedule, stamp)
```

(replacing ``const key = `SYS/backups/${cfg.schedule}/${stamp}.sql.gz` ``).

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `cd backend && env -u DATABASE_URL npx vitest run tests/unit/storage-visibility.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Write the failing branding route test**

```ts
// backend/tests/routes/integrations-branding-upload.test.ts
/**
 * Branding is the one thing that stays public: the logo, favicon, icons and
 * login photos must have permanent links (emails, login page, installed apps).
 */
import { S3Client } from '@aws-sdk/client-s3'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
  },
  validateBackendEnv: vi.fn(),
  isDevEnvironment: () => false,
  resolvedEnvironment: () => 'production',
}))
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/integrations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/integrations')>()),
  getR2Config: vi.fn(async () => ({
    endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
    bucket: 'denel-public',
    privateBucket: 'denel-private',
    region: 'auto',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'secretEXAMPLE',
    publicUrl: 'https://pub-test.r2.dev',
  })),
  getStorageRouting: vi.fn(async () => null),
}))
vi.mock('../../src/rbac/middleware/verifySession', () => ({
  verifySession:
    () =>
    async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      c.set('user', { id: 'u-admin', email: 'a@b.c', name: 'Admin', roleId: 'admin', role: 'admin' })
      await next()
    },
}))
vi.mock('../../src/rbac/middleware/checkPermission', () => ({
  checkPermission: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))

import { integrationsApp } from '../../src/routes/integrations'

// 1×1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

let buckets: string[]
beforeEach(() => {
  buckets = []
  vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
    buckets.push((command as { input: { Bucket: string } }).input.Bucket)
    return {} as never
  })
})
afterEach(() => vi.restoreAllMocks())

describe('POST /api/integrations/branding/logo', () => {
  it('stores the logo in the public bucket and returns its permanent link', async () => {
    const app = new Hono<HonoEnv>()
    app.route('/api/integrations', integrationsApp)
    const form = new FormData()
    form.append('file', new File([PNG], 'logo.png', { type: 'image/png' }))
    form.append('kind', 'logo')

    const res = await app.request('/api/integrations/branding/logo', { method: 'POST', body: form })
    const body = (await res.json()) as { data: { url: string } }

    expect(res.status).toBe(200)
    expect(buckets).toEqual(['denel-public'])
    expect(body.data.url).toBe('https://pub-test.r2.dev/SYS/branding/logo.png')
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd backend && env -u DATABASE_URL npx vitest run tests/routes/integrations-branding-upload.test.ts`
Expected: FAIL — the upload goes to `denel-private` (the new default) and returns a `private-file://` reference.

- [ ] **Step 8: Branding public, CV private**

In `backend/src/routes/integrations.ts`, in the branding upload's `uploadToCategory(` call, add the fifth argument:

```ts
      const { url } = await uploadToCategory(
        'system_docs',
        `SYS/${key}`,
        Buffer.from(validation.buffer),
        file.type,
        'public'
      )
```

In `backend/src/routes/staff-registration.ts`, replace the two comment lines and the upload call:

```ts
    // Private: HR opens the CV through a short-lived link the API edge issues.
    const key = `staff/registration/${inv.id}/cv-${randomToken().slice(0, 12)}.${ext}`
    const { url } = await uploadToCategory('staff', key, buf, file.type)
```

- [ ] **Step 9: Run both tests and the typecheck**

Run: `cd backend && env -u DATABASE_URL npx vitest run tests/unit/storage-visibility.test.ts tests/routes/integrations-branding-upload.test.ts`
Expected: PASS (10 tests).
Run: `cd backend && npx tsc --noEmit -p tsconfig.json` → 0 errors.

---

### Task 4: Response layer — references become signed links

**Files:**
- Create: `backend/src/lib/private-file-links.ts`
- Modify: `backend/src/app.ts` (mount right after the body-size guard, before `auditMiddleware()`)
- Test: `backend/tests/unit/private-file-links-response.test.ts`

**Interfaces:**
- Consumes: `findPrivateRefs`, `replacePrivateRefs`, `createTargetCache`, `signPrivateRef`, `PRIVATE_REF_MARKER` (Tasks 1–2).
- Produces:
  - `signPrivateRefsInText(text: string, now?: Date): Promise<string>`
  - `privateFileLinks(): MiddlewareHandler` (response half here; Task 5 adds the request half)

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/unit/private-file-links-response.test.ts
/**
 * Every JSON response: stored references become 60–75 minute signed links.
 */
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  r2: null as Record<string, unknown> | null,
}))

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
  },
}))
vi.mock('../../src/lib/integrations', () => ({
  getR2Config: vi.fn(async () => state.r2),
  getDoSpacesConfig: vi.fn(async () => null),
  getCloudinaryConfig: vi.fn(async () => null),
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { getR2Config } from '../../src/lib/integrations'
import { logError } from '../../src/lib/logger'
import { privateFileLinks } from '../../src/lib/private-file-links'
import { makePrivateRef } from '../../src/lib/private-files'

const R2 = {
  endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
  bucket: 'denel-public',
  privateBucket: 'denel-private',
  region: 'auto',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secretEXAMPLE',
  publicUrl: 'https://pub-test.r2.dev',
}
const PRIVATE_HOST = 'denel-private.0123456789abcdef.r2.cloudflarestorage.com'
const photo = makePrivateRef('r2', 'patients/p1/photo.jpg')
const scan = makePrivateRef('r2', 'patients/p1/scan.jpg')

function appWith(route: (app: Hono) => void): Hono {
  const app = new Hono()
  app.use('*', privateFileLinks())
  route(app)
  return app
}

afterEach(() => {
  state.r2 = null
  vi.clearAllMocks()
})

describe('response layer', () => {
  it('replaces references in nested JSON and in HTML strings with signed links', async () => {
    state.r2 = R2
    const app = appWith((a) =>
      a.get('/x', (c) =>
        c.json({ patient: { photo }, gallery: [scan], memo: `<p>Hi</p><img src="${scan}">` })
      )
    )

    const res = await app.request('/x')
    const text = await res.text()
    const body = JSON.parse(text) as { patient: { photo: string }; gallery: string[]; memo: string }

    expect(text).not.toContain('private-file://')
    expect(new URL(body.patient.photo).host).toBe(PRIVATE_HOST)
    expect(body.memo).toContain(`src="${body.gallery[0]}"`)
  })

  it('signs a repeated reference once and gives it the same link', async () => {
    state.r2 = R2
    const app = appWith((a) => a.get('/x', (c) => c.json({ a: photo, b: photo })))

    const body = (await (await app.request('/x')).json()) as { a: string; b: string }

    expect(body.b).toBe(body.a)
  })

  it('leaves non-JSON responses untouched', async () => {
    state.r2 = R2
    const app = appWith((a) => a.get('/csv', (c) => c.text(`file\n${photo}`, 200, { 'content-type': 'text/csv' })))

    expect(await (await app.request('/csv')).text()).toBe(`file\n${photo}`)
  })

  it('keeps the status, both Set-Cookie headers, and no stale Content-Length', async () => {
    state.r2 = R2
    const app = appWith((a) =>
      a.get('/x', (c) => {
        const body = JSON.stringify({ photo })
        const headers = new Headers({
          'content-type': 'application/json',
          'content-length': String(body.length),
        })
        headers.append('set-cookie', 'a=1; Path=/')
        headers.append('set-cookie', 'b=2; Path=/')
        return new Response(body, { status: 201, headers })
      })
    )

    const res = await app.request('/x')
    const text = await res.text()

    expect(res.status).toBe(201)
    expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/'])
    const length = res.headers.get('content-length')
    expect(length === null || Number(length) === Buffer.byteLength(text)).toBe(true)
  })

  it('reads the storage settings once for hundreds of files', async () => {
    state.r2 = R2
    const refs = Array.from({ length: 200 }, (_, i) => makePrivateRef('r2', `gallery/${i}.jpg`))
    const app = appWith((a) => a.get('/x', (c) => c.json({ refs })))

    const body = (await (await app.request('/x')).json()) as { refs: string[] }

    expect(body.refs.every((u) => u.startsWith(`https://${PRIVATE_HOST}/`))).toBe(true)
    expect(vi.mocked(getR2Config)).toHaveBeenCalledTimes(1)
  })

  it('still answers when signing fails: references stay, error logged once', async () => {
    state.r2 = { ...R2, privateBucket: '' }
    const app = appWith((a) => a.get('/x', (c) => c.json({ a: photo, b: scan })))

    const res = await app.request('/x')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ a: photo, b: scan })
    expect(vi.mocked(logError)).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && env -u DATABASE_URL npx vitest run tests/unit/private-file-links-response.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/lib/private-file-links"`.

- [ ] **Step 3: Implement the response half**

```ts
// backend/src/lib/private-file-links.ts
// Keeps private files private while every screen keeps working with plain links.
//   Responses: each stored reference becomes a 60–75 minute signed link.
//   Requests:  each of our signed links (verified) becomes its reference again.
// See project-docs/private-file-storage-design.md (4.3, 4.4).

import type { MiddlewareHandler } from 'hono'
import { logError } from './logger'
import {
  createTargetCache,
  findPrivateRefs,
  PRIVATE_REF_MARKER,
  replacePrivateRefs,
  signPrivateRef,
} from './private-files'

/**
 * Replace every reference in `text` with a signed link. A reference that cannot
 * be signed (storage not configured) is left in place; the first failure is logged.
 */
export async function signPrivateRefsInText(text: string, now: Date = new Date()): Promise<string> {
  if (!text.includes(PRIVATE_REF_MARKER)) return text
  const targets = createTargetCache()
  const links = new Map<string, string>()
  let failure: unknown = null
  for (const { raw, ref } of findPrivateRefs(text)) {
    if (links.has(raw)) continue
    try {
      links.set(raw, await signPrivateRef(ref, now, targets))
    } catch (err) {
      failure ??= err
    }
  }
  if (failure) logError(failure, { context: '[private-files] could not sign a file reference' })
  return replacePrivateRefs(text, links)
}

export function privateFileLinks(): MiddlewareHandler {
  return async (c, next) => {
    await next()

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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && env -u DATABASE_URL npx vitest run tests/unit/private-file-links-response.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Mount it in `app.ts`**

Add `import { privateFileLinks } from './lib/private-file-links'` with the other `./lib/*` imports (keep Biome's import order), then directly after the body-size guard (the `app.use('/api/*', async (c, next) => { const isUploadRoute = … })` block) and before `app.use('/api/*', auditMiddleware())`:

```ts
// Private files: stored references ⇄ short-lived signed links, on every JSON
// response and request (lib/private-file-links.ts). After the size guard, which
// must reject an oversized body before this layer reads it; before the audit
// log and every route — the Better Auth handler included — so they see
// references, never expiring links.
app.use('/api/*', privateFileLinks())
```

Why not right after CORS: the request half (Task 5) reads JSON bodies, and the
size guard rejects on `Content-Length` *without* reading — mounted earlier, a
huge body would be buffered before the 413.

- [ ] **Step 6: Typecheck, lint, and the existing route suites**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json` → 0 errors.
Run: `cd backend && env -u DATABASE_URL npx vitest run tests/routes tests/unit` → all pass.

---

### Task 5: Request layer — our signed links become references again

**Files:**
- Modify: `backend/src/lib/private-file-links.ts`
- Modify: `backend/src/lib/html-sanitize.ts` (allow the `private-file` scheme)
- Test: `backend/tests/unit/private-file-links-request.test.ts`
- Test: `backend/tests/unit/html-sanitize-private-files.test.ts`

**Interfaces:**
- Consumes: `configuredPrivateTargets`, `refFromSignedUrl`, `makePrivateRef`, `findPrivateRefs`, `signPrivateRef`, `createTargetCache` (Tasks 1–2); the response half (Task 4).
- Produces:
  - `type UnsignResult = { ok: true; text: string } | { ok: false }`
  - `unsignPrivateUrlsInText(text: string): Promise<UnsignResult>`
  - `privateFileLinks()` now also rewrites JSON request bodies (skips `/api/auth/*`) and answers `400` for untrusted references.

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/unit/private-file-links-request.test.ts
/**
 * Every JSON request: our signed links become references before a route reads
 * the body, so a screen that sends a shown link back never saves an expiring one.
 */
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  r2: null as Record<string, unknown> | null,
}))

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
  },
}))
vi.mock('../../src/lib/integrations', () => ({
  getR2Config: vi.fn(async () => state.r2),
  getDoSpacesConfig: vi.fn(async () => null),
  getCloudinaryConfig: vi.fn(async () => null),
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { privateFileLinks } from '../../src/lib/private-file-links'
import { createTargetCache, makePrivateRef, signPrivateRef } from '../../src/lib/private-files'

const R2 = {
  endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
  bucket: 'denel-public',
  privateBucket: 'denel-private',
  region: 'auto',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secretEXAMPLE',
  publicUrl: 'https://pub-test.r2.dev',
}
const KEY = "patients/p 1/Ama's x-ray (1) ü.jpg"
const REF = makePrivateRef('r2', KEY)

let received: unknown
let routeCalls: number
function app(): Hono {
  const a = new Hono()
  a.use('/api/*', privateFileLinks())
  for (const path of ['/api/save', '/api/auth/sign-in/email']) {
    a.post(path, async (c) => {
      routeCalls += 1
      received = await c.req.json()
      return c.json({ ok: true })
    })
  }
  a.post('/api/upload', async (c) => {
    routeCalls += 1
    const form = await c.req.formData()
    received = form.get('note')
    return c.json({ ok: true })
  })
  return a
}
const post = (path: string, body: unknown) =>
  app().request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const sign = (now: string) =>
  signPrivateRef({ provider: 'r2', key: KEY }, new Date(now), createTargetCache())

beforeEach(() => {
  state.r2 = R2
  received = undefined
  routeCalls = 0
})
afterEach(() => {
  state.r2 = null
})

describe('request layer', () => {
  it('turns our signed link back into its reference (tricky key)', async () => {
    const link = await sign('2026-09-26T10:01:00Z')

    await post('/api/save', { profileImage: link })

    expect(received).toEqual({ profileImage: REF })
  })

  it('converts the &amp; form a rich-text editor writes', async () => {
    const link = (await sign('2026-09-26T10:01:00Z')).replaceAll('&', '&amp;')

    await post('/api/save', { content: `<p>x</p><img src="${link}">` })

    expect(received).toEqual({ content: `<p>x</p><img src="${REF}">` })
  })

  it('converts a genuine link that expired hours ago', async () => {
    const link = await sign('2026-09-26T04:01:00Z')

    await post('/api/save', { profileImage: link })

    expect(received).toEqual({ profileImage: REF })
  })

  it('leaves a forged link as plain text', async () => {
    const forged = (await sign('2026-09-26T10:01:00Z')).replace(
      /X-Amz-Signature=[0-9a-f]+/,
      `X-Amz-Signature=${'0'.repeat(64)}`
    )

    await post('/api/save', { profileImage: forged })

    expect(received).toEqual({ profileImage: forged })
  })

  it('accepts a raw reference the backend issued (storage-outage save)', async () => {
    await post('/api/save', { profileImage: REF })

    expect(received).toEqual({ profileImage: REF })
  })

  it('refuses a reference the backend did not issue', async () => {
    const forged = makePrivateRef('r2', 'patients/other/xray.jpg').replace('other', 'victim')

    const res = await post('/api/save', { profileImage: forged })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'This request contains a file reference the server did not issue',
    })
    expect(routeCalls).toBe(0)
  })

  it('skips sign-in requests', async () => {
    const link = await sign('2026-09-26T10:01:00Z')

    await post('/api/auth/sign-in/email', { email: 'a@b.c', note: link })

    expect(received).toEqual({ email: 'a@b.c', note: link })
  })

  it('leaves multipart uploads alone', async () => {
    const link = await sign('2026-09-26T10:01:00Z')
    const form = new FormData()
    form.append('note', link)

    await app().request('/api/upload', { method: 'POST', body: form })

    expect(received).toBe(link)
  })
})
```

```ts
// backend/tests/unit/html-sanitize-private-files.test.ts
/**
 * Rich text keeps images stored privately: the request layer turns their links
 * into `private-file://` references before the route sanitises the HTML.
 */
import { describe, expect, it } from 'vitest'
import { sanitizeMemoHtml } from '../../src/lib/html-sanitize'

const REF = 'private-file://r2/memos/diagram.png#0123456789abcdef'

describe('sanitizeMemoHtml and private files', () => {
  it('keeps a private image, video and link', () => {
    const html = `<img src="${REF}"><video src="${REF}"></video><a href="${REF}">file</a>`

    const clean = sanitizeMemoHtml(html)

    expect(clean).toContain(`<img src="${REF}"`)
    expect(clean).toContain(`<video src="${REF}"`)
    expect(clean).toContain(`href="${REF}"`)
  })

  it('still strips javascript: links', () => {
    expect(sanitizeMemoHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && env -u DATABASE_URL npx vitest run tests/unit/private-file-links-request.test.ts tests/unit/html-sanitize-private-files.test.ts`
Expected: FAIL — links reach the route unconverted; the forged reference is not refused; the sanitiser strips `private-file://` sources.

- [ ] **Step 3: Implement the request half**

In `backend/src/lib/private-file-links.ts`, extend the `./private-files` import with `configuredPrivateTargets`, `makePrivateRef`, `refFromSignedUrl`, and add:

```ts
export type UnsignResult = { ok: true; text: string } | { ok: false }

/** A URL inside JSON text — ends at whitespace, a quote, a bracket or a backslash. */
const URL_PATTERN = /https:\/\/[^\s"'<>\\]+/g

/**
 * Turn each of our signed links in `text` into its reference. A raw reference is
 * accepted only if its tag proves the backend issued it; otherwise the whole
 * request is refused (`ok: false`).
 */
export async function unsignPrivateUrlsInText(text: string): Promise<UnsignResult> {
  if (findPrivateRefs(text).some((found) => !found.tagValid)) return { ok: false }
  if (!text.includes('X-Amz-Signature')) return { ok: true, text }

  const targets = await configuredPrivateTargets()
  if (targets.length === 0) return { ok: true, text }

  const refs = new Map<string, string>()
  for (const [candidate] of text.matchAll(URL_PATTERN)) {
    if (refs.has(candidate) || !candidate.includes('X-Amz-Signature')) continue
    // Rich-text editors serialise `&` inside attributes as `&amp;`.
    const ref = await refFromSignedUrl(candidate.replaceAll('&amp;', '&'), targets)
    if (ref) refs.set(candidate, makePrivateRef(ref.provider, ref.key))
  }
  if (refs.size === 0) return { ok: true, text }
  return { ok: true, text: text.replace(URL_PATTERN, (url) => refs.get(url) ?? url) }
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
```

and put the request half at the top of the middleware, before `await next()`:

```ts
export function privateFileLinks(): MiddlewareHandler {
  return async (c, next) => {
    if (
      WRITE_METHODS.has(c.req.method) &&
      !c.req.path.startsWith('/api/auth/') &&
      (c.req.header('content-type') ?? '').includes('application/json')
    ) {
      const text = await c.req.raw.clone().text()
      if (text.includes('X-Amz-Signature') || text.includes(PRIVATE_REF_MARKER)) {
        const result = await unsignPrivateUrlsInText(text)
        if (!result.ok) {
          return c.json(
            { error: 'This request contains a file reference the server did not issue' },
            400
          )
        }
        if (result.text !== text) {
          const headers = new Headers(c.req.raw.headers)
          headers.delete('content-length')
          c.req.raw = new Request(c.req.raw.url, {
            method: c.req.method,
            headers,
            body: result.text,
          })
          c.req.bodyCache = {}
        }
      }
    }

    await next()
    // … the Task 4 response half, unchanged …
  }
}
```

- [ ] **Step 4: Allow the scheme in `html-sanitize.ts`**

Replace the scheme lists (the reference is inert in a browser — the response layer always swaps it for a signed link first):

```ts
// `private-file:` references (lib/private-files.ts) are what private uploads
// store; they never reach a browser — the API edge swaps them for signed links.
const SAFE_SCHEMES = ['http', 'https', 'mailto', 'tel', 'private-file']
```

```ts
  allowedSchemesByTag: {
    img: ['http', 'https', 'data', 'private-file'],
    video: ['http', 'https', 'private-file'],
    source: ['http', 'https', 'private-file'],
  },
```

- [ ] **Step 5: Run them to verify they pass**

Run: `cd backend && env -u DATABASE_URL npx vitest run tests/unit/private-file-links-request.test.ts tests/unit/html-sanitize-private-files.test.ts tests/unit/private-file-links-response.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 6: Typecheck, lint, all unit and route tests**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json` → 0 errors.
Run: `cd backend && env -u DATABASE_URL npx vitest run tests/routes tests/unit` → all pass.

---

### Task 6: The backend reads its own stored files

**Files:**
- Modify: `backend/src/lib/private-files.ts` (`readStoredFile`)
- Modify: `backend/src/lib/document-signing.ts:144-146` (template) and `:204-207` (current signed PDF)
- Modify: `backend/src/routes/documents.ts:269-291` and `:331-334`
- Test: `backend/tests/unit/read-stored-file.test.ts`

Four reads, not three: besides the three template reads the spec lists,
`maybeCompleteDocument` reads the instance's current `signedPdfUrl` back to add
the audit page — and that PDF is itself a private upload now.

**Interfaces:**
- Consumes: `parsePrivateRef` (Task 1), `getPrivateTarget` (Task 2).
- Produces: `readStoredFile(value: string): Promise<Uint8Array>` — throws on any failure.

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/unit/read-stored-file.test.ts
/**
 * Stamping a signature onto a document template reads the template's bytes —
 * straight from the private bucket for a reference, over HTTP for a plain link.
 */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
  },
}))
vi.mock('../../src/lib/integrations', () => ({
  getR2Config: vi.fn(async () => ({
    endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
    bucket: 'denel-public',
    privateBucket: 'denel-private',
    region: 'auto',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'secretEXAMPLE',
    publicUrl: 'https://pub-test.r2.dev',
  })),
  getDoSpacesConfig: vi.fn(async () => null),
  getCloudinaryConfig: vi.fn(async () => null),
}))

import { makePrivateRef, readStoredFile } from '../../src/lib/private-files'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('readStoredFile', () => {
  it('reads a reference from the private bucket', async () => {
    const requests: unknown[] = []
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
      requests.push((command as GetObjectCommand).input)
      return { Body: { transformToByteArray: async () => new Uint8Array([37, 80, 68, 70]) } } as never
    })

    const bytes = await readStoredFile(makePrivateRef('r2', 'templates/consent.pdf'))

    expect(Array.from(bytes)).toEqual([37, 80, 68, 70])
    expect(requests).toEqual([{ Bucket: 'denel-private', Key: 'templates/consent.pdf' }])
  })

  it('downloads a plain link', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })))

    expect(Array.from(await readStoredFile('https://pub-test.r2.dev/x.pdf'))).toEqual([1, 2, 3])
  })

  it('throws when a plain link does not answer 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))

    await expect(readStoredFile('https://pub-test.r2.dev/x.pdf')).rejects.toThrow('HTTP 404')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && env -u DATABASE_URL npx vitest run tests/unit/read-stored-file.test.ts`
Expected: FAIL — `readStoredFile` is not exported.

- [ ] **Step 3: Implement `readStoredFile`**

Append to `backend/src/lib/private-files.ts` (`GetObjectCommand` is already imported):

```ts
/** The bytes of a stored file: a reference is read from its private bucket, a plain link over HTTP. */
export async function readStoredFile(value: string): Promise<Uint8Array> {
  const ref = parsePrivateRef(value)
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
```

- [ ] **Step 4: Use it at the four reads**

`backend/src/lib/document-signing.ts` (`stampFieldsAndSave`, the template) — replace

```ts
  const response = await fetch(template.pdfUrl)
  if (!response.ok) throw new Error(`Failed to fetch template PDF from ${template.pdfUrl}`)
  const templateBytes = new Uint8Array(await response.arrayBuffer())
```

with

```ts
  let templateBytes: Uint8Array
  try {
    templateBytes = await readStoredFile(template.pdfUrl)
  } catch (err) {
    throw new Error(`Failed to fetch template PDF from ${template.pdfUrl}`, { cause: err })
  }
```

`backend/src/lib/document-signing.ts` (`maybeCompleteDocument`, the current signed PDF) — replace

```ts
  const response = await fetch(instance.signedPdfUrl)
  if (!response.ok)
    throw new Error(`Failed to fetch current signed PDF from ${instance.signedPdfUrl}`)
  const currentPdfBytes = new Uint8Array(await response.arrayBuffer())
```

with

```ts
  let currentPdfBytes: Uint8Array
  try {
    currentPdfBytes = await readStoredFile(instance.signedPdfUrl)
  } catch (err) {
    throw new Error(`Failed to fetch current signed PDF from ${instance.signedPdfUrl}`, {
      cause: err,
    })
  }
```

and add `import { readStoredFile } from './private-files'` to its imports.

`backend/src/routes/documents.ts` (create instance) — replace

```ts
    const resp = await fetch(tpl.pdfUrl)
    if (resp.ok) {
      const templateBytes = new Uint8Array(await resp.arrayBuffer())
```

with

```ts
    // A template that cannot be read skips the copy; the signing flow reads the
    // template again later. (Before, only an HTTP error skipped — a network
    // error failed the whole request with a 500.)
    const templateBytes = await readStoredFile(tpl.pdfUrl).catch(() => null)
    if (templateBytes) {
```

`backend/src/routes/documents.ts` (sign) — replace

```ts
    const resp = await fetch(tpl.pdfUrl)
    if (!resp.ok) return c.json({ error: 'Could not load template PDF' }, 502)
    const templateBytes = new Uint8Array(await resp.arrayBuffer())
```

with

```ts
    let templateBytes: Uint8Array
    try {
      templateBytes = await readStoredFile(tpl.pdfUrl)
    } catch {
      return c.json({ error: 'Could not load template PDF' }, 502)
    }
```

and add `import { readStoredFile } from '../lib/private-files'` to its imports.

- [ ] **Step 5: Run the test, typecheck**

Run: `cd backend && env -u DATABASE_URL npx vitest run tests/unit/read-stored-file.test.ts` → PASS (3 tests).
Run: `cd backend && npx tsc --noEmit -p tsconfig.json` → 0 errors.
Run: `grep -rnE "fetch\((template|tpl|instance)\.(pdfUrl|signedPdfUrl)\)" backend/src` → no output
(no stored file is fetched over HTTP any more).

---

### Task 7: R2 settings — private bucket, per-bucket test, usage of both

**Files:**
- Modify: `backend/src/routes/integrations.ts` (GET `/r2`, `testS3Compat`)
- Modify: `backend/src/lib/storage-providers.ts` (`s3CompatUsage`)
- Modify: `portals/src/lib/actions/integrations.ts` (R2 types)
- Modify: `portals/src/features/integrations/components/s3-compatible-config-card.tsx`
- Modify: `portals/src/features/integrations/components/r2-config-card.tsx`
- Test: `backend/tests/routes/integrations-storage.test.ts`
- Test: `portals/tests/unit/r2-config-card.test.tsx`

**Interfaces:**
- Consumes: `getPrivateTarget`, `supportsObjectAcl` (Task 2).
- Produces:
  - GET `/api/integrations/r2` adds `privateBucket: string`.
  - POST `/api/integrations/{r2|do-spaces}/test` → `{ ok: boolean; error?: string; buckets: Array<{ role: 'public' | 'private'; bucket: string; ok: boolean; error?: string }> }`.
  - `S3CompatibleConfigCard` prop `withPrivateBucket?: boolean`.

- [ ] **Step 1: Write the failing backend route test**

```ts
// backend/tests/routes/integrations-storage.test.ts
/**
 * Integrations → R2: the private bucket is saved and shown, Test checks both
 * buckets with a list call (least-privilege tokens cannot HeadBucket), and
 * usage adds both buckets up.
 */
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

const R2 = {
  endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
  bucket: 'denel-public',
  privateBucket: 'denel-private',
  region: 'auto',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secretEXAMPLE',
  publicUrl: 'https://pub-test.r2.dev',
}

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
  },
  validateBackendEnv: vi.fn(),
  isDevEnvironment: () => false,
  resolvedEnvironment: () => 'production',
}))
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/integrations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/integrations')>()),
  getR2Config: vi.fn(async () => ({
    endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
    bucket: 'denel-public',
    privateBucket: 'denel-private',
    region: 'auto',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'secretEXAMPLE',
    publicUrl: 'https://pub-test.r2.dev',
  })),
}))
vi.mock('../../src/rbac/middleware/verifySession', () => ({
  verifySession:
    () =>
    async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      c.set('user', { id: 'u-admin', email: 'a@b.c', name: 'Admin', roleId: 'admin', role: 'admin' })
      await next()
    },
}))
vi.mock('../../src/rbac/middleware/checkPermission', () => ({
  checkPermission: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))

import { integrationsApp } from '../../src/routes/integrations'

let listed: string[]
let failBucket: string | null
beforeEach(() => {
  listed = []
  failBucket = null
  vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
    if (!(command instanceof ListObjectsV2Command)) throw new Error('unexpected command')
    const bucket = command.input.Bucket ?? ''
    listed.push(bucket)
    if (bucket === failBucket) throw new Error('AccessDenied')
    return { Contents: [{ Size: bucket === 'denel-public' ? 100 : 250 }], IsTruncated: false } as never
  })
})
afterEach(() => vi.restoreAllMocks())

const app = () => {
  const a = new Hono<HonoEnv>()
  a.route('/api/integrations', integrationsApp)
  return a
}

describe('R2 settings', () => {
  it('returns the saved private bucket', async () => {
    const body = (await (await app().request('/api/integrations/r2')).json()) as {
      data: { bucket: string; privateBucket: string }
    }

    expect(body.data).toMatchObject({ bucket: R2.bucket, privateBucket: R2.privateBucket })
  })

  it('tests both buckets with a list call', async () => {
    const res = await app().request('/api/integrations/r2/test', { method: 'POST' })
    const body = (await res.json()) as { data: unknown }

    expect(listed).toEqual(['denel-public', 'denel-private'])
    expect(body.data).toEqual({
      ok: true,
      buckets: [
        { role: 'public', bucket: 'denel-public', ok: true },
        { role: 'private', bucket: 'denel-private', ok: true },
      ],
    })
  })

  it('says which bucket failed', async () => {
    failBucket = 'denel-private'

    const body = (await (await app().request('/api/integrations/r2/test', { method: 'POST' })).json()) as {
      data: { ok: boolean; error: string; buckets: Array<{ ok: boolean }> }
    }

    expect(body.data.ok).toBe(false)
    expect(body.data.error).toBe('denel-private: AccessDenied')
    expect(body.data.buckets.map((b) => b.ok)).toEqual([true, false])
  })

  it('adds both buckets up in usage', async () => {
    const body = (await (await app().request('/api/integrations/r2/usage')).json()) as {
      data: { usedBytes: number; objectCount: number }
    }

    expect(body.data).toMatchObject({ usedBytes: 350, objectCount: 2 })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && env -u DATABASE_URL npx vitest run tests/routes/integrations-storage.test.ts`
Expected: FAIL — no `privateBucket` in the GET response; the test route sends `HeadBucket` (rejected by the fake); usage counts one bucket.

- [ ] **Step 3: Backend changes**

`backend/src/routes/integrations.ts` — in GET `/r2`'s `data`, after `publicUrl: cfg?.publicUrl ?? '',`:

```ts
      privateBucket: cfg?.privateBucket ?? '',
```

Replace `testS3Compat` (and change the `@aws-sdk/client-s3` import from `HeadBucketCommand` to `ListObjectsV2Command`; add `getPrivateTarget` to the `../lib/storage-providers` import):

```ts
async function testS3Compat(providerId: 'r2' | 'do_spaces', c: any) {
  const adapter = getProvider(providerId)
  if (adapter.kind !== 's3-compat') {
    return c.json({ success: true, data: { ok: false, error: 'Not an S3-compatible provider' } })
  }
  // A list call, not HeadBucket: Cloudflare's least-privilege "Object Read &
  // Write" token covers listing objects but not bucket-level operations.
  const checks: Array<{ role: 'public' | 'private'; bucket: string; client: S3Client }> = []
  try {
    const runtime = await buildS3CompatRuntime(adapter)
    checks.push({ role: 'public', bucket: runtime.bucket, client: runtime.client })
    if (!adapter.supportsObjectAcl) {
      const target = await getPrivateTarget(providerId)
      checks.push({ role: 'private', bucket: target.bucket, client: target.client })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ success: true, data: { ok: false, error: message, buckets: [] } })
  }

  const buckets: Array<{ role: 'public' | 'private'; bucket: string; ok: boolean; error?: string }> = []
  for (const check of checks) {
    try {
      await check.client.send(new ListObjectsV2Command({ Bucket: check.bucket, MaxKeys: 1 }))
      buckets.push({ role: check.role, bucket: check.bucket, ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      buckets.push({ role: check.role, bucket: check.bucket, ok: false, error: message })
    }
  }
  const failed = buckets.find((b) => !b.ok)
  return c.json({
    success: true,
    data: failed
      ? { ok: false, error: `${failed.bucket}: ${failed.error}`, buckets }
      : { ok: true, buckets },
  })
}
```

(add `import type { S3Client } from '@aws-sdk/client-s3'` alongside the command import).

`backend/src/lib/storage-providers.ts` — replace `s3CompatUsage` with:

```ts
async function s3CompatUsage(
  adapter: S3CompatAdapter,
  cfg: S3CompatConfig
): Promise<ProviderUsage> {
  const runtime = await buildS3CompatRuntime(adapter)
  const stores = [{ client: runtime.client, bucket: runtime.bucket }]
  if (!adapter.supportsObjectAcl) {
    // R2 keeps private files in a second bucket; count it once it exists.
    const target = await getPrivateTarget(adapter.id).catch(() => null)
    if (target) stores.push({ client: target.client, bucket: target.bucket })
  }

  let usedBytes = 0
  let objectCount = 0
  let partial = false
  for (const store of stores) {
    let continuationToken: string | undefined
    do {
      const res = await store.client.send(
        new ListObjectsV2Command({
          Bucket: store.bucket,
          MaxKeys: PAGE_SIZE,
          ContinuationToken: continuationToken,
        })
      )
      for (const obj of res.Contents ?? []) {
        usedBytes += Number(obj.Size ?? 0)
        objectCount += 1
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
      if (objectCount >= MAX_LIST_OBJECTS && continuationToken) {
        partial = true
        break
      }
    } while (continuationToken)
    if (partial) break
  }

  const quotaBytes = cfg.quotaGB && cfg.quotaGB > 0 ? Math.round(cfg.quotaGB * 1024 ** 3) : null

  return {
    usedBytes,
    quotaBytes,
    objectCount,
    partial,
    note: partial ? `scanned first ${MAX_LIST_OBJECTS.toLocaleString()} objects` : undefined,
  }
}
```

- [ ] **Step 4: Run the backend test to verify it passes**

Run: `cd backend && env -u DATABASE_URL npx vitest run tests/routes/integrations-storage.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing portal test**

```tsx
// portals/tests/unit/r2-config-card.test.tsx
/**
 * Integrations → R2: a private bucket next to the public one, and a Test that
 * reports each bucket. DigitalOcean Spaces keeps one bucket (per-object ACLs).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { DoSpacesConfigCard } from '@/features/integrations/components/do-spaces-config-card'
import { R2ConfigCard } from '@/features/integrations/components/r2-config-card'
import { api } from '@/lib/api-client'
import { renderWithRouter } from './_test-utils'

const mockGet = vi.mocked(api.get)
const mockPost = vi.mocked(api.post)
const mockPut = vi.mocked(api.put)

const STATUS = {
  endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
  bucket: 'denel-dev-public',
  privateBucket: 'denel-dev-private',
  region: 'auto',
  publicUrl: 'https://pub-test.r2.dev',
  quotaGB: null,
  hasAccessKey: true,
  hasSecretKey: true,
  accessKeyMasked: '••••MPLE',
  secretKeyMasked: '••••MPLE',
}

beforeEach(() => {
  mockGet.mockImplementation(async (path: string) =>
    path.endsWith('/usage')
      ? { success: true, data: { usedBytes: 0, quotaBytes: null, objectCount: 0, partial: false } }
      : { success: true, data: STATUS }
  )
  mockPut.mockResolvedValue({ success: true })
})
afterEach(() => vi.clearAllMocks())

describe('R2 settings card', () => {
  it('shows the public and private buckets', async () => {
    renderWithRouter(<R2ConfigCard />)

    expect(await screen.findByLabelText('Public bucket')).toHaveValue('denel-dev-public')
    expect(screen.getByLabelText('Private bucket')).toHaveValue('denel-dev-private')
  })

  it('saves the private bucket', async () => {
    renderWithRouter(<R2ConfigCard />)
    fireEvent.change(await screen.findByLabelText('Private bucket'), {
      target: { value: 'denel-dev-vault' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockPut).toHaveBeenCalled())
    expect(mockPut.mock.calls[0][1]).toMatchObject({ privateBucket: 'denel-dev-vault' })
  })

  it('reports each bucket after a test', async () => {
    mockPost.mockResolvedValue({
      success: true,
      data: {
        ok: false,
        error: 'denel-dev-private: AccessDenied',
        buckets: [
          { role: 'public', bucket: 'denel-dev-public', ok: true },
          { role: 'private', bucket: 'denel-dev-private', ok: false, error: 'AccessDenied' },
        ],
      },
    })
    renderWithRouter(<R2ConfigCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText('✓ Public bucket denel-dev-public')).toBeInTheDocument()
    expect(screen.getByText('✗ Private bucket denel-dev-private — AccessDenied')).toBeInTheDocument()
  })

  it('has no private bucket field for DigitalOcean Spaces', async () => {
    renderWithRouter(<DoSpacesConfigCard />)

    expect(await screen.findByLabelText('Bucket')).toBeInTheDocument()
    expect(screen.queryByLabelText('Private bucket')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd portals && npx vitest run tests/unit/r2-config-card.test.tsx`
Expected: FAIL — no "Public bucket" / "Private bucket" labels.

- [ ] **Step 7: Portal types**

`portals/src/lib/actions/integrations.ts` — add `privateBucket: string` to both `R2Status` and `R2WritePayload` (after `publicUrl`), and replace `testR2` with:

```ts
export type StorageBucketCheck = {
  role: 'public' | 'private'
  bucket: string
  ok: boolean
  error?: string
}
export type StorageTestResult = { ok: boolean; error?: string; buckets?: StorageBucketCheck[] }

export const testR2 = () => api.post<StorageTestResult>('/api/integrations/r2/test', {})
```

and change `testDoSpaces`'s generic to `StorageTestResult` as well.

- [ ] **Step 8: The shared card**

In `s3-compatible-config-card.tsx`:

1. Import the result type: `import { SECRET_SENTINEL, type StorageTestResult } from '@/lib/actions/integrations'`.
2. Add `privateBucket?: string` to both `S3CompatStatus` and `S3CompatWritePayload`.
3. Add the prop to `S3CompatibleConfigCardProps` and change `tester`'s data type:

```ts
  /**
   * R2 only: a second bucket for private files (R2 has no per-object ACL).
   * DO Spaces keeps one bucket and marks private objects with an ACL.
   */
  withPrivateBucket?: boolean
```

```ts
  tester: () => Promise<{
    success: boolean
    data?: StorageTestResult
    error?: string
  }>
```

4. Destructure `withPrivateBucket = false`; add state and seeding:

```ts
  const [testResult, setTestResult] = useState<StorageTestResult | null>(null)
  const [privateBucket, setPrivateBucket] = useState('')
```

```ts
    setPrivateBucket(status.privateBucket ?? '')
```

(inside the `useEffect`, after `setBucket(status.bucket)`).

5. In `handleSave`'s payload, after `bucket,`:

```ts
        ...(withPrivateBucket ? { privateBucket } : {}),
```

6. Labels and the new field — replace the Bucket block and the public URL label:

```tsx
          <div className="space-y-1.5">
            <Label htmlFor={id('bucket')}>{withPrivateBucket ? 'Public bucket' : 'Bucket'}</Label>
            <Input
              id={id('bucket')}
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              disabled={loading}
            />
          </div>
          {withPrivateBucket && (
            <div className="space-y-1.5">
              <Label htmlFor={id('private-bucket')}>Private bucket</Label>
              <Input
                id={id('private-bucket')}
                value={privateBucket}
                onChange={(e) => setPrivateBucket(e.target.value)}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Everything except branding. Give it no public access.
              </p>
            </div>
          )}
```

```tsx
            <Label htmlFor={id('public')}>
              {withPrivateBucket ? 'Public bucket URL' : 'Public URL prefix'}
            </Label>
```

7. Test results — replace the whole button row (from
   `<div className="flex flex-wrap items-center gap-2">` through its closing
   `</div>`, just above `<StorageUsagePanel`) with:

```tsx
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleSave} disabled={loading || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={loading || testing || saving}>
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          {testResult && !testResult.buckets?.length && (
            <span
              className={`text-sm font-medium ${testResult.ok ? 'text-emerald-600' : 'text-destructive'}`}
            >
              {testResult.ok ? '✓ Connected' : `✗ ${testResult.error}`}
            </span>
          )}
        </div>

        {testResult?.buckets && testResult.buckets.length > 0 && (
          <ul className="space-y-1 text-sm">
            {testResult.buckets.map((b) => (
              <li
                key={b.role}
                className={`font-medium ${b.ok ? 'text-emerald-600' : 'text-destructive'}`}
              >
                {b.ok
                  ? `✓ ${b.role === 'public' ? 'Public' : 'Private'} bucket ${b.bucket}`
                  : `✗ ${b.role === 'public' ? 'Public' : 'Private'} bucket ${b.bucket} — ${b.error}`}
              </li>
            ))}
          </ul>
        )}
```

   A result without `buckets` (a configuration error before any bucket was
   tried) still shows the single ✓/✗ line.

8. `r2-config-card.tsx` — pass the prop and update the copy:

```tsx
    <S3CompatibleConfigCard
      providerId="r2"
      usageProviderId="r2"
      label="Cloudflare R2"
      description="S3-compatible object storage: a public bucket for branding, a private bucket for everything else."
      endpointPlaceholder="https://<account-id>.r2.cloudflarestorage.com"
      regionPlaceholder="auto"
      // REQUIRED for R2: the public bucket's r2.dev URL or custom domain.
      publicUrlPlaceholder="https://pub-xxxx.r2.dev — required"
      withPrivateBucket
      statusLoader={getR2Status}
      saver={saveR2}
      tester={testR2}
    />
```

- [ ] **Step 9: Run the portal test, typecheck both apps**

Run: `cd portals && npx vitest run tests/unit/r2-config-card.test.tsx` → PASS (4 tests).
Run: `cd portals && npx tsc --noEmit -p tsconfig.json` → 0 errors.
Run: `cd backend && npx tsc --noEmit -p tsconfig.json` → 0 errors.

---

### Task 8: Round trip on a real database, full verification, docs

**Files:**
- Test: `backend/tests/integration/private-files-roundtrip.test.ts`
- Modify: `project-docs/secrets-and-integrations.md` (Cloudflare R2 row + notes)
- Modify: `project-docs/private-file-storage-design.md` (status line)
- Modify: `CLAUDE.md` (docs-table row: "spec — not yet built" → "built 2026-MM-DD")

**Interfaces:**
- Consumes: everything above; `patientsApp`, `uploadApp`, `staffMemosApp`, `staffRegistrationApp`.

- [ ] **Step 1: Write the round-trip test**

```ts
// backend/tests/integration/private-files-roundtrip.test.ts
/**
 * The whole path, on a real database with a fake object store: upload → the
 * screen receives a link → it saves that link on a record → the database holds
 * the reference → reading the record returns a fresh link. Commits rows, so it
 * refuses anything but a local Postgres and deletes what it created.
 *
 *   DATABASE_URL=postgresql://framada:framada@localhost:5499/framada \
 *     npx vitest run tests/integration/private-files-roundtrip.test.ts
 */
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

const RAW_DB_URL = process.env.DATABASE_URL ?? ''
const IS_LOCAL = /@(localhost|127\.0\.0\.1|host\.docker\.internal)([:/]|$)/.test(RAW_DB_URL)

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost:5499/framada',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
  validateBackendEnv: vi.fn(),
  isSelfHealEnabled: () => false,
  isDevEnvironment: () => false,
  resolvedEnvironment: () => 'production',
}))
vi.mock('../../src/lib/rbac')
vi.mock('../../src/lib/audit', () => ({
  createAuditLog: vi.fn(),
  recordDiffAudit: vi.fn(),
  computeChangedFields: vi.fn(() => ({})),
  redactForAudit: vi.fn((row: unknown) => row),
  auditMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
  // routes/patients.ts imports this; a mock without it fails the import.
  DEFAULT_SMS_TEMPLATES: { welcome: 'welcome {Patientname}' },
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/integrations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/integrations')>()),
  getR2Config: vi.fn(async () => ({
    endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
    bucket: 'denel-public',
    privateBucket: 'denel-private',
    region: 'auto',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'secretEXAMPLE',
    publicUrl: 'https://pub-test.r2.dev',
  })),
  getStorageRouting: vi.fn(async () => null),
}))

import { eq, sql } from 'drizzle-orm'
import { type DB, getDb } from '../../src/db'
import { patients, staffMemos, staffRegistrationInvites } from '../../src/db/schema'
import { privateFileLinks } from '../../src/lib/private-file-links'
import { parsePrivateRef } from '../../src/lib/private-files'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { patientsApp } from '../../src/routes/patients'
import { staffMemosApp } from '../../src/routes/staff-memos'
import { staffRegistrationApp } from '../../src/routes/staff-registration'
import { uploadApp } from '../../src/routes/upload'
import { sweepLeakedFixtures } from './_fixtures'

const TAG = `pf-${Date.now()}`
const PRIVATE_HOST = 'denel-private.0123456789abcdef.r2.cloudflarestorage.com'
// 1×1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

let db: DB
let adminUserId: string
let patientId: string
const created = { memos: [] as string[], invites: [] as string[] }
const store = new Map<string, Uint8Array>()

function app(): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>()
  a.use('/api/*', privateFileLinks())
  a.route('/api/upload', uploadApp)
  a.route('/api/patients', patientsApp)
  a.route('/api/staff', staffMemosApp)
  a.route('/api/staff-registration', staffRegistrationApp)
  return a
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe.skipIf(!IS_LOCAL)('private files — round trip on a real database', () => {
  beforeAll(async () => {
    db = getDb(RAW_DB_URL)
    await sweepLeakedFixtures()
    const users = await db.execute<{ id: string }>(sql`SELECT id FROM "user" ORDER BY "createdAt" LIMIT 1`)
    adminUserId = users.rows[0]?.id
    if (!adminUserId) throw new Error('No rows in "user" — run seed-admin first')
    const [p] = await db
      .insert(patients)
      .values({ name: `IT Private Files ${TAG}`, dob: new Date('1990-01-01'), gender: 'other' })
      .returning({ id: patients.id })
    patientId = p.id
  })

  afterAll(async () => {
    if (!db) return
    for (const id of created.memos) await db.delete(staffMemos).where(eq(staffMemos.id, id))
    for (const id of created.invites)
      await db.delete(staffRegistrationInvites).where(eq(staffRegistrationInvites.id, id))
    await sweepLeakedFixtures()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: adminUserId,
      email: 'admin@framada.app',
      name: 'Admin',
      role: 'admin',
      roleId: 'admin',
    })
    vi.mocked(checkPermission).mockResolvedValue(true)
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        const { Bucket, Key, Body } = command.input
        store.set(`${Bucket}/${Key}`, new Uint8Array(Body as Buffer))
        return {} as never
      }
      if (command instanceof GetObjectCommand) {
        const bytes = store.get(`${command.input.Bucket}/${command.input.Key}`)
        return { Body: { transformToByteArray: async () => bytes } } as never
      }
      if (command instanceof DeleteObjectCommand) return {} as never
      throw new Error('unexpected S3 command')
    })
  })

  it('a patient photo: link on screen, reference in the database, fresh link on read, kept on re-save', async () => {
    const form = new FormData()
    form.append('file', new File([PNG], 'photo.png', { type: 'image/png' }))
    form.append('storageCategory', 'patient_records')
    form.append('folder', `patients/${patientId}`)
    const upload = (await (await app().request('/api/upload', { method: 'POST', body: form })).json()) as {
      url: string
    }

    expect(new URL(upload.url).host).toBe(PRIVATE_HOST)

    const saved = await app().request(`/api/patients/${patientId}`, json('PATCH', { profileImage: upload.url }))
    expect(saved.status).toBe(200)

    const [row] = await db
      .select({ profileImage: patients.profileImage })
      .from(patients)
      .where(eq(patients.id, patientId))
    expect(parsePrivateRef(row.profileImage ?? '')?.key).toMatch(new RegExp(`^patients/${patientId}/`))

    const read = (await (await app().request(`/api/patients/${patientId}`)).json()) as {
      data: { profileImage: string }
    }
    expect(new URL(read.data.profileImage).host).toBe(PRIVATE_HOST)

    // The Edit sheet sends every field back, the shown photo link included.
    const resaved = await app().request(
      `/api/patients/${patientId}`,
      json('PATCH', { profileImage: read.data.profileImage, occupation: `Tester ${TAG}` })
    )
    expect(resaved.status).toBe(200)
    const [after] = await db
      .select({ profileImage: patients.profileImage })
      .from(patients)
      .where(eq(patients.id, patientId))
    expect(after.profileImage).toBe(row.profileImage)
  })

  it('a memo image survives the editor round trip (&amp; form) and the sanitiser', async () => {
    const form = new FormData()
    form.append('file', new File([PNG], 'diagram.png', { type: 'image/png' }))
    form.append('folder', 'memos')
    const upload = (await (await app().request('/api/upload', { method: 'POST', body: form })).json()) as {
      url: string
    }
    const html = `<p>See</p><img src="${upload.url.replaceAll('&', '&amp;')}">`

    const res = await app().request(
      '/api/staff/memos',
      json('POST', { title: `IT memo ${TAG}`, content: html })
    )
    const body = (await res.json()) as { data: { id: string } }
    created.memos.push(body.data.id)

    const [memo] = await db
      .select({ content: staffMemos.content })
      .from(staffMemos)
      .where(eq(staffMemos.id, body.data.id))
    expect(memo.content).toContain('src="private-file://r2/memos/')
  })

  it('a staff CV is stored privately', async () => {
    const [invite] = await db
      .insert(staffRegistrationInvites)
      .values({
        token: `it-${TAG}`,
        status: 'pending',
        phoneVerified: true,
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning({ id: staffRegistrationInvites.id })
    created.invites.push(invite.id)
    const form = new FormData()
    form.append('file', new File([Buffer.from('%PDF-1.4\n%%EOF')], 'cv.pdf', { type: 'application/pdf' }))

    const res = await app().request(`/api/staff-registration/public/it-${TAG}/cv`, {
      method: 'POST',
      body: form,
    })
    expect(res.status).toBe(200)

    const [row] = await db
      .select({ cvUrl: staffRegistrationInvites.cvUrl })
      .from(staffRegistrationInvites)
      .where(eq(staffRegistrationInvites.id, invite.id))
    expect(parsePrivateRef(row.cvUrl ?? '')?.key).toMatch(/^staff\/registration\//)
  })
})
```

- [ ] **Step 2: Run it on a throwaway database**

Docker is installed on this machine (Podman works the same way). Port 5499 keeps
it away from the user's `framada-dev-db` on 5433.

```bash
docker run -d --name denel-private-files-db -e POSTGRES_USER=framada -e POSTGRES_PASSWORD=framada \
  -e POSTGRES_DB=framada -p 5499:5432 postgres:17-alpine
# wait until it accepts connections
until docker exec denel-private-files-db pg_isready -U framada >/dev/null 2>&1; do sleep 1; done
cd backend
export DATABASE_URL=postgresql://framada:framada@localhost:5499/framada \
  BETTER_AUTH_SECRET=throwaway-test-secret-at-least-32-characters \
  BETTER_AUTH_URL=http://localhost:3000 SEED_ADMIN_PASSWORD=throwaway-test-password
node migrate.mjs && npx tsx src/scripts/seed-rbac.ts && npx tsx src/scripts/seed-admin.ts
npx vitest run tests/integration/private-files-roundtrip.test.ts
```

Expected: PASS (3 tests). If the memo test fails on a required field, read the
`POST /memos` handler in `staff-memos.ts` and add that field to the request —
the assertion on the stored `content` must stay as written.

- [ ] **Step 3: Full verification**

```bash
cd backend && npx vitest run            # full suite, DATABASE_URL still pointing at 5499
cd ../portals && npx vitest run
cd .. && node scripts/lint-ratchet.mjs && node scripts/api-contract-audit.mjs
pnpm turbo run build --filter=portal --filter=backend
cd backend && npx tsc --noEmit -p tsconfig.json && cd ../portals && npx tsc --noEmit -p tsconfig.json
docker rm -f denel-private-files-db
```

Expected: 0 failed tests in both apps (record the pass counts in the hand-off);
ratchet OK (run `node scripts/lint-ratchet.mjs --update` only if a workspace went
*down*); contract audit 0 findings; both builds succeed; both typechecks 0. The
container is removed even if a step failed.

- [ ] **Step 4: Docs**

- `project-docs/secrets-and-integrations.md` — replace the Cloudflare R2 row's
  "What to obtain" with: *two buckets (public for branding, private for
  everything else); one R2 API token with Object Read & Write on both; the public
  bucket's r2.dev URL (or custom domain); endpoint
  `https://<account-id>.r2.cloudflarestorage.com`; region `auto`; the CORS rule
  in `private-file-storage-design.md` §4.7*, and add a note that private files
  are served through 60–75 minute signed links.
- `project-docs/private-file-storage-design.md` — status line →
  `**Status:** built <date>; live-tested with R2 <date or "pending">`.
- `CLAUDE.md` — the design row's "(2026-09-26, spec — not yet built)" →
  "(designed 2026-09-26, built <date>)"; the plan row's "not yet executed" →
  "executed <date>".

---

### Task 9: Live test with the user's R2 (hand-off, no code)

The user does steps 1–4; the implementer reads results back from the database
and the backend log, never printing secrets.

0. **Doppler** (`denel` / `dev`): add `PRIVATE_FILE_REF_SECRET` — a random value
   of at least 32 characters (`openssl rand -base64 48`). Never change it after.
1. **Cloudflare** (dashboard → R2): create `denel-dev-public` and
   `denel-dev-private`; on `denel-dev-public` enable the **r2.dev** public URL
   (Settings → Public access); leave `denel-dev-private` with no public access;
   add the CORS rule from the design doc §4.7 to **both** buckets; create an
   **R2 API token** with **Object Read & Write** on both buckets and note the
   Access Key ID, Secret Access Key and the account's S3 endpoint.
2. **Restart the backend** (`pnpm dev:local` in `backend/`); the portal reloads.
3. **Portal → Settings → Integrations → Cloudflare R2**: endpoint, public bucket
   `denel-dev-public`, private bucket `denel-dev-private`, region `auto`, public
   bucket URL (the r2.dev URL), both keys → **Save** → **Test connection**:
   both buckets show ✓.
4. **Try it**: upload the clinic logo (Integrations → Branding) → it shows; open
   its link in a private window → it loads (public). Add an X-ray or patient
   photo → it shows; copy its link → it opens now, and fails after 75 minutes.
   Edit and save that patient → the photo is still there. Integrations → Backup:
   run a backup → status ok.
5. **Implementer checks** (read-only): the X-ray row's column holds a
   `private-file://r2/…` reference; `SELECT value->>'lastStatus' FROM
   clinic_settings WHERE key = 'integration_backup'` is `ok`.

If the backup (the one streamed upload) fails with a checksum or `aws-chunked`
error, read the backend log line and fix it in `buildS3CompatRuntime` /
`getPrivateTarget` before calling R2 done.

---

## Execution record — final review and fixes (2026-09-26)

Tasks 1–8 were executed test-first (no commits, per the user's rule). A fresh
reviewer then reviewed the whole change; every Critical/Important finding was
verified against the code before acting, and each fix was made test-first.

**Fixed**

| Finding | Fix | Tests |
|---|---|---|
| C1 — any signed-in user could get a link to any private key: the response layer signed references without checking their tag, and the request check could be bypassed (non-JSON content type, JSON escapes, Better Auth `update-user`) | Only references whose tag verifies are signed; tags keyed by the new dedicated `PRIVATE_FILE_REF_SECRET` (user decision); the request layer scans every non-multipart write body and undoes JSON escapes first | `private-files-refs` (secret), `private-file-links-response` (planted reference never signed; missing secret degrades), `private-file-links-request` (text/plain, `p`, `\/`) |
| C2 — unauthenticated CPU cost: one full signature computation per link, repeated, unbounded | Link prefix worked out once per request, each distinct link checked once, more than 200 distinct links refused | `private-file-links-request` (repeated link = 2 signing calls; 201 links refused with no signing) |
| I1 — Employee Data Sheet PDF lost the staff photo (Puppeteer renders outside the API edge) | `buildEmployeeDataSheetHtml` (now async) swaps references for signed links | `employee-data-sheet-photo` |
| I2 — a genuine link converted back at any age, so leaked links could be revived forever | Links older than 7 days refuse the save with 409 "This page is out of date — reload it and save again" (user decision) | `private-file-links-request` (6 days converts, 8 days refused) |
| M2 → Important — same bucket as public and private accepted | Refused on save (`PUT /r2`) and at use (`getPrivateTarget`) | `integrations-storage`, `private-files-signing` |
| M4 → Important — compliance screens showed `file.pdf?X-Amz-…` as the name | `portals/src/shared/lib/file-name.ts` used by the compliance dialog and renewal sheet | `file-name-from-url` |
| (startup) deployed instances without the secret | Staging/production refuse to start (`config/env.ts`) | `env-private-file-secret`; `sms-delivery`'s production profile now includes the secret |

**Deferred minors** (not fixed; recorded for later)

- M1 — if reading the storage settings fails mid-save, genuine links are saved as expiring links.
- M3 — R2 Test with no private bucket reports only the configuration error, not the public bucket's result.
- M5 — each distinct reference costs ~0.8 ms to sign per response and is not cached across requests (a 500-photo screen ≈ +0.4 s).
- M6 — the link pattern does not stop at `)`, so a link inside CSS `url(...)` would lose its closing bracket (the HTML sanitiser strips such styles anyway).
- M7 — keys with `.`/`..` path segments (client-chosen `folder`/`name` in `/api/upload`) do not convert back.
- M8 — a signed link pasted into an outgoing SMS/email is sent as a reference.
- M9 — creating a document instance whose template cannot be read skips the copy without logging.
- M10 — patient statements generated before this change (in the old public bucket) would not be found in the private bucket; none exist locally — check before production rollout.
- M11 (partly) — no test for a DigitalOcean Spaces link converting back.

**Verification after the fixes:** backend full suite against a throwaway
Postgres 134 files / 1341 tests passed; portal 205 passed; both typechecks 0;
Biome 0 errors, lint ratchet not increased; API contract audit 0 findings;
portal + backend builds succeed.

---

## Execution record — live test and second review (2026-09-26/27)

**Live test so far:** R2 configured (two buckets, one Object R&W token, CORS, the
secret) — Test connection ✓ both buckets; a patient photo round trip passed (the
database holds `private-file://r2/avatars/<name>.jpg#<tag>`, no expiring link was
saved). The branding upload lives at Settings → Clinic Profile → Brand Assets.

**Bugs the live test exposed (pre-existing, fixed test-first):** the CSRF check
had no exception for `/api/internal/cron`, so "Run now" and every QStash delivery
were rejected; the backup recorded its status with `updatedById = 'system'`
(foreign-key violation, which also hid the real error), and it needed a `gzip`
program — it now runs `pg_dump` without a shell and compresses with Node.

**Second independent review** (8 angles, every finding checked by two skeptics,
then by the executor against the code) and a sweep of all five apps for screens
that misbehave when a link is re-signed. Fixed, each with a test that failed
first:

| Area | Fix |
|---|---|
| Security | The server reads (`readStoredFile`) and signs only references whose tag verifies; the request layer checks every non-multipart body whatever its Content-Type (a body labelled multipart must really start with its boundary), refuses JSON too deeply nested to re-serialise, reads bodies only up to the route's size limit even without a Content-Length (`lib/body-limit.ts`, shared with the size guard), checks each distinct reference once, stops at the first bad one and refuses more than 200; the tag key is derived once; a missing secret answers 503 |
| Exports | Settings export and Data inject table export keep the permanent references (`c.set('keepPrivateRefs', true)`) so old exports re-import (user decision) |
| Backup | Outcome written onto the latest settings, temp file always closed, "Run now" waits up to 5 minutes; the production image installs `pg_dump` 17 (proved in a throwaway image); the deploy gate checks `PRIVATE_FILE_REF_SECRET` (user decision) |
| Screens (link rotation) | Edit sheets (patient, expense, product, inventory) fill once per opening (`useSeedOnOpen`) and compare file fields with `isSameStoredFileValue`; alert settings fill once; the lab case form re-fills only when the case's own values change; the shared DataTable keeps the user's page (resets on sort/filter, clamps when the list shrinks) and identifies rows by record id when ids are unique; product and inventory lists build their columns once; the appointment alarm keeps the ringing element when only the link changes; the consent PDF preview and the patient document viewer keep their first link for the same file (`useStableFileUrl`) while their buttons use the latest; the expense details and document viewer read the current record; the Team training viewer reopens a module from fresh data |

**Deferred (recorded, not fixed):** HR handbook `.md` export/import carries
signed links; the HR Add-staff draft can restore an expired avatar preview; the
Team "My documents" list is not refreshed while it stays open for over an hour
(the design's accepted link lifetime). **Deferred by the user until after the
live test:** patient photos are stored under a name-derived key
(`avatars/<name>.jpg`; adult patients added from the dashboard all use
`avatars/patient.jpg`), so photos overwrite each other; production CSP needs the
R2 hosts.

**Verification:** backend (throwaway Postgres) 138 files / 1370 tests passed;
portal 36 files / 237; team 3 files / 36; all typechecks 0; Biome 0 errors, lint
ratchet not increased; API contract audit 0 findings; portal, backend and team
builds succeed.

**Live test completed 2026-09-27.** After the backend restart: Cron engine →
`backup-daily` Run → status `ok`; verified from outside the app — one ~100 KB
object in the private bucket at `SYS/backups/daily-6pm/<stamp>-<16 hex>.sql.gz`,
logo/logo-icon/login photos in the public bucket under `SYS/branding/`, the
patient photo stored as a `private-file://` reference, and zero stored values
containing `X-Amz-Signature`. Two extra findings, both fixed test-first: the
Cron engine page rendered a failed run's whole error message (an unbroken
multi-KB string that pushed the Run buttons off-screen — now a 200-char
preview), and the backup recorded that raw message as its status (now a ≤300-char
summary). Note (pre-existing design, not a defect): Brand Assets persists
uploaded links only when Save is clicked.

**Agreed follow-ups, done 2026-09-27 (test-first):** every avatar upload now
gets its own file (`avatar-upload.tsx` appends the upload's timestamp to the
name — before, photos were keyed by patient name and adults added from the
dashboard all overwrote `avatars/patient.jpg`); and all five apps' security
policies allow the R2 hosts in `connect-src`/`frame-src` (+ `media-src` in the
portal), guarded by `csp-r2-headers.test.ts`. Photos uploaded before the fix may
share files — re-upload any affected patient's photo.

**Provider-relationship investigation + fixes (2026-09-27, user request).**
Compared against the original clone (`framada-latest`, the exact parent commit
of ours, storage files byte-identical): the three providers are per-category
*alternatives* behind the routing seam — no sharing, no mirroring, no
cross-provider backup exists in either repo, and all-R2 is the code's own
default. Verdict: not deviating. Two pre-existing traps found and fixed
test-first: the Backup card's "Storage target" was saved but never read (the
backup now uploads via `uploadPrivateToProvider(cfg.targetProvider, …)`,
bypassing category routing), and the Storage routing card offered Cloudinary
for private categories (now unselectable — "can't store private files" — with
a warning if a saved routing still points there).
