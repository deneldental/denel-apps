/**
 * Helpers for the tests that read the backend source to keep a rule from being forgotten
 * (no raw SQLSTATE checks, no hard-coded public addresses). Not a test itself.
 */
import { readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `backend/src`, wherever the tests are run from. */
export const BACKEND_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../src')

/** Every `.ts` file under `dir`. */
export function sourceFiles(dir: string = BACKEND_SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (name.endsWith('.ts')) out.push(full)
  }
  return out
}

/**
 * The lines of `text` that are code, with their 1-based numbers. Whole-line comments (those that
 * start with two slashes, and the lines inside a block comment) are left out: a comment may name
 * the thing a rule forbids when it is explaining why.
 */
export function codeLines(text: string): Array<{ line: number; text: string }> {
  let inBlock = false
  const out: Array<{ line: number; text: string }> = []
  text.split('\n').forEach((raw, i) => {
    const t = raw.trim()
    if (inBlock) {
      if (t.includes('*/')) inBlock = false
      return
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true
      return
    }
    if (t.startsWith('//')) return
    out.push({ line: i + 1, text: raw })
  })
  return out
}
