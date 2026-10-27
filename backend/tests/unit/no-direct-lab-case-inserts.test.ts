/**
 * Lab cases are numbered and inserted in one place. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.14).
 *
 * `POST /api/labs/cases` once chose the next LC- number itself and inserted without a retry, so two
 * cases opened at the same moment collided on the unique index. `insertLabCase()` in
 * `lib/lab-case-service.ts` now picks the number and retries; this test keeps a second copy of
 * "highest number plus one" from growing back by failing, with the file and line, when any other
 * backend source inserts into `lab_cases`.
 */
import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BACKEND_SRC, codeLines, sourceFiles } from './_source-scan'

const ALLOWED = join(BACKEND_SRC, 'lib', 'lab-case-service.ts')
const INSERT = /\.insert\(\s*labCases\s*\)/

describe('only the lab-case service inserts lab cases', () => {
  it('the scan can see an insert (so it cannot go blind)', () => {
    expect(INSERT.test('await db.insert(labCases).values({})')).toBe(true)
    expect(INSERT.test('    .insert(labCases)')).toBe(true)
    expect(INSERT.test('await db.insert(labCasePhotos).values({})')).toBe(false)
  })

  it('the service itself does the insert', () => {
    const lines = codeLines(readFileSync(ALLOWED, 'utf8')).filter((l) => INSERT.test(l.text))
    expect(lines).toHaveLength(1)
  })

  it('no other source file inserts into lab_cases', () => {
    const found = sourceFiles()
      .filter((file) => file !== ALLOWED)
      .flatMap((file) =>
        codeLines(readFileSync(file, 'utf8'))
          .filter((l) => INSERT.test(l.text))
          .map(
            (l) => `${relative(BACKEND_SRC, file).split(sep).join('/')}:${l.line}  ${l.text.trim()}`
          )
      )
    expect(found, `use insertLabCase() from lib/lab-case-service.ts:\n${found.join('\n')}`).toEqual(
      []
    )
  })
})
