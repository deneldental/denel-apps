#!/usr/bin/env node
/**
 * api-contract-audit.mjs — backend ↔ frontend API contract diff.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every one of the 10 findings in `project-docs/backend-frontend-consistency-remediation.md`
 * is the same class of bug: a frontend calls an API path (or verb) the backend
 * does not implement. TypeScript cannot catch it — the path is a string, the
 * client is generic, and the failure only shows up as a runtime 404. This tool
 * makes that class of defect fail the build instead of reaching staging.
 *
 * WHAT IT DOES
 * ------------
 *  1. Builds the backend route inventory by statically walking `backend/src/app.ts`:
 *     - `app.route('<prefix>', <var>)` mounts, resolved to their router file via
 *       the import statements (named, aliased and default imports).
 *     - NESTED mounts, both in app.ts (`analyticsApp.route('/', analyticsCrmApp)`)
 *       and inside route files (`staffApp.route('', staffAttendanceApp)`).
 *     - Routes declared DIRECTLY on `app` in app.ts (`app.get('/api/health')`,
 *       `app.get('/api/csrf')`, `app.all('/api/auth/*')`) — these sit outside any
 *       `.route()` mount and are the single biggest source of false positives if
 *       you only look at mounts.
 *     - Hono regex params (`/attendance/:staffId{[0-9a-fA-F-]{36}}`).
 *  2. Extracts frontend call sites from `hr/src`, `portals/src`, `team/src`:
 *     `.get/.post/.put/.patch/.delete(...)` plus `fetch(...)` (reading `method:`
 *     from the options object, defaulting to GET).
 *  3. Normalises both sides to comparable segment lists (see NORMALISATION below)
 *     and reports unmatched paths + method mismatches.
 *
 * KNOWN LIMITATION — runtime shadowing is invisible to a static diff
 * -----------------------------------------------------------------
 * `GET /api/auth/check-permission` IS declared in `backend/src/routes/auth.ts`,
 * so this tool will (correctly) not flag it. At runtime it 404s anyway, because
 * `app.all('/api/auth/*')` (the Better Auth catch-all) is mounted BEFORE the
 * custom `authApp` router and only passes through an explicit two-path
 * allowlist. Mount-order shadowing like that cannot be detected by comparing
 * declared paths — it needs a live smoke test (see T28/T30 in the remediation
 * plan). Same caveat applies to any future route hidden behind an earlier
 * catch-all.
 *
 * Other acknowledged limitations:
 *  - Only literal paths are understood. A path built entirely from a variable
 *    (`api.get(url)`) is skipped rather than guessed at.
 *  - Request/response *shapes* are not compared — only path + verb.
 *
 * USAGE
 * -----
 *   node scripts/api-contract-audit.mjs            # diff, exit 1 on any finding
 *   node scripts/api-contract-audit.mjs --json     # machine-readable report
 *   node scripts/api-contract-audit.mjs --list-routes
 *   node scripts/api-contract-audit.mjs --list-calls
 *   node scripts/api-contract-audit.mjs --no-allowlist   # ignore the allowlist
 *
 * Known-deferred findings live in `scripts/api-contract-allowlist.json`; every
 * entry must carry a `reason`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const BACKEND_SRC = join(ROOT, 'backend', 'src')
const BACKEND_ENTRY = join(BACKEND_SRC, 'app.ts')
const ALLOWLIST_PATH = join(HERE, 'api-contract-allowlist.json')

/** Frontend apps to scan. `name` is what shows up in the report. */
const FRONTEND_APPS = [
  { name: 'portal', dir: join(ROOT, 'portals', 'src') },
  { name: 'hr', dir: join(ROOT, 'hr', 'src') },
  { name: 'team', dir: join(ROOT, 'team', 'src') },
]

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete']
const DECL_METHODS = [...HTTP_METHODS, 'all', 'options', 'head']

/** Placeholder standing in for a `${...}` template hole. */
const HOLE = ''

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)

// ───────────────────────────────────────────────────────────────────────────
// Source scanning helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Blank out comments while preserving byte offsets and newlines, so line
 * numbers stay accurate and commented-out code can never be mistaken for a
 * real route or call site.
 *
 * This matters concretely: the `__mock__/` files carry `TODO(backend-wiring)`
 * comments naming endpoints that do not exist. Those directories are skipped
 * outright, but comment-blanking is the belt-and-braces guarantee that a
 * commented endpoint anywhere else cannot become a phantom call site either.
 *
 * Tracks string / template-literal / regex-literal state so that `https://`
 * inside a string is not mistaken for a line comment.
 */
function blankComments(src) {
  const out = Array.from(src)
  const n = src.length
  let i = 0
  // Tracks whether a `/` at this position can start a regex literal.
  let prevSignificant = ''
  const templateStack = []

  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== '\n') out[k] = ' '
    }
  }

  while (i < n) {
    const c = src[i]
    const next = src[i + 1]

    // Inside a template literal expression `${ ... }` we behave like normal code,
    // handled by the stack below.
    if (c === '/' && next === '/') {
      let j = i
      while (j < n && src[j] !== '\n') j++
      blank(i, j)
      i = j
      continue
    }
    if (c === '/' && next === '*') {
      let j = i + 2
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++
      blank(i, Math.min(j + 2, n))
      i = Math.min(j + 2, n)
      continue
    }
    if (c === "'" || c === '"') {
      const quote = c
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') {
          j += 2
          continue
        }
        if (src[j] === quote || src[j] === '\n') break
        j++
      }
      i = j + 1
      prevSignificant = quote
      continue
    }
    if (c === '`') {
      templateStack.push('template')
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') {
          j += 2
          continue
        }
        if (src[j] === '`') break
        if (src[j] === '$' && src[j + 1] === '{') {
          // Recurse into the expression: comments are legal in there, and the
          // expression can itself contain nested template literals.
          const end = matchBrace(src, j + 1)
          const innerBlanked = blankComments(src.slice(j + 2, end))
          for (let k = 0; k < innerBlanked.length; k++) out[j + 2 + k] = innerBlanked[k]
          j = end + 1
          continue
        }
        j++
      }
      templateStack.pop()
      i = j + 1
      prevSignificant = '`'
      continue
    }
    if (c === '/' && canStartRegex(prevSignificant)) {
      // Regex literal — skip to the closing unescaped `/`.
      let j = i + 1
      let inClass = false
      let closed = false
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') {
          j += 2
          continue
        }
        if (src[j] === '[') inClass = true
        else if (src[j] === ']') inClass = false
        else if (src[j] === '/' && !inClass) {
          closed = true
          break
        }
        j++
      }
      if (closed) {
        i = j + 1
        prevSignificant = '/'
        continue
      }
    }
    if (!/\s/.test(c)) prevSignificant = c
    i++
  }
  return out.join('')
}

function canStartRegex(prev) {
  if (prev === '') return true
  return '(,=:[!&|?{};+-*%~^\n'.includes(prev)
}

/**
 * Given the index of a `{`, return the index of its matching `}`, correctly
 * skipping strings, template literals (including nested `${}`) and comments.
 * Returns `src.length` when unterminated.
 */
function matchBrace(src, openIdx) {
  let depth = 0
  let i = openIdx
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === '{') {
      depth++
      i++
      continue
    }
    if (c === '}') {
      depth--
      if (depth === 0) return i
      i++
      continue
    }
    if (c === "'" || c === '"') {
      const q = c
      i++
      while (i < n) {
        if (src[i] === '\\') {
          i += 2
          continue
        }
        if (src[i] === q || src[i] === '\n') break
        i++
      }
      i++
      continue
    }
    if (c === '`') {
      i++
      while (i < n) {
        if (src[i] === '\\') {
          i += 2
          continue
        }
        if (src[i] === '`') break
        if (src[i] === '$' && src[i + 1] === '{') {
          i = matchBrace(src, i + 1) + 1
          continue
        }
        i++
      }
      i++
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      continue
    }
    i++
  }
  return n
}

/**
 * Read a string or template literal starting at `start` (which must point at a
 * quote or backtick). Returns `{ text, end, dynamic, truncated }` where `text`
 * uses HOLE for each `${...}` expression.
 *
 * Nested template literals are handled by delegating to `matchBrace`, which is
 * why `` `/api/tasks${qs ? `?x=${qs}` : ''}` `` parses correctly instead of
 * being truncated at the inner backtick the way a naive regex is.
 */
function readStringLiteral(src, start) {
  const q = src[start]
  const n = src.length
  if (q === "'" || q === '"') {
    let i = start + 1
    let text = ''
    while (i < n) {
      if (src[i] === '\\') {
        text += src[i + 1] ?? ''
        i += 2
        continue
      }
      if (src[i] === q) return { text, end: i + 1, dynamic: false, truncated: false }
      if (src[i] === '\n') break
      text += src[i]
      i++
    }
    return { text, end: i, dynamic: false, truncated: true }
  }
  if (q !== '`') return null
  let i = start + 1
  let text = ''
  let dynamic = false
  while (i < n) {
    if (src[i] === '\\') {
      text += src[i + 1] ?? ''
      i += 2
      continue
    }
    if (src[i] === '`') return { text, end: i + 1, dynamic, truncated: false }
    if (src[i] === '$' && src[i + 1] === '{') {
      const close = matchBrace(src, i + 1)
      dynamic = true
      text += HOLE
      if (close >= n) return { text, end: n, dynamic, truncated: true }
      i = close + 1
      continue
    }
    text += src[i]
    i++
  }
  return { text, end: i, dynamic, truncated: true }
}

function skipWs(src, i) {
  while (i < src.length && /\s/.test(src[i])) i++
  return i
}

function lineOf(src, index) {
  let line = 1
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++
  return line
}

function walkFiles(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.turbo') continue
      walkFiles(full, out)
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) {
      out.push(full)
    }
  }
  return out
}

// ───────────────────────────────────────────────────────────────────────────
// Backend inventory
// ───────────────────────────────────────────────────────────────────────────

/** file → { code, imports: Map<local, {file, exported}>, exports: Map<exported, local> } */
const fileCache = new Map()

function resolveModule(fromFile, spec) {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromFile), spec)
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    base,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c
    } catch {
      /* not there */
    }
  }
  return null
}

function loadFile(file) {
  if (fileCache.has(file)) return fileCache.get(file)
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    const empty = { code: '', imports: new Map(), exports: new Map() }
    fileCache.set(file, empty)
    return empty
  }
  const code = blankComments(raw)
  const imports = new Map()
  const exports = new Map()

  // import ... from '...'
  const importRe = /\bimport\s+([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/g
  let m
  while ((m = importRe.exec(code))) {
    const clause = m[1].trim()
    if (/^type\b/.test(clause)) continue
    const target = resolveModule(file, m[2])
    if (!target) continue
    // default import: `X` or `X, { a }`
    const defMatch = clause.match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/)
    if (defMatch) imports.set(defMatch[1], { file: target, exported: 'default' })
    const namedMatch = clause.match(/\{([\s\S]*?)\}/)
    if (namedMatch) {
      for (const piece of namedMatch[1].split(',')) {
        const p = piece.trim()
        if (!p || /^type\b/.test(p)) continue
        const asMatch = p.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
        if (asMatch) imports.set(asMatch[2], { file: target, exported: asMatch[1] })
        else if (/^[A-Za-z_$][\w$]*$/.test(p)) imports.set(p, { file: target, exported: p })
      }
    }
  }

  // export { a, b as c }
  const exportListRe = /\bexport\s*\{([\s\S]*?)\}/g
  while ((m = exportListRe.exec(code))) {
    for (const piece of m[1].split(',')) {
      const p = piece.trim()
      if (!p || /^type\b/.test(p)) continue
      const asMatch = p.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
      if (asMatch) exports.set(asMatch[2], asMatch[1])
      else if (/^[A-Za-z_$][\w$]*$/.test(p)) exports.set(p, p)
    }
  }
  // export const X = ...
  const exportConstRe = /\bexport\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g
  while ((m = exportConstRe.exec(code))) exports.set(m[1], m[1])
  // export default X
  const defaultRe = /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m
  const dm = code.match(defaultRe)
  if (dm) exports.set('default', dm[1])

  const entry = { code, imports, exports }
  fileCache.set(file, entry)
  return entry
}

/** Resolve `name` as used in `file` to a canonical `file::localName` router key. */
function resolveRouterKey(file, name, seen = new Set()) {
  const guard = `${file}::${name}`
  if (seen.has(guard)) return guard
  seen.add(guard)
  const { imports, exports } = loadFile(file)
  const imp = imports.get(name)
  if (imp) {
    const targetLocal = loadFile(imp.file).exports.get(imp.exported) ?? imp.exported
    return resolveRouterKey(imp.file, targetLocal, seen)
  }
  // Locally declared (or re-exported under a different local name).
  const localAlias = exports.get(name)
  if (localAlias && localAlias !== name) return resolveRouterKey(file, localAlias, seen)
  return guard
}

/**
 * Scan a backend source file for route declarations and sub-app mounts,
 * attributing each to the router variable it was called on.
 * Returns Map<routerKey, { routes: [{method, path}], mounts: [{prefix, childKey}] }>
 */
function scanBackendFile(file) {
  const { code } = loadFile(file)
  const result = new Map()
  const ensure = (key) => {
    if (!result.has(key)) result.set(key, { routes: [], mounts: [] })
    return result.get(key)
  }

  // `<ident>.<method>(` — the `[^\w$.]` guard stops `foo.bar.get(` from being
  // attributed to `bar`, and stops matching inside identifiers.
  const callRe = new RegExp(
    `(?:^|[^\\w$.])([A-Za-z_$][\\w$]*)\\s*\\.\\s*(${[...DECL_METHODS, 'route', 'on'].join('|')})\\s*(?:<[^<>()]*>)?\\s*\\(`,
    'g'
  )
  let m
  while ((m = callRe.exec(code))) {
    const varName = m[1]
    const method = m[2]
    let i = skipWs(code, callRe.lastIndex)

    if (method === 'on') {
      // `.on(['GET','POST'], '/path', ...)` — read the method array first.
      if (code[i] !== '[') continue
      const close = code.indexOf(']', i)
      if (close === -1) continue
      const methods = [...code.slice(i, close).matchAll(/['"]([A-Za-z]+)['"]/g)].map((x) =>
        x[1].toUpperCase()
      )
      i = skipWs(code, close + 1)
      if (code[i] !== ',') continue
      i = skipWs(code, i + 1)
      const lit = readStringLiteral(code, i)
      if (!lit) continue
      const key = resolveRouterKey(file, varName)
      for (const mm of methods) ensure(key).routes.push({ method: mm, path: lit.text })
      continue
    }

    const lit = readStringLiteral(code, i)
    if (!lit) continue

    if (method === 'route') {
      let j = skipWs(code, lit.end)
      if (code[j] !== ',') continue
      j = skipWs(code, j + 1)
      const idm = code.slice(j).match(/^([A-Za-z_$][\w$]*)/)
      if (!idm) continue
      ensure(resolveRouterKey(file, varName)).mounts.push({
        prefix: lit.text,
        childKey: resolveRouterKey(file, idm[1]),
      })
      continue
    }

    const key = resolveRouterKey(file, varName)
    const methods =
      method === 'all' ? HTTP_METHODS.map((x) => x.toUpperCase()) : [method.toUpperCase()]
    for (const mm of methods) ensure(key).routes.push({ method: mm, path: lit.text })
  }
  return result
}

/** Strip Hono regex constraints: `/:id{[0-9a-fA-F-]{36}}` → `/:id`. */
function stripHonoConstraints(path) {
  let out = ''
  for (let i = 0; i < path.length; i++) {
    if (path[i] === '{') {
      let depth = 0
      let j = i
      for (; j < path.length; j++) {
        if (path[j] === '{') depth++
        else if (path[j] === '}') {
          depth--
          if (depth === 0) break
        }
      }
      i = j
      continue
    }
    out += path[i]
  }
  return out
}

function joinPath(prefix, path) {
  const a = prefix === '/' ? '' : prefix
  const b = path === '/' ? '' : path
  let joined = `${a}${b.startsWith('/') || b === '' ? '' : '/'}${b}`
  joined = joined.replace(/\/{2,}/g, '/')
  if (joined === '') joined = '/'
  if (joined.length > 1 && joined.endsWith('/')) joined = joined.slice(0, -1)
  return joined
}

function buildBackendInventory() {
  const files = walkFiles(BACKEND_SRC)
  const graph = new Map()
  for (const f of files) {
    for (const [key, val] of scanBackendFile(f)) {
      if (!graph.has(key)) graph.set(key, { routes: [], mounts: [] })
      const node = graph.get(key)
      node.routes.push(...val.routes)
      node.mounts.push(...val.mounts)
    }
  }

  const routes = new Map() // "METHOD path" → {method, path, segments}
  const rootKey = resolveRouterKey(BACKEND_ENTRY, 'app')

  const visit = (key, prefix, stack) => {
    if (stack.has(key)) return // mount cycle guard
    const node = graph.get(key)
    if (!node) return
    const nextStack = new Set(stack).add(key)
    for (const r of node.routes) {
      // Keep regex constraints for MATCHING (segMatches enforces them) but
      // strip them for DISPLAY. Stripping before matching turns a constrained
      // param into a catch-all, which silently hides genuinely missing routes.
      const raw = joinPath(prefix, r.path)
      const full = stripHonoConstraints(raw)
      const id = `${r.method} ${full}`
      if (!routes.has(id)) routes.set(id, { method: r.method, path: full, segments: segs(raw) })
    }
    for (const mnt of node.mounts) {
      visit(mnt.childKey, joinPath(prefix, stripHonoConstraints(mnt.prefix)), nextStack)
    }
  }
  visit(rootKey, '', new Set())
  return [...routes.values()]
}

const segs = (p) => p.split('/').filter(Boolean)

// ───────────────────────────────────────────────────────────────────────────
// Frontend call sites
// ───────────────────────────────────────────────────────────────────────────

function isSkippedFrontendFile(file) {
  const norm = file.replace(/\\/g, '/')
  if (norm.includes('/__mock__/')) return true
  if (norm.includes('/__mocks__/')) return true
  if (norm.includes('/__tests__/')) return true
  if (/\.(test|spec)\.[jt]sx?$/.test(norm)) return true
  return false
}

/**
 * NORMALISATION — the part that actually matters.
 *
 * The naive version of this diff produced 62 findings of which 52 were false
 * positives. Every rule below exists because of a real false positive:
 *
 *  R1. Anchor on `/api`. Frontend paths are frequently prefixed with a base-URL
 *      hole (`` `${API_BASE_URL}/api/upload` ``). Cut everything before the
 *      `/api` boundary; if there is no `/api` at all, it is not an API call
 *      (this also drops `map.get('key')`, `searchParams.get('page')`, …).
 *
 *  R2. Strip literal query strings and fragments (`?a=b`, `#x`).
 *
 *  R3. GLUED trailing holes are query-string appends, NOT path segments.
 *      `` `/api/items${qs}` `` where `qs === '?foo=bar'` must normalise to
 *      `/api/items`, not `/api/items/*`. The tell is that the hole is glued
 *      directly to a literal segment with no `/` in front of it and nothing
 *      after it. This single rule accounted for the bulk of the false
 *      positives.
 *
 *  R4. Holes preceded by `/` ARE path segments → wildcard.
 *      `` `/api/patients/${id}` `` → `/api/patients/*`.
 *
 *  R5. A hole glued into the MIDDLE of a segment (`/api/x/y${a}/z`) makes that
 *      one segment a wildcard, but does not delete it — deleting it would
 *      silently change the path shape.
 *
 *  R6. Nested template literals (`` `/api/tasks${qs ? `?x=${qs}` : ''}` ``) are
 *      parsed structurally by `readStringLiteral`/`matchBrace`, so the inner
 *      backtick cannot truncate the capture. If a `${` is genuinely
 *      unterminated the literal is marked truncated and we cut there rather
 *      than emit a garbage path.
 *
 *  R7. String concatenation (`'/api/foo/' + id`) appends a hole, so it is
 *      treated as parameterised rather than as a bare literal path.
 *
 * Returns null when the text is not an API path.
 */
function normaliseFrontendPath(text) {
  // R1 — anchor on the /api boundary.
  let idx = -1
  for (let i = 0; i + 4 <= text.length; i++) {
    if (text.startsWith('/api', i)) {
      const after = text[i + 4]
      if (after === undefined || after === '/' || after === '?' || after === '#') {
        idx = i
        break
      }
    }
  }
  if (idx === -1) return null
  let p = text.slice(idx)

  // R2 — drop literal query string / fragment.
  const cut = Math.min(
    ...[p.indexOf('?'), p.indexOf('#')].filter((x) => x !== -1).concat([p.length])
  )
  p = p.slice(0, cut)

  // R3 — strip glued trailing holes (query-string appends).
  while (p.endsWith(HOLE)) {
    const before = p[p.length - 2]
    if (before === '/' || before === undefined) break // R4: real trailing param segment
    p = p.slice(0, -1)
  }

  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  p = p.replace(/\/{2,}/g, '/')

  // R4/R5 — any segment containing a hole becomes a wildcard.
  const parts = p
    .split('/')
    .filter(Boolean)
    .map((s) => (s.includes(HOLE) ? '*' : s))
  return `/${parts.join('/')}`
}

function extractCallSites(appName, dir) {
  const sites = []
  for (const file of walkFiles(dir)) {
    if (isSkippedFrontendFile(file)) continue
    let raw
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (!raw.includes('/api')) continue
    const code = blankComments(raw)
    const rel = relative(ROOT, file).replace(/\\/g, '/')

    // `.get(` / `.post(` / … — the receiver is deliberately not constrained, so
    // this catches `api.`, `apiClient.`, `this.client.` and friends alike.
    // Non-API first arguments are filtered out by normaliseFrontendPath.
    const methodRe = new RegExp(
      `(?:^|[^\\w$.])[A-Za-z_$][\\w$.]*\\s*\\.\\s*(${HTTP_METHODS.join('|')})\\s*(?:<[^<>()]*>)?\\s*\\(`,
      'g'
    )
    let m
    while ((m = methodRe.exec(code))) {
      const method = m[1].toUpperCase()
      const argStart = skipWs(code, methodRe.lastIndex)
      const site = readPathArg(code, argStart)
      if (!site) continue
      const path = normaliseFrontendPath(site.text)
      if (!path) continue
      sites.push({ app: appName, method, path, file: rel, line: lineOf(code, m.index) })
    }

    // `fetch(url, { method: 'POST' })`
    const fetchRe = /(?:^|[^\w$.])fetch\s*\(/g
    while ((m = fetchRe.exec(code))) {
      const argStart = skipWs(code, fetchRe.lastIndex)
      const site = readPathArg(code, argStart)
      if (!site) continue
      const path = normaliseFrontendPath(site.text)
      if (!path) continue
      sites.push({
        app: appName,
        method: readFetchMethod(code, site.end),
        path,
        file: rel,
        line: lineOf(code, m.index),
      })
    }
  }
  return sites
}

/** Read the first argument as a path literal, honouring R7 (concatenation). */
function readPathArg(code, start) {
  const lit = readStringLiteral(code, start)
  if (!lit) return null
  let end = lit.end
  let text = lit.text
  // R7 — `'/api/foo/' + id` behaves like a template hole.
  let j = skipWs(code, end)
  while (code[j] === '+') {
    text += HOLE
    j = skipWs(code, j + 1)
    const nextLit = readStringLiteral(code, j)
    if (nextLit) {
      text += nextLit.text
      end = nextLit.end
      j = skipWs(code, end)
    } else {
      const idm = code.slice(j).match(/^[A-Za-z_$][\w$.()[\]]*/)
      if (!idm) break
      j = skipWs(code, j + idm[0].length)
      end = j
    }
  }
  return { text, end }
}

/**
 * Read `method:` out of a fetch options object. Defaults to GET (per the fetch
 * spec). A method supplied as a variable yields `*`, which matches any verb —
 * we would rather under-report than invent a mismatch we cannot prove.
 */
function readFetchMethod(code, afterFirstArg) {
  let i = skipWs(code, afterFirstArg)
  if (code[i] !== ',') return 'GET'
  i = skipWs(code, i + 1)
  if (code[i] !== '{') return 'GET'
  const close = matchBrace(code, i)
  const body = code.slice(i, close + 1)
  const lit = body.match(/\bmethod\s*:\s*['"`]([A-Za-z]+)['"`]/)
  if (lit) return lit[1].toUpperCase()
  if (/\bmethod\s*:/.test(body)) return '*'
  return 'GET'
}

// ───────────────────────────────────────────────────────────────────────────
// Matching
// ───────────────────────────────────────────────────────────────────────────

const isWild = (s) => s === '*' || s.startsWith(':')

/**
 * A Hono param may carry a regex constraint: `:id{[0-9a-fA-F-]{36}}`.
 * Returns the raw constraint source, or null for an unconstrained param.
 */
function paramConstraint(seg) {
  if (!seg.startsWith(':')) return null
  const open = seg.indexOf('{')
  if (open === -1 || !seg.endsWith('}')) return null
  return seg.slice(open + 1, -1)
}

/**
 * Match one route segment against one call segment.
 *
 * Constrained params MUST honour their regex. Treating `:id{[0-9a-fA-F-]{36}}`
 * as a plain wildcard makes it swallow any literal, so a call that 404s at
 * runtime looks matched here — that bug hid the missing
 * `/api/reports/period-summary` route behind `/api/reports/:id{uuid}`, and
 * misreported `POST /api/staff/attendance/overrides` as merely a verb mismatch
 * against `GET /api/staff/attendance/:staffId{uuid}`.
 */
function segMatches(r, c) {
  const constraint = paramConstraint(r)
  if (constraint) {
    // A template hole could hold anything, so a match cannot be disproved.
    if (c === '*') return true
    try {
      return new RegExp(`^(?:${constraint})$`).test(c)
    } catch {
      return true // unparseable constraint — stay permissive rather than lie
    }
  }
  if (isWild(r) || isWild(c)) return true
  return r === c
}

function pathMatches(routeSegs, callSegs) {
  for (let i = 0; i < routeSegs.length; i++) {
    // Hono trailing wildcard: `/api/auth/*` swallows the rest.
    if (routeSegs[i] === '*' && i === routeSegs.length - 1) return true
    if (i >= callSegs.length) return false
    if (!segMatches(routeSegs[i], callSegs[i])) return false
  }
  return routeSegs.length === callSegs.length
}

function diff(routes, callSites) {
  const unmatched = new Map()
  const mismatched = new Map()

  for (const site of callSites) {
    const callSegs = segs(site.path)
    const pathHits = routes.filter((r) => pathMatches(r.segments, callSegs))
    if (pathHits.length === 0) {
      addFinding(unmatched, site, null)
      continue
    }
    if (site.method === '*') continue
    const verbHit = pathHits.some((r) => r.method === site.method)
    if (!verbHit) addFinding(mismatched, site, [...new Set(pathHits.map((r) => r.method))].sort())
  }
  return { unmatched: [...unmatched.values()], mismatched: [...mismatched.values()] }
}

function addFinding(bucket, site, backendMethods) {
  const key = `${site.app} ${site.method} ${site.path}`
  if (!bucket.has(key)) {
    bucket.set(key, {
      app: site.app,
      method: site.method,
      path: site.path,
      backendMethods,
      sites: [],
    })
  }
  const f = bucket.get(key)
  const loc = `${site.file}:${site.line}`
  if (!f.sites.includes(loc)) f.sites.push(loc)
}

// ───────────────────────────────────────────────────────────────────────────
// Allowlist
// ───────────────────────────────────────────────────────────────────────────

function loadAllowlist() {
  if (flag('--no-allowlist')) return { entries: [] }
  try {
    const parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'))
    const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? [])
    for (const e of entries) {
      if (!e.reason || typeof e.reason !== 'string' || !e.reason.trim()) {
        console.error(
          `✗ allowlist entry ${e.method ?? '?'} ${e.path ?? '?'} is missing a "reason" — every deferral must be justified.`
        )
        process.exit(2)
      }
    }
    return { entries }
  } catch (err) {
    if (err.code === 'ENOENT') return { entries: [] }
    console.error(`✗ Could not parse ${relative(ROOT, ALLOWLIST_PATH)}: ${err.message}`)
    process.exit(2)
  }
}

function isAllowlisted(entries, finding) {
  return entries.find(
    (e) =>
      e.path === finding.path &&
      (!e.method || e.method.toUpperCase() === finding.method) &&
      (!e.app || e.app === finding.app)
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Report
// ───────────────────────────────────────────────────────────────────────────

function main() {
  const routes = buildBackendInventory()
  const callSites = FRONTEND_APPS.flatMap((a) => extractCallSites(a.name, a.dir))

  if (flag('--list-routes')) {
    for (const r of [...routes].sort(
      (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)
    ))
      console.log(`${r.method.padEnd(7)} ${r.path}`)
    console.log(`\n${routes.length} routes`)
    return 0
  }
  if (flag('--list-calls')) {
    for (const s of [...callSites].sort((a, b) => a.path.localeCompare(b.path)))
      console.log(`${s.app.padEnd(7)} ${s.method.padEnd(7)} ${s.path}  (${s.file}:${s.line})`)
    console.log(`\n${callSites.length} call sites`)
    return 0
  }

  const { unmatched, mismatched } = diff(routes, callSites)
  const { entries } = loadAllowlist()

  const classify = (list, category) =>
    list.map((f) => ({ ...f, category, allow: isAllowlisted(entries, f) }))
  const all = [...classify(unmatched, 'unmatched-path'), ...classify(mismatched, 'method-mismatch')]
  const blocking = all.filter((f) => !f.allow)
  const deferred = all.filter((f) => f.allow)

  if (flag('--json')) {
    console.log(
      JSON.stringify(
        { routeCount: routes.length, callSiteCount: callSites.length, findings: all },
        null,
        2
      )
    )
    return blocking.length === 0 ? 0 : 1
  }

  console.log('API contract audit — backend routes ↔ frontend call sites')
  console.log('─'.repeat(72))
  console.log(`Backend routes:      ${routes.length}`)
  console.log(`Frontend call sites: ${callSites.length}`)
  console.log(
    `Findings:            ${all.length}  (${blocking.length} blocking, ${deferred.length} allowlisted)`
  )
  console.log('')

  const byApp = (list) => {
    const g = new Map()
    for (const f of list) {
      if (!g.has(f.app)) g.set(f.app, [])
      g.get(f.app).push(f)
    }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }

  if (blocking.length) {
    for (const [app, findings] of byApp(blocking)) {
      console.log(`■ ${app} — ${findings.length} finding(s)`)
      for (const f of findings.sort(
        (a, b) => a.category.localeCompare(b.category) || a.path.localeCompare(b.path)
      )) {
        const tag =
          f.category === 'method-mismatch'
            ? `method mismatch — backend implements ${f.backendMethods.join('/')}`
            : 'no matching backend route'
        console.log(`  ${f.method} ${f.path}`)
        console.log(`      ${tag}`)
        for (const s of f.sites) console.log(`      ↳ ${s}`)
      }
      console.log('')
    }
  }

  if (deferred.length) {
    console.log(`Allowlisted (${deferred.length}) — tracked, not blocking:`)
    for (const f of deferred.sort((a, b) => a.path.localeCompare(b.path))) {
      console.log(`  ${f.app}  ${f.method} ${f.path}`)
      console.log(`      reason: ${f.allow.reason}`)
    }
    console.log('')
  }

  const unused = entries.filter((e) => !all.some((f) => isAllowlisted([e], f) === e))
  if (unused.length) {
    console.log('⚠ Stale allowlist entries (no longer reported — remove them):')
    for (const e of unused) console.log(`  ${e.method ?? '*'} ${e.path}`)
    console.log('')
  }

  if (blocking.length === 0) {
    console.log('✓ No blocking API contract findings.')
    return 0
  }
  console.log(
    `✗ ${blocking.length} blocking API contract finding(s). Fix the call site, implement the route,`
  )
  console.log(
    `  or add a justified entry to ${relative(ROOT, ALLOWLIST_PATH).replace(/\\/g, '/')}.`
  )
  return 1
}

process.exit(main())
