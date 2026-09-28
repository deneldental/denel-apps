/**
 * A database backup: pg_dump's output, gzip-compressed, uploaded privately,
 * and its outcome recorded on the Backup card. `pg_dump` is faked at `spawn`.
 */
import { EventEmitter } from 'node:events'
import { PassThrough, type Readable } from 'node:stream'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
  },
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/integrations', () => ({
  getBackupConfig: vi.fn(),
  setBackupConfig: vi.fn(),
}))
vi.mock('../../src/lib/storage-router', () => ({
  uploadToCategory: vi.fn(),
  uploadPrivateToProvider: vi.fn(),
}))

import { spawn } from 'node:child_process'
import { runBackupNow } from '../../src/lib/backup-scheduler'
import { getBackupConfig, setBackupConfig } from '../../src/lib/integrations'
import { uploadPrivateToProvider, uploadToCategory } from '../../src/lib/storage-router'

const CONFIG = {
  connectionString: 'postgresql://framada:framada@localhost:5433/framada',
  schedule: 'daily-6pm' as const,
  targetProvider: 'r2' as const,
  enabled: true,
}

/** A stand-in for the pg_dump child process. */
function fakePgDump(opts: {
  stdout?: string
  exitCode?: number
  stderr?: string
  spawnError?: NodeJS.ErrnoException
}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    kill: () => void
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn()
  setImmediate(() => {
    if (opts.spawnError) {
      child.emit('error', opts.spawnError)
      child.stdout.end()
      child.emit('close', -2)
      return
    }
    if (opts.stderr) child.stderr.write(opts.stderr)
    child.stdout.end(opts.stdout ?? '')
    child.stderr.end()
    setImmediate(() => child.emit('close', opts.exitCode ?? 0))
  })
  return child
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

let uploaded: Buffer | null
beforeEach(() => {
  uploaded = null
  vi.mocked(getBackupConfig).mockResolvedValue(CONFIG)
  vi.mocked(setBackupConfig).mockResolvedValue(undefined)
  vi.mocked(uploadPrivateToProvider).mockImplementation(async (_provider, _key, body) => {
    uploaded = await readAll(body as Readable)
    return { url: 'private-file://r2/x#0123456789abcdef', providerId: 'r2' }
  })
})
afterEach(() => vi.clearAllMocks())

describe('runBackupNow', () => {
  it("uploads pg_dump's output gzip-compressed, without a shell", async () => {
    vi.mocked(spawn).mockImplementation(
      () => fakePgDump({ stdout: 'CREATE TABLE patients ();\n' }) as never
    )

    const result = await runBackupNow()

    expect(result.status).toBe('ok')
    expect(gunzipSync(uploaded ?? Buffer.alloc(0)).toString()).toBe('CREATE TABLE patients ();\n')
    const [command, args, options] = vi.mocked(spawn).mock.calls[0]
    expect(command).toBe('pg_dump')
    expect(args).toEqual([`--dbname=${CONFIG.connectionString}`])
    expect(options).not.toHaveProperty('shell')
  })

  it('uploads to the provider chosen on the Backup card, privately, bypassing routing', async () => {
    vi.mocked(spawn).mockImplementation(() => fakePgDump({ stdout: 'x' }) as never)
    vi.mocked(getBackupConfig).mockResolvedValue({ ...CONFIG, targetProvider: 'do_spaces' })

    const result = await runBackupNow()

    expect(result.status).toBe('ok')
    const [provider, key, , contentType] = vi.mocked(uploadPrivateToProvider).mock.calls[0]
    expect(provider).toBe('do_spaces')
    expect(key).toMatch(/^SYS\/backups\/daily-6pm\//)
    expect(contentType).toBe('application/gzip')
    // The category-routing path is not involved at all.
    expect(vi.mocked(uploadToCategory)).not.toHaveBeenCalled()
  })

  it('records the result as a system action, with no user', async () => {
    vi.mocked(spawn).mockImplementation(() => fakePgDump({ stdout: 'x' }) as never)

    await runBackupNow()

    expect(vi.mocked(setBackupConfig)).toHaveBeenCalledWith(
      expect.objectContaining({ lastStatus: 'ok' }),
      null
    )
  })

  it("fails with pg_dump's own message and uploads nothing when pg_dump fails", async () => {
    vi.mocked(spawn).mockImplementation(
      () => fakePgDump({ exitCode: 1, stderr: 'connection to server failed' }) as never
    )

    const result = await runBackupNow()

    expect(result).toEqual({
      status: 'failed',
      error: 'pg_dump exited 1: connection to server failed',
    })
    expect(vi.mocked(uploadPrivateToProvider)).not.toHaveBeenCalled()
  })

  it('says so plainly when pg_dump is not installed', async () => {
    const missing = Object.assign(new Error('spawn pg_dump ENOENT'), { code: 'ENOENT' })
    vi.mocked(spawn).mockImplementation(() => fakePgDump({ spawnError: missing }) as never)

    const result = await runBackupNow()

    expect(result).toEqual({
      status: 'failed',
      error: 'pg_dump was not found — install the PostgreSQL client tools on this server',
    })
  })

  it('keeps the real failure when recording it fails too', async () => {
    vi.mocked(spawn).mockImplementation(
      () => fakePgDump({ exitCode: 1, stderr: 'bad password' }) as never
    )
    vi.mocked(setBackupConfig).mockRejectedValue(
      new Error('Failed query: insert into clinic_settings')
    )

    const result = await runBackupNow()

    expect(result).toEqual({ status: 'failed', error: 'pg_dump exited 1: bad password' })
  })
  it('keeps Backup settings saved while the backup was running', async () => {
    vi.mocked(spawn).mockImplementation(() => fakePgDump({ stdout: 'x' }) as never)
    vi.mocked(getBackupConfig)
      .mockResolvedValueOnce(CONFIG)
      .mockResolvedValue({ ...CONFIG, schedule: 'weekly-sunday-6pm' })

    await runBackupNow()

    expect(vi.mocked(setBackupConfig)).toHaveBeenCalledWith(
      expect.objectContaining({ schedule: 'weekly-sunday-6pm', lastStatus: 'ok' }),
      null
    )
  })

  it('records a failure as a short summary, not the whole raw message', async () => {
    const hugeMessage = `Failed query: insert into "clinic_settings" ${'A'.repeat(900)}`
    vi.mocked(spawn).mockImplementation(() => fakePgDump({ stdout: 'x' }) as never)
    vi.mocked(uploadPrivateToProvider).mockRejectedValue(new Error(hugeMessage))

    const result = await runBackupNow()

    // The caller still gets the full message; the card gets a readable summary.
    expect(result).toEqual({ status: 'failed', error: hugeMessage })
    const [recorded] = vi.mocked(setBackupConfig).mock.calls.at(-1) ?? []
    expect(recorded?.lastStatus?.startsWith('failed: Failed query:')).toBe(true)
    expect(recorded?.lastStatus?.length ?? 0).toBeLessThanOrEqual(320)
    expect(recorded?.lastStatus?.endsWith('…')).toBe(true)
  })

  it('closes the backup file when the upload is refused', async () => {
    vi.mocked(spawn).mockImplementation(() => fakePgDump({ stdout: 'x' }) as never)
    let body: Readable | null = null
    vi.mocked(uploadPrivateToProvider).mockImplementation(async (_provider, _key, stream) => {
      body = stream as Readable
      throw new Error('upload refused')
    })

    const result = await runBackupNow()

    expect(result).toEqual({ status: 'failed', error: 'upload refused' })
    expect((body as Readable | null)?.destroyed).toBe(true)
  })
})
