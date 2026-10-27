/**
 * Tests for scripts/package-source.mjs. Each test builds a throwaway Git repo in the
 * OS temp dir and runs the real script against it as a subprocess.
 *
 *   pnpm run test:package-source
 *
 * Fake secrets are assembled by concatenation on purpose: the scanner reads this very
 * file when the real repo is packaged, and a contiguous fixture would stop it.
 */

import { strict as assert } from 'node:assert'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'package-source.mjs')
const madeDirs = []

after(() => {
  for (const dir of madeDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
})

function git(dir, ...args) {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function write(dir, path, content) {
  const full = join(dir, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

/** A committed repo holding `tracked`; tests then add untracked/ignored files on top. */
function makeRepo(tracked = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'package-source-test-'))
  madeDirs.push(dir)
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test')
  git(dir, 'config', 'core.autocrlf', 'false')
  write(dir, '.gitignore', '/tmp/\n.env\n.env.*\n!.env.example\nnode_modules/\n')
  for (const [path, content] of Object.entries(tracked)) write(dir, path, content)
  git(dir, 'add', '-A')
  git(dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init')
  return dir
}

function pack(dir, ...args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' })
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    all: result.stdout + result.stderr,
  }
}

/** Minimal zip reader, independent of the writer: central directory → `{mode, data}` per name. */
function readZip(file) {
  const buf = readFileSync(file)
  const end = buf.length - 22
  assert.equal(buf.readUInt32LE(end), 0x06054b50, 'end-of-central-directory signature')
  const count = buf.readUInt16LE(end + 10)
  let p = buf.readUInt32LE(end + 16)
  const entries = new Map()
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central directory signature')
    const method = buf.readUInt16LE(p + 10)
    const compressedSize = buf.readUInt32LE(p + 20)
    const nameLength = buf.readUInt16LE(p + 28)
    const mode = buf.readUInt32LE(p + 38) >>> 16
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + compressedSize)
    entries.set(name, { mode, data: method === 8 ? inflateRawSync(raw) : raw })
    p += 46 + nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
  }
  return entries
}

function defaultArchive(dir) {
  const [name] = readdirSync(join(dir, 'tmp'))
  return join(dir, 'tmp', name)
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

/** path → sha256 of every file outside tmp/ and .git/, to prove the tree is left alone. */
function snapshot(dir, rel = '') {
  const out = {}
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name
    if (path === 'tmp' || path === '.git') continue
    if (entry.isDirectory()) Object.assign(out, snapshot(dir, path))
    else out[path] = sha256(readFileSync(join(dir, path)))
  }
  return out
}

describe('package:source — what goes in the archive', () => {
  it('packs the working tree, refuses by name even tracked files, and records it all', () => {
    const dir = makeRepo({
      'src/app.js': 'export const app = 1\n',
      'gone.js': 'removed from disk later\n',
      '.env.example': 'API_URL=http://localhost:3000\n',
      '.mcp.json': '{}\n',
      'scripts/run.sh': '#!/bin/sh\n',
      'certs/server.key': 'not really a key\n',
      'scratch/note.js': 'throwaway\n',
    })
    git(dir, 'update-index', '--chmod=+x', 'scripts/run.sh')
    write(dir, 'node_modules/pkg/index.js', 'module.exports = 1\n')
    git(dir, 'add', '-f', 'node_modules/pkg/index.js')
    write(dir, 'src/new.js', 'export const added = 2\n') // untracked, not ignored
    write(dir, 'notes.env', 'X=1\n') // untracked, not ignored, a settings file
    write(dir, '.env', 'IGNORED_ONE=never-listed-by-git-1234\n') // ignored
    rmSync(join(dir, 'gone.js')) // tracked, deleted in the working tree

    const result = pack(dir)
    assert.equal(result.status, 0, result.all)

    const commit = git(dir, 'rev-parse', 'HEAD').trim()
    const archive = defaultArchive(dir)
    assert.equal(archive.split(/[\\/]/).pop(), `denel-source-${commit.slice(0, 12)}-modified.zip`)

    const zip = readZip(archive)
    assert.deepEqual(
      [...zip.keys()],
      [
        'SOURCE_PACKAGE.json',
        '.env.example',
        '.gitignore',
        'scripts/run.sh',
        'src/app.js',
        'src/new.js',
      ],
      'sorted, manifest first, nothing refused'
    )
    assert.equal(zip.get('scripts/run.sh').mode, 0o100755, 'the recorded executable bit survives')
    assert.equal(zip.get('src/app.js').mode, 0o100644)

    const manifest = JSON.parse(zip.get('SOURCE_PACKAGE.json').data.toString('utf8'))
    assert.equal(manifest.commit, commit)
    assert.equal(manifest.modified, true)
    assert.equal(manifest.fileCount, 5)
    for (const file of manifest.files) {
      assert.equal(file.sha256, sha256(zip.get(file.path).data), `${file.path} hash`)
      assert.equal(file.size, zip.get(file.path).data.length)
    }
    assert.deepEqual(
      manifest.changedPaths.map(({ path, status }) => `${status} ${path}`),
      [
        '.D gone.js',
        'A. node_modules/pkg/index.js',
        '?? notes.env',
        'M. scripts/run.sh',
        '?? src/new.js',
      ]
    )
    assert.deepEqual(manifest.excluded.byReason, {
      dependencies: 1,
      'deleted in the working tree': 1,
      'key or certificate': 1,
      'local tool settings': 1,
      'scratch folder': 1,
      'settings file': 1,
    })
  })

  it('names a clean tree without -modified', () => {
    const dir = makeRepo({ 'a.txt': 'a\n' })
    assert.equal(pack(dir).status, 0)
    const zip = readZip(defaultArchive(dir))
    const manifest = JSON.parse(zip.get('SOURCE_PACKAGE.json').data.toString('utf8'))
    assert.equal(manifest.modified, false)
    assert.deepEqual(manifest.changedPaths, [])
    assert.ok(!defaultArchive(dir).endsWith('-modified.zip'))
  })

  it('never changes or deletes anything in the working tree', () => {
    const dir = makeRepo({ 'a.txt': 'a\n', 'b/c.txt': 'c\n' })
    write(dir, 'untracked.txt', 'u\n')
    write(dir, '.env', 'SECRET_ONE=abcdef123456\n')
    // tmp/ is where the archive goes, so it is the one place allowed to appear.
    const status = () => git(dir, 'status', '--porcelain', '--ignored').replace('!! tmp/\n', '')
    const before = { files: snapshot(dir), status: status() }
    assert.equal(pack(dir).status, 0)
    assert.deepEqual(snapshot(dir), before.files)
    assert.equal(status(), before.status)
  })
})

describe('package:source — credentials stop the run', () => {
  it('stops, writes nothing and never prints the value of a local settings credential', () => {
    const secret = 'Xk29vLmQ8rTz'
    const dir = makeRepo({
      'src/config.js': `// config\nexport const x = 1\nexport const pw = '${secret}'\n`,
    })
    write(dir, '.env', `DATABASE_PASSWORD=${secret}\n`)

    const result = pack(dir)
    assert.equal(result.status, 1)
    assert.match(
      result.stderr,
      /src\/config\.js:3\s+contains the value of DATABASE_PASSWORD from \.env/
    )
    assert.ok(!result.all.includes(secret), 'the value must never be printed')
    assert.ok(!existsSync(join(dir, 'tmp')), 'nothing written, not even the folder')
  })

  it('ignores short or common settings values instead of flagging every file', () => {
    const dir = makeRepo({
      'src/a.js': "const env = 'production'\nconst url = 'http://localhost:3000'\n",
    })
    write(dir, '.env', 'NODE_ENV=production\nAPP_URL=http://localhost:3000\nPORT=3000\nFLAG=true\n')
    assert.equal(pack(dir).status, 0)
  })

  it('stops on a private key with real key material, but not on a truncated placeholder', () => {
    const header = '-----BEGIN RSA PRIVATE KEY-----'
    const real = makeRepo({
      'key.txt': `${header}\n${'A'.repeat(64)}\n-----END RSA PRIVATE KEY-----\n`,
    })
    const blocked = pack(real)
    assert.equal(blocked.status, 1)
    assert.match(blocked.stderr, /key\.txt\s+looks like a secret: private key block/)

    const placeholder = makeRepo({
      'form.tsx': `const hint = '${header}\\nMIIEvQI...\\n-----END PRIVATE KEY-----'\n`,
    })
    assert.equal(pack(placeholder).status, 0)
  })

  it('stops on a database URL with a long password, not on fixtures or local URLs', () => {
    const url = (user, password, host) => `postgresql://${user}:${password}@${host}/db`
    const flagged = makeRepo({ 'x.ts': `${url('owner', 'Zq8fK2mVx9Lp3Rt', 'ep-x.neon.tech')}\n` })
    const blocked = pack(flagged)
    assert.equal(blocked.status, 1)
    assert.match(blocked.stderr, /x\.ts\s+looks like a secret: database URL with a password/)
    assert.ok(!blocked.all.includes('Zq8fK2mVx9Lp3Rt'))

    const fine = makeRepo({
      'y.ts': [
        url('u', 'p', 'some-host.example.com'),
        url('app', 'abcdefghijklmnop', 'localhost:5432'),
        url('app', `$${'{DB_PASSWORD_VALUE_X}'}`, 'db'),
        url('framada', 'secret', 'ep-x.neon.tech'),
      ].join('\n'),
    })
    assert.equal(pack(fine).status, 0, 'fixtures, loopback hosts and templates are not secrets')
  })
})

describe('package:source — output file', () => {
  it('is byte-identical for the same tree, and replaced only with --overwrite', () => {
    const dir = makeRepo({ 'a.txt': 'hello\n', 'b/c.txt': 'c\n'.repeat(500) })
    write(dir, 'extra.txt', 'untracked\n')
    const first = join(dir, 'tmp', 'out-a.zip')
    const second = join(dir, 'tmp', 'out-b.zip')
    assert.equal(pack(dir, '--out', first).status, 0)
    assert.equal(pack(dir, '--out', second).status, 0)
    assert.deepEqual(readFileSync(first), readFileSync(second))

    const before = readFileSync(first)
    const refused = pack(dir, '--out', first)
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /already exists/)
    assert.deepEqual(readFileSync(first), before, 'an existing archive is left alone')

    write(dir, 'extra.txt', 'changed\n')
    assert.equal(pack(dir, '--out', first, '--overwrite').status, 0)
    assert.notDeepEqual(readFileSync(first), before)
    assert.ok(
      !readdirSync(join(dir, 'tmp')).some((name) => name.endsWith('.partial')),
      'no partial file left'
    )
  })

  it('does not pack the archive into itself when --out is inside the repo', () => {
    const dir = makeRepo({ 'a.txt': 'a\n' })
    const out = join(dir, 'review.zip')
    assert.equal(pack(dir, '--out', out).status, 0)
    assert.equal(pack(dir, '--out', out, '--overwrite').status, 0)
    assert.ok(!readZip(out).has('review.zip'))
  })

  it('refuses earlier archives by name', () => {
    const dir = makeRepo({ 'a.txt': 'a\n' })
    write(dir, 'denel-source-abc123-modified.zip', 'old archive')
    assert.equal(pack(dir).status, 0)
    assert.ok(!readZip(defaultArchive(dir)).has('denel-source-abc123-modified.zip'))
  })

  it('refuses an earlier archive by its contents when --out gave it another name', () => {
    const dir = makeRepo({ 'a.txt': 'a\n' })
    assert.equal(pack(dir, '--out', join(dir, 'review-copy.zip')).status, 0)
    assert.equal(pack(dir).status, 0)
    const zip = readZip(defaultArchive(dir))
    assert.ok(!zip.has('review-copy.zip'))
    const manifest = JSON.parse(zip.get('SOURCE_PACKAGE.json').data.toString('utf8'))
    assert.equal(manifest.excluded.byReason['earlier archive'], 1)
  })

  it('still packs an unrelated zip that is part of the source', () => {
    const dir = makeRepo({ 'fixtures/sample.zip': 'PK-not-ours' })
    assert.equal(pack(dir).status, 0)
    assert.ok(readZip(defaultArchive(dir)).has('fixtures/sample.zip'))
  })
})

describe('package:source — usage', () => {
  it('rejects unknown arguments with exit code 2 and writes nothing', () => {
    const dir = makeRepo({ 'a.txt': 'a\n' })
    const result = pack(dir, '--bogus')
    assert.equal(result.status, 2)
    assert.match(result.stderr, /Unknown argument: --bogus/)
    assert.ok(!existsSync(join(dir, 'tmp')))
  })

  it('tolerates the bare -- that pnpm may pass through', () => {
    const dir = makeRepo({ 'a.txt': 'a\n' })
    assert.equal(pack(dir, '--').status, 0)
  })
})
