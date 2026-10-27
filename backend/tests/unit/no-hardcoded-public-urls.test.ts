/**
 * F13 — only `lib/public-urls.ts` decides where a link points. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.13).
 *
 * Seven routes read `PORTAL_URL` / `PATIENT_PORTAL_URL` themselves and each carried its own
 * fallback — the patient app's host for pages that exist only in the portal, or
 * `http://localhost:5173`. The fix is one module; this test keeps the habit from coming back. It
 * reads the backend source and fails, naming the file and line, when code
 *
 *   - reads those two variables anywhere but `lib/public-urls.ts` (and the schema in
 *     `config/env.ts` that validates them), or
 *   - writes a production address of the patient app, or a local dev server, into a link.
 *
 * The files that LIST origins on purpose (CORS and cookie settings, which app a request came from)
 * are named below with the reason.
 */
import { readFileSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BACKEND_SRC, codeLines, sourceFiles } from './_source-scan'

/** Files that may mention these things, and why. */
const ALLOWED: Record<string, string> = {
  'lib/public-urls.ts': 'the one place that decides',
  'config/env.ts': 'validates the variables and refuses a deploy without them',
  'auth.ts': 'the list of origins allowed to send credentials (CORS / trusted origins)',
  'rbac/middleware/detectInterface.ts': 'maps a request origin to the app it came from',
}

const PATTERNS: Array<{ what: string; test: RegExp }> = [
  {
    what: 'reads PORTAL_URL / PATIENT_PORTAL_URL itself',
    test: /\b(?:process\.env|env)\.(?:PATIENT_)?PORTAL_URL\b/,
  },
  { what: 'a hard-coded address of the patient app', test: /https:\/\/app\.deneldental\.com/ },
  { what: 'a hard-coded local dev server', test: /http:\/\/localhost:51(?:73|75|76|77)\b/ },
]

function findHardcodedUrls(text: string) {
  const hits: Array<{ line: number; what: string; text: string }> = []
  for (const { line, text: code } of codeLines(text)) {
    for (const p of PATTERNS)
      if (p.test.test(code)) hits.push({ line, what: p.what, text: code.trim() })
  }
  return hits
}

describe('nobody but lib/public-urls.ts decides where a link points', () => {
  it('the scan itself can see each kind of fault (so it cannot go blind)', () => {
    const bad = [
      "const baseUrl = process.env.PORTAL_URL ?? 'https://app.deneldental.com'",
      "const base = env.PORTAL_URL ?? 'http://localhost:5173'",
      "const portalUrl = process.env.PATIENT_PORTAL_URL ?? 'https://x.test'",
      "const a = 'http://localhost:5177/login'",
    ]
    for (const line of bad) expect(findHardcodedUrls(line), line).not.toHaveLength(0)
    expect(findHardcodedUrls("// falls back to 'http://localhost:5173' in dev")).toHaveLength(0)
    expect(findHardcodedUrls("const url = portalLink('/c/abc')")).toHaveLength(0)
  })

  it('names a reason for every file it lets through', () => {
    for (const [file, reason] of Object.entries(ALLOWED))
      expect(reason.length, file).toBeGreaterThan(10)
  })

  it('finds none outside the files that list origins on purpose', () => {
    const found = sourceFiles()
      .filter((file) => !(relative(BACKEND_SRC, file).split(sep).join('/') in ALLOWED))
      .flatMap((file) =>
        findHardcodedUrls(readFileSync(file, 'utf8')).map(
          (h) =>
            `${relative(BACKEND_SRC, file).split(sep).join('/')}:${h.line}  ${h.what}\n      ${h.text}`
        )
      )
    expect(found, `use portalUrl() / portalLink() / patientAppUrl():\n${found.join('\n')}`).toEqual(
      []
    )
  })
})
