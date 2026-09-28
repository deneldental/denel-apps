# Private file storage — two buckets (design)

**Date:** 2026-09-26 · **Status:** built 2026-09-26; live-tested with the
clinic's R2 2026-09-27 (plan `private-file-storage-plan.md`, all 9 tasks — see
its execution records) · **Scope:** backend storage + the Integrations → R2
settings card.

## 1. Problem

Found while setting up Cloudflare R2 (local integrations plan, step 3):

- R2 has **no per-object permissions** (its S3 API lists `x-amz-acl` as not
  implemented; since 2022-11-30 a `public-read` header is accepted and ignored).
  A bucket is either reachable through its public URL or not at all.
- The code **requires** R2 to have a public URL (`buildS3CompatRuntime` throws
  without one) and every upload is `public-read` by default — no upload in the
  codebase asks for `private`. Each upload returns a permanent public link, which
  the screen then saves on the record.
- So every stored file is readable by anyone holding or guessing its link,
  forever: X-rays, clinical and lab-case photos, medical-record attachments,
  patient documents, consent forms, signed documents and signatures, patient and
  staff photos, staff CVs and credential documents, expense and stock receipts,
  supplier/insurance/compliance documents — and **full database backups**, whose
  key (`SYS/backups/<schedule>/<ISO timestamp>.sql.gz`) is predictable.
- Only patient statements already use short-lived signed links
  (`getSignedDownloadUrlForCategory`) — but they sit in the same public bucket.

## 2. Decisions (the user, 2026-09-26)

| Question | Decision |
|---|---|
| How to protect files | **Two buckets**: public and private |
| What stays public | **Branding only** — logo, favicon, logo icons, login-page photos |
| How long a shown link stays valid | **1 hour** |
| Approach | **A — sign at the edge** (below), over per-feature signing or signed-in redirect links |

## 3. Goals and non-goals

**Goals**

1. No private file can be opened except through the app; every link the app shows
   expires (at least 1 hour, at most 75 minutes after it is shown — see 4.3).
2. Backups are never publicly reachable.
3. Every screen that shows, downloads, edits or re-saves a file keeps working,
   in the portal, HR, Team and patient apps, kiosk and X-ray share links.
4. Branding keeps permanent public links (emails, login pages, installed-app icons).
5. Secure by default: an upload that does not choose is private.

**Non-goals**

- No database schema changes and no data migration (existing plain links keep
  working as they are; locally there are none).
- No change to *who* may see a file: a file is visible wherever its record is
  visible today (see 5).
- No Cloudinary private delivery (Cloudinary refuses private uploads — 4.1).
- Production setup (custom domain, production CORS origins, production buckets)
  is part of the production phase, not this change.

## 4. Design

### 4.1 Where files go

- `uploadToCategory(category, key, body, contentType, visibility = 'private')`.
  The `acl` parameter becomes `visibility: 'public' | 'private'`, **default
  private**. Storage routing (category → provider) is unchanged.
- Exactly one caller passes `'public'`: the branding upload
  (`POST /api/integrations/branding/logo`, all six kinds). The staff-registration
  CV upload, which passes `'public-read'` explicitly today, becomes private.
- **R2**: public uploads go to the configured bucket (relabelled *Public bucket*)
  and return `<publicUrl>/<key>` as today; private uploads go to a new **Private
  bucket** (same account endpoint and API token, no public URL) and return a
  private reference (4.2). If the private bucket is not configured, a private
  upload fails with `Cloudflare R2: the private bucket is not configured —
  Settings → Integrations → R2`.
- **DigitalOcean Spaces** keeps one bucket and uses its real per-object ACL:
  `public-read` for public, `private` for private (returns a reference).
- **Cloudinary** cannot keep files private: a private upload routed to it throws
  `Cloudinary can't store private files — in Settings → Integrations → Storage
  routing, send the "<category>" category to Cloudflare R2 or DigitalOcean
  Spaces.` Public (branding) uploads still work.
- **Backups** are private (default) and their key gains a random part:
  `SYS/backups/<schedule>/<stamp>-<16 hex>.sql.gz`. (Found in the live test:
  `pg_dump` now runs without a shell and Node compresses its output — no `gzip`
  program, and a failed `pg_dump` fails the backup instead of saving an empty
  one; the outcome is recorded with no user and on the settings as they are at
  the end of the run; the upload goes to the Backup card's own "Storage
  target" choice, not the file-category routing; the production image
  installs `pg_dump` 17.)

### 4.2 Private file references

A private upload returns — and records store — a reference instead of a link:

```
private-file://<provider>/<key>#<tag>
e.g. private-file://r2/patients/5f2c…/xrays/1727340000000-scan.jpg#9f86d081884c7d65
```

- `provider`: `r2` or `do_spaces` — the store that holds the object, so a later
  change of storage routing cannot orphan it.
- `key`: the object key with every path segment percent-encoded
  (`encodeURIComponent`, plus `! ' ( ) *`), so a reference contains only
  `A–Z a–z 0–9 - _ . ~ % /` and can be found inside HTML without ambiguity.
- `tag`: first 16 hex characters of HMAC-SHA256 over `<provider>/<key>`, keyed
  by `SHA-256("denel.private-file-ref.v1:" + PRIVATE_FILE_REF_SECRET)` — a
  dedicated secret (user decision 2026-09-26, after the final review), so
  rotating `BETTER_AUTH_SECRET` never touches stored files. It proves the backend
  issued the reference (4.3, 4.4, 5). The secret is required in staging and
  production (the backend refuses to start without it); locally, private files
  are unavailable until it is set.
- Detection pattern:
  `private-file://(r2|do_spaces)/([A-Za-z0-9._~%/-]+)#([0-9a-f]{16})`.
- References live in the existing text columns (about 35 file columns across
  clinical, documents, staff, billing, inventory, operations and settings tables)
  and inside rich-text HTML (memo, handbook and training content).

Screens never see references (4.3), and nothing outside the backend should ever
produce one.

### 4.3 Response layer — references become links

A backend-wide middleware, mounted before all routes (right after the body-size
guard, which must reject an oversized body before the request layer in 4.4 reads
it), inspects every response:

- Only `application/json` bodies are touched; anything else (PDF, CSV, HTML,
  redirects, streams) passes through unchanged.
- Fast path: if the body does not contain `private-file://`, the response is
  returned untouched.
- Otherwise every reference in the raw JSON text — including inside HTML
  strings — **whose tag verifies** is replaced by a presigned `GetObject` URL for
  its provider and key. A reference whose tag does not verify (planted by a
  client through any path) is never signed; it stays as text and is logged.
  Each distinct reference is signed once per response.
- **Signing windows**: the signing date is the current time rounded down to 15
  minutes and the expiry is 75 minutes, so a link is valid for at least 1 hour
  and at most 75 minutes after it is shown, and every request inside the same
  15-minute window gets the *identical* URL — the browser's image cache keeps
  working instead of re-downloading each file on every list refresh.
- Covers every route, including `/api/auth/*`: the signed-in user's photo
  (`user.image`, copied from the staff profile photo in `staff-portal.ts`) comes
  back in the session response.
- Status code and headers (including multiple `Set-Cookie`) are preserved; the
  body is only rebuilt when a reference was found.
- **On failure** (e.g. the private bucket was removed from the settings), the
  references are left in place, the response is sent, and the error is logged
  once per request. Screens show the file as unavailable; see 4.4 for saves.
- **Backup exports keep references.** The settings export and the Data inject
  table export are backups: their routes mark the response
  (`c.set('keepPrivateRefs', true)`), so the file carries the permanent
  references and re-imports any time later (user decision, second review).
- **Links rotate.** The same file's link changes every 15 minutes, so screens
  must not treat a refetched record as edited: edit forms fill once per opening
  (`portals/src/shared/hooks/use-seed-on-open.ts`) and compare file fields with
  `isSameStoredFileValue` (`portals/src/shared/lib/file-name.ts`); embedded
  viewers keep their first link for the same file (`use-stable-file-url.ts`) while
  their buttons use the latest; the shared DataTable keeps the user's page and
  identifies rows by record id; list columns are built once per render input.
  New screens must follow the same rules (see the plan's execution record).

### 4.4 Request layer — links become references again

Screens send links back (upload → create record; edit → save), so every
`POST`/`PUT`/`PATCH`/`DELETE` body passes through the reverse layer before any
route reads it (it rewrites `c.req.raw` and `c.req.bodyCache`; Hono 4.12 keeps
both public) — **whatever its content type says**, because routes parse JSON
with `c.req.json()`, which ignores it. Only a body that really is a multipart
upload (it starts with the boundary its Content-Type names) is not touched; a
reference planted there is harmless, because nothing signs or reads a reference
whose tag does not verify (4.3, 4.5). The body is read with the route's own size
limit even when it arrives without a Content-Length (413 beyond it).
`/api/auth/*` is skipped: those bodies carry credentials, and a reference stored
through them (e.g. Better Auth's `update-user` image) is never signed unless the
server issued it (4.3). JSON escapes (escaped slashes, unicode escapes) are
undone before the scan, so neither a link nor a reference can hide behind them;
JSON nested too deeply to re-serialise is refused (`400`, "This request is nested
too deeply to check").

Fast path: if the body contains neither `X-Amz-Signature` nor `private-file://`,
nothing happens. Otherwise:

1. **Our signed links → references.** A URL is a candidate when its origin and
   path prefix match what our signer produces for a configured private target
   (computed from the same SDK configuration). HTML-escaped ampersands (`&amp;`,
   as rich-text editors serialise them) are accepted. The layer recomputes the
   presigned URL for that key with the URL's own `X-Amz-Date` and `X-Amz-Expires`
   and our credentials; **only if `X-Amz-Signature` matches** is the URL replaced
   by the reference. A genuine link converts for **7 days** after it was signed
   (user decision 2026-09-26, after the final review) — a form left open past
   the hour, or over a weekend, still saves its file. An older genuine link
   refuses the whole save with `409` — "This page is out of date — reload it and
   save again" — so a dead link is never stored, and a leaked link cannot be
   revived indefinitely by someone with an account.
   A URL whose signature does not match is left as plain text: it points into a
   private bucket without a valid signature, so it opens nothing.
   Each distinct link is checked once; the link prefix is worked out once per
   request; more than 200 distinct links in one request is refused with `400`
   ("This request contains too many file links") before any checking — the layer
   runs before sign-in is checked, so its cost must stay bounded.
2. **Raw references** (the failure case in 4.3 sends them back) are accepted if
   their tag verifies, and refused with `400` — "This request contains a file
   reference the server did not issue" — if it does not. Checking stops at the
   first bad reference, repeated references are checked once, and more than 200
   distinct references are refused like links.
3. **No secret.** Without `PRIVATE_FILE_REF_SECRET` nothing can be checked: a
   save that carries a link or reference answers `503` "Private files are not set
   up on this server yet".

### 4.5 Backend reads of stored files

`readStoredFile(value)` returns the bytes of a stored file: a reference is read
with `GetObject` from its provider **only if its tag verifies** (a reference a
client planted — e.g. in a document template's `pdfUrl` — must never make the
server copy out another file); a plain URL is fetched as today. It replaces
the four places the backend downloads its own stored files: the three
`fetch(template.pdfUrl)` calls that stamp signatures onto document templates
(`lib/document-signing.ts`, `routes/documents.ts` ×2) and the
`fetch(instance.signedPdfUrl)` in `maybeCompleteDocument` that adds the audit
page to the signed PDF — templates and signed documents are private under the
branding-only rule. (The ortho-consent cover pages come from
`PDF_TEMPLATE_BASE_URL`, not from storage, and are unaffected.) No outgoing
email or SMS embeds a stored file link (X-ray sharing sends a token page).

Server-rendered HTML sits outside the API edge too: the Employee Data Sheet
(HR and Team app PDF, rendered by Puppeteer) embeds the staff photo, so
`buildEmployeeDataSheetHtml` swaps any reference for a signed link before the
HTML is rendered. (Payroll PDFs embed only the public branding logo.)

### 4.6 Settings, test and usage

- `R2Config` gains `privateBucket`. The R2 card relabels *Bucket* → *Public
  bucket* and *Public URL* → *Public bucket URL*, and adds *Private bucket*. The
  R2 and DO Spaces cards share `S3CompatibleConfigCard`; the private-bucket field
  is an R2-only option of that component (DO Spaces keeps one bucket and uses
  per-object ACLs). Saving the same bucket (ignoring case and spaces) as both
  public and private is refused, and a private target that equals the public
  bucket is refused at use — one such slip would make every private file public.
- **Test** lists at most one object in each configured bucket
  (`ListObjectsV2`, `MaxKeys: 1`) instead of `HeadBucket`, which is a bucket-level
  operation Cloudflare's least-privilege *Object Read & Write* token does not
  cover. It reports each bucket separately.
- Storage usage adds up both buckets.

### 4.7 Bucket CORS rule (setup, no code)

The X-ray viewer and the photo croppers load images with
`crossOrigin = 'anonymous'`, and in-browser PDFs fetch images, so both buckets
need a CORS policy. Local development:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "http://localhost:5176"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

Production origins are added in the production phase. The apps' own security
policies already allow the R2 hosts (`https://*.r2.cloudflarestorage.com`,
`https://*.r2.dev`) in `connect-src`, `frame-src` and — where sound/video plays —
`media-src` (all five `public/_headers`, guarded by
`portals/tests/unit/csp-r2-headers.test.ts`, 2026-09-27); what remains for
production is the buckets' CORS `AllowedOrigins` list and any custom domain.

## 5. Security

| Threat | Mitigation |
|---|---|
| A link is copied, forwarded or leaks via logs/history | It expires within 75 minutes; someone with an account can turn it back into a file for at most 7 days (4.4) |
| Someone guesses a key (e.g. a backup's timestamp) | The private bucket has no public URL; every read needs a valid signature |
| A client points a record at a file it was never shown by sending a reference | Only references whose tag verifies are ever signed (4.3) or read by the server (4.5) — whatever path stored them; the request layer also refuses them, whatever the content type or JSON escaping (4.4) |
| A client sends a fabricated signed URL for another key | Signatures are recomputed and compared; a mismatch converts nothing (4.4) |
| A client floods a request with links or references to burn server time | Each distinct link or reference is checked once, at most 200 per request, stopping at the first refusal; bodies are read only up to the route's size limit (4.4) |
| The same bucket is entered as public and private | Refused on save and at use (4.6) |
| Backups exposed | Private bucket plus an unguessable key |

Access to a file follows the endpoint that returned its record: a patient sees
only their own records in the patient app, staff see what their role's screens
show, share-link viewers see what their token and code unlock. The layers add no
new permissions and remove none.

Rotating `BETTER_AUTH_SECRET` does not affect files: tags are signed with the
dedicated `PRIVATE_FILE_REF_SECRET`. That secret must **never** change and must be
identical wherever this database is restored — changing it makes every stored
private file unviewable (references stop verifying, so none is signed). Rotating
the R2 keys means links issued before the rotation no longer verify in 4.4.

## 6. Failure behaviour

| Situation | Behaviour |
|---|---|
| Private bucket not configured | Private uploads fail with a clear message; public (branding) uploads still work |
| Signing fails when showing a record | References left in place, file shown as unavailable, error logged; saves keep the reference (4.4, rule 2) |
| A page stays open past the link's life | Images/downloads stop working until the page is refreshed |
| Private upload routed to Cloudinary | Upload fails with instructions to route that category to R2 or DO Spaces |
| `PRIVATE_FILE_REF_SECRET` missing | Staging/production refuse to start (the production deploy checks it first); locally, private uploads fail, saves carrying a file answer `503`, and screens show private files as unavailable (error logged) |
| A form sends back a link older than 7 days | The save is refused with `409` "This page is out of date — reload it and save again" |

## 7. Testing (written before the code)

- **Unit**: reference encode/parse/tag; signing windows (same URL within a
  window, validity 60–75 min); verification (genuine, fabricated, tampered key,
  wrong access key, expired-but-genuine); response layer (nested JSON, arrays,
  HTML strings, non-JSON untouched, headers and `Set-Cookie` preserved, failure
  fallback); request layer (signed link → reference, `&amp;` form, unknown hosts
  untouched, raw tagged reference accepted, untagged/forged refused,
  `/api/auth/*` skipped, multipart untouched); upload visibility (private
  default, branding public, CV private, Cloudinary refusal, R2 private bucket
  missing); backup key randomness; `readStoredFile`; R2 test via object listing.
- **Integration (real database, fake object store)**: upload → create record →
  read (link) → edit and save → the stored value is still the reference; rich
  text with an embedded private image survives the same round trip.
- **Live, with the user's R2** (local): branding logo gets a permanent public
  link; an X-ray gets a link that stops working after its window; editing and
  saving a record keeps its file; a backup run completes (the only streamed
  upload — also proves the SDK's checksum handling against R2).

## 8. Rollout

**Local (now)** — the user creates, in Cloudflare: a public bucket and a private
bucket for development, one R2 API token with *Object Read & Write* on both, the
public bucket's r2.dev URL, and the CORS rule (4.7) on both; then enters them in
Integrations → R2.

**Production (later)** — separate production buckets; a custom domain for the
public bucket (r2.dev is rate-limited and meant for development); production
origins in the CORS rule.

## 9. Out of scope, noted

- `reports/components/messaging/sms-status-tab.tsx` — an unused copy of an old
  screen; untouched.
- Moving files that already have plain public links (none locally).
- Finer-grained per-file permissions beyond what each screen already allows.

## 10. Affected code

- `backend/src/lib/storage-router.ts`, `storage-providers.ts`, `integrations.ts`
  (config type) — visibility, private targets, signing and verification helpers.
- New `backend/src/lib/private-files.ts` — references, tags, signing windows,
  verification, `readStoredFile`.
- New middleware mounted in `backend/src/app.ts` — response and request layers.
- Upload callers: `routes/integrations.ts` (branding → public),
  `routes/staff-registration.ts` (CV → private), `lib/backup-scheduler.ts`
  (random key); every other `uploadToCategory` caller keeps its code and becomes
  private by default (`document-signing` ×2, `documents` ×3, `kiosk`,
  `ledger-adjustments`, `ortho-consent`, `patient-portal`, `patient-statements`,
  `staff-portal`, `upload` ×2).
- Stored-file reads: `lib/document-signing.ts` ×2 (template, current signed PDF),
  `routes/documents.ts` ×2; server-rendered HTML: `lib/employee-data-sheet.ts`.
- `config/env.ts`: `PRIVATE_FILE_REF_SECRET` (required when deployed).
- Portal compliance screens show a file's name via `shared/lib/file-name.ts`
  (a signed link's query string is not part of the name).
- `routes/integrations.ts` R2 test; storage usage.
- Portal: `features/integrations/components/r2-config-card.tsx` and the shared
  `s3-compatible-config-card.tsx` (R2-only private bucket field, per-bucket test
  results); `lib/actions/integrations.ts` (R2 config and test types).
- Docs: this file, `secrets-and-integrations.md` (R2 row), CLAUDE.md docs table.
