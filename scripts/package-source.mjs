#!/usr/bin/env node
/**
 * package-source.mjs — build a reviewable source archive from what Git knows.
 *
 * WHY THIS EXISTS
 * ---------------
 * Sharing the repo for review by zipping the folder is unsafe: the folder holds
 * populated settings files, node_modules and build output, and `.gitignore`
 * protects Git, not an archive. This tool makes the archive the repository's
 * way instead of yours.
 *
 * WHAT IT DOES
 * ------------
 *  1. Lists the files Git knows: tracked files plus untracked files that are not
 *     ignored — the working tree as it is, so it can be reviewed before commit.
 *  2. Refuses by name, even where Git would include them: settings files (.env,
 *     .env.*, .dev.vars*, *.env — except the *.example files), keys and
 *     certificates, node_modules, build and test output, scratch folders, Git
 *     metadata, local tool settings and earlier archives.
 *  3. Reads the credentials out of the local settings files on disk (ignored
 *     ones included) and looks for those values — and for well-known secret
 *     shapes (private keys, cloud/API tokens, database URLs with a password) —
 *     inside every file it would pack. On a hit it STOPS and writes nothing.
 *  4. Writes `denel-source-<revision>[-modified].zip` with SOURCE_PACKAGE.json
 *     first: the commit the tree sits on, whether it is modified, the changed
 *     paths and every file's SHA-256.
 *
 * It prints paths, line numbers and counts — never a value — and it never
 * changes or deletes a file in the working tree. The zip is deterministic (sorted
 * paths, fixed timestamps, Git's recorded file modes): the same tree gives the
 * same bytes. An existing archive is replaced only with --overwrite.
 *
 * Dependency-free on purpose: the zip is written with node:zlib, so nothing
 * changes in pnpm-lock.yaml and it works on Windows without a `zip` command.
 *
 * USAGE
 * -----
 *   pnpm run package:source
 *   pnpm run package:source -- --out path/to/file.zip
 *   pnpm run package:source -- --overwrite
 *
 * Exit codes: 0 written · 1 blocked (credential found, or archive exists) · 2 usage/error.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { deflateRawSync } from 'node:zlib'

const ARCHIVE_PREFIX = 'denel-source'
const MANIFEST_NAME = 'SOURCE_PACKAGE.json'
const TEXT_SCAN_LIMIT = 8 * 1024 * 1024
const SETTINGS_READ_LIMIT = 1024 * 1024
const MAX_LISTED = 25

const USAGE = `Usage: pnpm run package:source [-- --out <file>] [--overwrite]

  --out <file>   write the archive there instead of tmp/${ARCHIVE_PREFIX}-<revision>.zip
  --overwrite    replace the archive if it already exists
  --help         show this text`

// ─── Refusals by name ──────────────────────────────────────────────────────────

/** Directory names refused at any depth, with the reason they are refused. */
const REFUSED_DIRS = new Map([
  ['node_modules', 'dependencies'],
  ['.pnpm-store', 'dependencies'],
  ['.git', 'Git metadata'],
  ['dist', 'build output'],
  ['build', 'build output'],
  ['out', 'build output'],
  ['.next', 'build output'],
  ['.nx', 'build output'],
  ['.turbo', 'build output'],
  ['.wrangler', 'build output'],
  ['.vercel', 'build output'],
  ['coverage', 'test output'],
  ['test-results', 'test output'],
  ['playwright-report', 'test output'],
  ['scratch', 'scratch folder'],
  ['tmp-neon-migration', 'patient data export'],
  ['brand-assets-inbox', 'raw brand assets'],
  ['graphify-out', 'generated output'],
  ['csv-templates', 'generated output'],
])

/** `.env`, `.env.*`, `*.env`, `.dev.vars`, `.dev.vars.*` — except the *.example templates. */
function isSettingsFile(name) {
  if (name.endsWith('.example')) return false
  return (
    name === '.env' ||
    name.startsWith('.env.') ||
    name.endsWith('.env') ||
    name === '.dev.vars' ||
    name.startsWith('.dev.vars.') ||
    name === '.sentryclirc' ||
    name === '.netrc'
  )
}

const KEY_FILE = /\.(pem|key|p12|pfx|pkcs12|jks|keystore|crt|cer)$/i
const KEY_FILE_NAMES = new Set(['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'])
const EARLIER_ARCHIVE = new RegExp(`^${ARCHIVE_PREFIX}-.*\\.zip$`)

/** Why a path must not be packed, or null when it may be. */
function refusalFor(path) {
  const segments = path.split('/')
  const name = segments[segments.length - 1]

  if (name === '.git') return 'Git metadata'
  if (segments[0] === 'tmp') return 'scratch folder'
  if (path.startsWith('.claude/worktrees/')) return 'scratch folder'
  for (const dir of segments.slice(0, -1)) {
    const reason = REFUSED_DIRS.get(dir)
    if (reason) return reason
  }

  if (isSettingsFile(name)) return 'settings file'
  if (KEY_FILE.test(name) || KEY_FILE_NAMES.has(name)) return 'key or certificate'
  if (path === '.mcp.json' || path === '.claude/settings.local.json') return 'local tool settings'
  if (EARLIER_ARCHIVE.test(name) || path === MANIFEST_NAME) return 'earlier archive'
  if (/\.(tsbuildinfo|log)$/.test(name) || name === '.DS_Store' || name === 'Thumbs.db') {
    return 'build output'
  }
  return null
}

// ─── Git ───────────────────────────────────────────────────────────────────────

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function gitOrNull(args, cwd) {
  try {
    return git(args, cwd)
  } catch {
    return null
  }
}

function splitZ(buf) {
  const parts = buf.toString('utf8').split('\0')
  if (parts[parts.length - 1] === '') parts.pop()
  return parts
}

/** Path → Git file mode: tracked files (index) first, then untracked-but-not-ignored ones. */
function listCandidates(root) {
  const modes = new Map()
  for (const entry of splitZ(git(['ls-files', '-z', '-s'], root))) {
    const path = entry.slice(entry.indexOf('\t') + 1)
    if (!modes.has(path)) modes.set(path, entry.slice(0, entry.indexOf(' ')))
  }
  for (const path of splitZ(git(['ls-files', '-z', '--others', '--exclude-standard'], root))) {
    if (!modes.has(path)) modes.set(path, path.endsWith('/') ? '160000' : '100644')
  }
  return modes
}

/** Ignored files on disk (ignored directories collapse to `dir/` and are not entered). */
function listIgnoredFiles(root) {
  const args = ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']
  return splitZ(git(args, root)).filter((path) => !path.endsWith('/'))
}

/** `git status --porcelain` as sorted `{path, status}` ('.' stands for a blank column). */
function changedPaths(root) {
  const tokens = splitZ(git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], root))
  const changed = []
  for (let i = 0; i < tokens.length; i++) {
    const code = tokens[i].slice(0, 2)
    const entry = { path: tokens[i].slice(3), status: code.replaceAll(' ', '.') }
    if (code[0] === 'R' || code[0] === 'C') {
      entry.renamedFrom = tokens[++i]
    }
    changed.push(entry)
  }
  return changed.sort((a, b) => compare(a.path, b.path))
}

function compare(a, b) {
  if (a < b) return -1
  return a > b ? 1 : 0
}

// ─── Credential scan ───────────────────────────────────────────────────────────

const PUBLIC_WORDS = /^(true|false|null|undefined|localhost|development|production|staging)$/i
const PLACEHOLDER = /^(<.*>|\$\{.*\}|\$\w+|\{.*\}|%\w|your[-_\w]*|changeme|placeholder|example)$/i

/**
 * Values worth looking for: long enough to be distinctive, not a URL without
 * credentials, an email or a bare word, and carrying a digit or at least 16
 * characters. Short or common values would flag every file in the repo.
 */
function looksSecret(value) {
  if (value.length < 8) return false
  if (PUBLIC_WORDS.test(value) || PLACEHOLDER.test(value)) return false
  if (/^https?:\/\/[^@\s]*$/i.test(value)) return false
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value)) return false
  return /\d/.test(value) || value.length >= 16
}

function parseSettingsValues(text) {
  const values = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const match = /^(?:export\s+)?([A-Za-z_][\w.-]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    const quoted = /^(["'])(.*)\1/.exec(value)
    if (quoted) value = quoted[2]
    else value = value.replace(/\s+#.*$/, '')
    if (looksSecret(value)) values.push({ key: match[1], value })
  }
  return values
}

/** The credentials in this machine's local settings files, as `{key, source, bytes}`. */
function collectLocalCredentials(root, candidatePaths) {
  const sources = new Set()
  for (const path of [...candidatePaths, ...listIgnoredFiles(root)]) {
    if (isSettingsFile(basename(path))) sources.add(path)
  }
  const seen = new Set()
  const credentials = []
  for (const source of [...sources].sort(compare)) {
    let text
    try {
      const buf = readFileSync(join(root, source))
      if (buf.length > SETTINGS_READ_LIMIT) continue
      text = buf.toString('utf8')
    } catch {
      continue
    }
    for (const { key, value } of parseSettingsValues(text)) {
      if (seen.has(value)) continue
      seen.add(value)
      credentials.push({ key, source, bytes: Buffer.from(value, 'utf8') })
    }
  }
  return { credentials, sourceCount: sources.size }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])
const PLACEHOLDER_PASSWORD =
  /^(password\d*|passw0rd|pass|postgres|secret|changeme|example|test|user|root|admin|x{3,}|\*+|\.{3}|<.*>|\$\{.*\}|\$\w+|\{.*\}|%\w|\$\d|your[-_\w]*|placeholder)$/i
const URL_WITH_PASSWORD =
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?|amqps?):\/\/[^\s:@/'"`<>]+:([^\s@/'"`<>]+)@([^\s/'"`:?<>]+)/g

// Generated database passwords are long; fixtures and docs use `u:p` or `secret`.
const MIN_URL_PASSWORD_LENGTH = 12

/**
 * Well-known secret shapes. A rule fires on the first match in a file.
 * The private-key rule needs real key material after the header (raw or JSON-escaped
 * newlines), so a truncated `MIIEvQI...` placeholder in a form does not trip it.
 */
const SECRET_SHAPES = [
  {
    rule: 'private key block',
    test: (t) =>
      /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----(?:\s|\\[nr])*[A-Za-z0-9+/]{40,}/.test(t),
  },
  { rule: 'AWS access key id', test: (t) => /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/.test(t) },
  {
    rule: 'GitHub token',
    test: (t) => /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/.test(t),
  },
  { rule: 'Slack token', test: (t) => /\bxox[abprs]-[A-Za-z0-9-]{10,}/.test(t) },
  { rule: 'Stripe live key', test: (t) => /\b[sr]k_live_[A-Za-z0-9]{16,}/.test(t) },
  {
    rule: 'Doppler token',
    test: (t) => /\bdp\.(?:st|pt|sa|ct|scim|audit)(?:\.[a-z0-9_-]+)?\.[A-Za-z0-9]{30,}/.test(t),
  },
  { rule: 'Google API key', test: (t) => /\bAIza[0-9A-Za-z_-]{35}\b/.test(t) },
  { rule: 'Resend API key', test: (t) => /\bre_[A-Za-z0-9]{6,}_[A-Za-z0-9]{16,}\b/.test(t) },
  {
    rule: 'database URL with a password',
    test: (t) => {
      for (const match of t.matchAll(URL_WITH_PASSWORD)) {
        const [, password, host] = match
        if (password.length < MIN_URL_PASSWORD_LENGTH || PLACEHOLDER_PASSWORD.test(password)) {
          continue
        }
        if (LOOPBACK_HOSTS.has(host) || /[${}]/.test(host)) continue
        return true
      }
      return false
    },
  },
]

function lineAt(buf, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (buf[i] === 0x0a) line++
  return line
}

/** Findings for one file's bytes: `{path, line, what}` — never the matching value. */
function scanFile(path, buf, credentials) {
  const findings = []
  const isText = !buf.subarray(0, 8000).includes(0)
  for (const { key, source, bytes } of credentials) {
    const index = buf.indexOf(bytes)
    if (index === -1) continue
    findings.push({
      path,
      line: isText ? lineAt(buf, index) : null,
      what: `contains the value of ${key} from ${source}`,
    })
  }
  if (isText && buf.length <= TEXT_SCAN_LIMIT) {
    const text = buf.toString('utf8')
    for (const { rule, test } of SECRET_SHAPES) {
      if (test(text)) findings.push({ path, line: null, what: `looks like a secret: ${rule}` })
    }
  }
  return findings
}

// ─── Zip writer ────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// Fixed 1980-01-01 00:00 so the same tree gives the same bytes.
const DOS_TIME = 0
const DOS_DATE = (1 << 5) | 1
const UTF8_NAMES = 0x0800
const ZIP_LIMIT = 0xffffffff
const ZIP_MAX_ENTRIES = 0xffff

function writeAll(fd, buf) {
  let written = 0
  while (written < buf.length) written += writeSync(fd, buf, written)
}

function createZipWriter(fd) {
  const digest = createHash('sha256')
  const central = []
  let offset = 0

  const write = (buf) => {
    writeAll(fd, buf)
    digest.update(buf)
    offset += buf.length
  }

  return {
    add(name, data, mode) {
      const nameBuf = Buffer.from(name, 'utf8')
      const crc = crc32(data)
      let method = 0
      let body = data
      if (data.length > 0) {
        const deflated = deflateRawSync(data, { level: 9 })
        if (deflated.length < data.length) {
          method = 8
          body = deflated
        }
      }
      if (data.length >= ZIP_LIMIT || body.length >= ZIP_LIMIT || offset >= ZIP_LIMIT) {
        throw new Error(`${name} is too large for a plain zip archive.`)
      }

      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0)
      local.writeUInt16LE(20, 4)
      local.writeUInt16LE(UTF8_NAMES, 6)
      local.writeUInt16LE(method, 8)
      local.writeUInt16LE(DOS_TIME, 10)
      local.writeUInt16LE(DOS_DATE, 12)
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(body.length, 18)
      local.writeUInt32LE(data.length, 22)
      local.writeUInt16LE(nameBuf.length, 26)

      const entry = Buffer.alloc(46)
      entry.writeUInt32LE(0x02014b50, 0)
      entry.writeUInt16LE((3 << 8) | 20, 4) // made on Unix: external attributes carry the mode
      entry.writeUInt16LE(20, 6)
      entry.writeUInt16LE(UTF8_NAMES, 8)
      entry.writeUInt16LE(method, 10)
      entry.writeUInt16LE(DOS_TIME, 12)
      entry.writeUInt16LE(DOS_DATE, 14)
      entry.writeUInt32LE(crc, 16)
      entry.writeUInt32LE(body.length, 20)
      entry.writeUInt32LE(data.length, 24)
      entry.writeUInt16LE(nameBuf.length, 28)
      entry.writeUInt32LE((mode << 16) >>> 0, 38)
      entry.writeUInt32LE(offset, 42)
      central.push(Buffer.concat([entry, nameBuf]))

      write(local)
      write(nameBuf)
      write(body)
    },

    finish() {
      if (central.length > ZIP_MAX_ENTRIES) {
        throw new Error(`${central.length} files is too many for a plain zip archive.`)
      }
      const directoryOffset = offset
      for (const entry of central) write(entry)
      const directorySize = offset - directoryOffset
      const end = Buffer.alloc(22)
      end.writeUInt32LE(0x06054b50, 0)
      end.writeUInt16LE(central.length, 8)
      end.writeUInt16LE(central.length, 10)
      end.writeUInt32LE(directorySize, 12)
      end.writeUInt32LE(directoryOffset, 16)
      write(end)
      return { bytes: offset, sha256: digest.digest('hex') }
    },
  }
}

// ─── CLI ───────────────────────────────────────────────────────────────────────

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { out: null, overwrite: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') continue
    if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg === '--overwrite') opts.overwrite = true
    else if (arg === '--out') {
      opts.out = argv[++i]
      if (!opts.out) throw new UsageError('--out needs a file path.')
    } else if (arg.startsWith('--out=')) opts.out = arg.slice('--out='.length)
    else throw new UsageError(`Unknown argument: ${arg}`)
  }
  return opts
}

const formatCount = (n) => n.toLocaleString('en-US')

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function listPaths(paths, indent = '    ') {
  for (const path of paths.slice(0, MAX_LISTED)) console.log(`${indent}${path}`)
  if (paths.length > MAX_LISTED) console.log(`${indent}… and ${paths.length - MAX_LISTED} more`)
}

function isIgnoredByGit(root, path) {
  return spawnSync('git', ['check-ignore', '-q', '--', path], { cwd: root }).status === 0
}

function run() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(USAGE)
    return 0
  }

  const toplevel = gitOrNull(['rev-parse', '--show-toplevel'], process.cwd())
  if (!toplevel) throw new Error('Not inside a Git repository — nothing to package.')
  const root = resolve(toplevel.toString('utf8').trim())

  const head = gitOrNull(['rev-parse', 'HEAD'], root)
  const commit = head ? head.toString('utf8').trim() : null
  const changed = changedPaths(root)
  const modified = changed.length > 0 || !commit
  const revision = commit ? commit.slice(0, 12) : 'uncommitted'
  const archiveName = `${ARCHIVE_PREFIX}-${revision}${modified && commit ? '-modified' : ''}.zip`
  const outPath = resolve(opts.out ?? join(root, 'tmp', archiveName))

  if (existsSync(outPath) && !opts.overwrite) {
    console.error(`${relative(process.cwd(), outPath) || outPath} already exists.`)
    console.error('Nothing was written. Pass --overwrite to replace it, or --out for another file.')
    return 1
  }

  console.log(`package:source — ${root}`)
  console.log(
    `Revision    ${revision}${modified ? `  (modified: ${formatCount(changed.length)} changed paths)` : ''}`
  )

  // 1. What Git knows, minus what must never be packed.
  const candidates = listCandidates(root)
  const refused = new Map()
  const refuse = (reason, path) => {
    if (!refused.has(reason)) refused.set(reason, [])
    refused.get(reason).push(path)
  }
  const files = []
  for (const [path, mode] of [...candidates].sort((a, b) => compare(a[0], b[0]))) {
    const full = join(root, path)
    if (full === outPath) continue
    const reason = refusalFor(path)
    if (reason) {
      refuse(reason, path)
      continue
    }
    if (mode === '120000' || mode === '160000') {
      refuse('symlink or submodule', path)
      continue
    }
    let stat
    try {
      stat = lstatSync(full)
    } catch {
      refuse('deleted in the working tree', path)
      continue
    }
    if (!stat.isFile()) {
      refuse('not a regular file', path)
      continue
    }
    // `--out` can name an archive anything, so recognise one made by this tool by its contents.
    if (/\.zip$/i.test(path) && readFileSync(full).includes(MANIFEST_NAME)) {
      refuse('earlier archive', path)
      continue
    }
    files.push({ path, full, mode: mode === '100755' ? 0o100755 : 0o100644 })
  }

  const refusedTotal = [...refused.values()].reduce((sum, paths) => sum + paths.length, 0)
  console.log(`Candidates  ${formatCount(candidates.size)} files from Git`)
  console.log(`Refused     ${formatCount(refusedTotal)}`)
  for (const [reason, paths] of [...refused].sort((a, b) => compare(a[0], b[0]))) {
    console.log(`  ${reason} (${formatCount(paths.length)})`)
    listPaths(paths)
  }

  // 2. Hash and scan every file before anything is written.
  const { credentials, sourceCount } = collectLocalCredentials(
    root,
    files.map((f) => f.path).concat([...refused.values()].flat())
  )
  const findings = []
  for (const file of files) {
    const buf = readFileSync(file.full)
    file.size = buf.length
    file.sha256 = createHash('sha256').update(buf).digest('hex')
    findings.push(...scanFile(file.path, buf, credentials))
  }

  if (findings.length > 0) {
    console.error('')
    console.error(
      `STOPPED — ${formatCount(findings.length)} credential finding(s) in files to be packed:`
    )
    for (const { path, line, what } of findings) {
      console.error(`  ${path}${line ? `:${line}` : ''}  ${what}`)
    }
    console.error('')
    console.error('Nothing was written. Remove the credential from the file (or refuse the file')
    console.error(
      'by name in scripts/package-source.mjs), then run it again. Values are never printed.'
    )
    return 1
  }
  console.log(
    `Scan        clean — ${formatCount(files.length)} files checked against ${formatCount(credentials.length)} local settings values (from ${formatCount(sourceCount)} files) and ${SECRET_SHAPES.length} secret patterns`
  )

  // 3. Write the archive to a partial file, then move it into place.
  const refusedCounts = Object.fromEntries(
    [...refused]
      .sort((a, b) => compare(a[0], b[0]))
      .map(([reason, paths]) => [reason, paths.length])
  )
  const manifest = {
    format: 1,
    tool: 'scripts/package-source.mjs',
    commit,
    modified,
    changedPaths: changed,
    excluded: { total: refusedTotal, byReason: refusedCounts },
    fileCount: files.length,
    files: files.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
  }

  mkdirSync(dirname(outPath), { recursive: true })
  const relOut = relative(root, outPath)
  if (!relOut.startsWith('..') && !isAbsolute(relOut) && !isIgnoredByGit(root, relOut)) {
    console.log(`Warning     ${relOut} is inside the repository and not git-ignored`)
  }
  const partialPath = `${outPath}.partial`
  const fd = openSync(partialPath, 'w')
  let result
  try {
    const zip = createZipWriter(fd)
    zip.add(MANIFEST_NAME, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'), 0o100644)
    for (const file of files) {
      const buf = readFileSync(file.full)
      if (createHash('sha256').update(buf).digest('hex') !== file.sha256) {
        throw new Error(`${file.path} changed while the archive was being written. Run it again.`)
      }
      zip.add(file.path, buf, file.mode)
    }
    result = zip.finish()
    closeSync(fd)
  } catch (error) {
    closeSync(fd)
    rmSync(partialPath, { force: true })
    throw error
  }
  if (existsSync(outPath) && !opts.overwrite) {
    rmSync(partialPath, { force: true })
    console.error(`${outPath} appeared while writing. Nothing was replaced.`)
    return 1
  }
  renameSync(partialPath, outPath)

  console.log(
    `Wrote       ${relative(process.cwd(), outPath) || outPath}  (${formatCount(files.length)} files, ${formatBytes(result.bytes)})`
  )
  console.log(`SHA-256     ${result.sha256}`)
  return 0
}

try {
  process.exitCode = run()
} catch (error) {
  console.error(`package:source: ${error.message}`)
  if (error instanceof UsageError) console.error(USAGE)
  process.exitCode = 2
}
