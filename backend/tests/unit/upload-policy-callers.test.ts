/**
 * F22 / D9 — the upload policy has to know every folder the apps really upload to.
 *
 * `lib/upload-policy.ts` refuses a folder it does not recognise. That is the point, but it also
 * means a screen that is given a NEW folder starts failing with a 400 the first time someone
 * clicks it. This test reads the portal, HR and Team sources and fails, naming the file and line,
 * when an upload call uses a folder no kind covers, so the table and the screens change together
 * (the same idea as the route-access test that maps every portal route prefix).
 *
 * It looks at literal folder names only (`folder: 'x'`, `append('folder', 'x')`, `folder="x"`);
 * sub-folders hold ids and typed text, which the kinds validate at run time.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveUpload } from '../../src/lib/upload-policy'

const ROOT = `${resolve(dirname(fileURLToPath(import.meta.url)), '../../..')}${sep}`
const APPS = ['portals/src', 'hr/src', 'team/src']
const UPLOAD_HINTS = ['uploadFile', '/api/upload', 'SingleImageUpload', 'uploadBlob']

const UUID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
/** Sub-folders the screens use, with ids filled in. A folder is "known" if any of them resolves. */
const SUBFOLDERS = [
  '',
  UUID,
  `${UUID}/documents`,
  `${UUID}/photos`,
  `${UUID}/case-images`,
  `${UUID}/signatures/consent`,
  `${UUID}/avatar`,
  'new/avatar',
  'audio',
  'a_free_text_title',
  'renewals',
]

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(full)
  }
  return out
}

type Found = { file: string; line: number; folder: string }

function foldersIn(file: string): Found[] {
  const text = readFileSync(file, 'utf8')
  if (!UPLOAD_HINTS.some((hint) => text.includes(hint))) return []
  const found: Found[] = []
  const add = (index: number, folder: string) =>
    found.push({
      file: file.slice(ROOT.length),
      line: text.slice(0, index).split('\n').length,
      folder,
    })
  const patterns: RegExp[] = [
    /\bfolder\s*:\s*'([^'$]+)'/g, // folder: 'compliance'
    /append\(\s*'folder'\s*,\s*'([^'$]+)'\s*\)/g, // formData.append('folder', 'requests')
    /\bfolder="([^"{]+)"/g, // <SingleImageUpload folder="products" />
  ]
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) add(m.index ?? 0, m[1])
  }
  // folder: cond ? 'Staff' : 'Specialists'
  for (const m of text.matchAll(/\bfolder\s*:\s*[^,\n]*?\?\s*'([^']+)'\s*:\s*'([^']+)'/g)) {
    add(m.index ?? 0, m[1])
    add(m.index ?? 0, m[2])
  }
  return found
}

const known = (folder: string) =>
  SUBFOLDERS.some((sub) => resolveUpload({ category: null, folder, subfolder: sub }).ok)

describe('every folder an app uploads to is covered by the upload policy', () => {
  const found = APPS.flatMap((app) => sourceFiles(join(ROOT, app))).flatMap(foldersIn)

  it('finds the upload calls it is meant to guard (so the scan cannot silently go blind)', () => {
    expect(found.length).toBeGreaterThan(20)
    const folders = new Set(found.map((f) => f.folder.toLowerCase()))
    for (const expected of ['compliance', 'xrays', 'requests', 'memos', 'handbook', 'training']) {
      expect(folders.has(expected), expected).toBe(true)
    }
  })

  it.each(
    [...new Map(found.map((f) => [`${f.folder}|${f.file}`, f])).values()].map(
      (f) => [`${f.folder}  (${f.file}:${f.line})`, f.folder] as const
    )
  )('%s', (_where, folder) => {
    expect(known(folder), `no upload kind covers the folder "${folder}"`).toBe(true)
  })
})
