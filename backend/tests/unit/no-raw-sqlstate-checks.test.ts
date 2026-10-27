/**
 * F25 — nobody outside `lib/pg-errors.ts` decides what a Postgres error means. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.13).
 *
 * Fourteen handlers asked `err.code === '23505'` or looked for the word "unique" in the message, and
 * none of them ever matched (Drizzle puts the code on `err.cause`, and its own message is the failed
 * query). The fix is one helper; this test keeps the habit from coming back. It reads the backend
 * source and fails, naming the file and line, when code outside `pg-errors.ts`
 *
 *   - writes the unique-violation SQLSTATE (23505) as a literal, or
 *   - guesses at a duplicate from the text of an error message.
 *
 * Use `isUniqueViolation()` / `uniqueViolationOf()` from `lib/pg-errors.ts` instead.
 */
import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BACKEND_SRC, codeLines, sourceFiles } from './_source-scan'

const ALLOWED = join(BACKEND_SRC, 'lib', 'pg-errors.ts')
const PATTERNS: Array<{ what: string; test: RegExp }> = [
  { what: 'the unique-violation SQLSTATE as a literal', test: /['"`]23505['"`]/ },
  {
    what: 'a message check for "unique"/"duplicate"',
    test: /message\??\.includes\(\s*['"`](?:unique|duplicate)/i,
  },
  {
    what: 'a regular expression for "unique"/"duplicate" tried on an error message',
    test: /\/[^/\n]*(?:unique|duplicate)[^/\n]*\/[gimsuy]*\s*\.test\([^)]*message/i,
  },
]

function findRawChecks(text: string) {
  const hits: Array<{ line: number; what: string; text: string }> = []
  for (const { line, text: code } of codeLines(text)) {
    for (const p of PATTERNS)
      if (p.test.test(code)) hits.push({ line, what: p.what, text: code.trim() })
  }
  return hits
}

describe('no handler decides for itself what a Postgres error means', () => {
  it('the scan itself can see each kind of check (so it cannot go blind)', () => {
    const bad = [
      "if (pgErr.code === '23505') return c.json({}, 409)",
      'if (error.code === "23505") {',
      "if (pgErr.message?.includes('unique')) {",
      'if (typeof pgErr.message === "string" && /unique|duplicate/i.test(pgErr.message)) {',
    ]
    for (const line of bad) expect(findRawChecks(line), line).not.toHaveLength(0)
    // not about a database error: the app's own wording in a list of its own messages
    expect(findRawChecks("errors.filter((e) => e.includes('Duplicate —')).length")).toHaveLength(0)
    expect(
      findRawChecks("// code === '23505' is why this helper exists\nconst x = 1")
    ).toHaveLength(0)
    expect(
      findRawChecks("/*\n * err.code === '23505' never matches\n */\nconst x = 1")
    ).toHaveLength(0)
  })

  it('reads the whole backend source', () => {
    expect(sourceFiles().length).toBeGreaterThan(200)
  })

  it('finds none outside lib/pg-errors.ts', () => {
    const found = sourceFiles()
      .filter((file) => file !== ALLOWED)
      .flatMap((file) =>
        findRawChecks(readFileSync(file, 'utf8')).map(
          (h) =>
            `${relative(BACKEND_SRC, file).split(sep).join('/')}:${h.line}  ${h.what}\n      ${h.text}`
        )
      )
    expect(found, `use isUniqueViolation() from lib/pg-errors.ts:\n${found.join('\n')}`).toEqual([])
  })
})
