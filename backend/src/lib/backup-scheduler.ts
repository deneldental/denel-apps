// Database backup logic — pg_dump → gzip → object storage.
//
// Scheduling moved to `lib/cron/`. This file now exports just the work
// function (`runBackupNow`). The integrations PATCH route reloads the cron
// engine directly (via `reloadCronEngine`) after a config change.
//
// pg_dump must be on the host PATH. Its output is gzip-compressed in-process
// (Node's zlib) to a temp file, then uploaded — privately — to the provider
// chosen on the Backup card ("Storage target").

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fs, type ReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { type BackupConfig, getBackupConfig, setBackupConfig } from './integrations'
import { logger } from './logger'
import { uploadPrivateToProvider } from './storage-router'

export type BackupRunResult =
  | { status: 'ok'; key: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string }

/** Backups are private and their key carries 64 random bits, so it cannot be guessed. */
export function backupObjectKey(schedule: string, stamp: string): string {
  return `SYS/backups/${schedule}/${stamp}-${randomBytes(8).toString('hex')}.sql.gz`
}

export async function runBackupNow(): Promise<BackupRunResult> {
  const cfg = await getBackupConfig()
  if (!cfg) return { status: 'skipped', reason: 'no backup config' }
  if (!cfg.enabled) return { status: 'skipped', reason: 'disabled in config' }
  if (!cfg.connectionString) return { status: 'skipped', reason: 'no connection string' }

  const startedAt = new Date()
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-')
  const tmpFile = join(tmpdir(), `framada-backup-${stamp}.sql.gz`)

  logger.info({ tmpFile }, '[backup] starting pg_dump')

  let upload: ReadStream | null = null
  try {
    await dumpAndCompress(cfg.connectionString, tmpFile)
    const key = backupObjectKey(cfg.schedule, stamp)
    upload = createReadStream(tmpFile)
    // To the provider the Backup card chose ("Storage target") — the dropdown
    // used to be saved but never read, and backups silently followed the
    // system_docs routing instead.
    await uploadPrivateToProvider(cfg.targetProvider, key, upload, 'application/gzip')
    await recordOutcome(cfg, { lastRunAt: startedAt.toISOString(), lastStatus: 'ok' })
    logger.info({ key }, '[backup] complete')
    return { status: 'ok', key }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    logger.error({ err }, '[backup] failed')
    // The Backup card shows lastStatus, and a raw driver message (a failed
    // query with its parameters) runs to kilobytes — store a readable summary.
    // The log above and the job-run record keep the full text.
    const brief = message.length > 300 ? `${message.slice(0, 300)}…` : message
    // Recording the failure must never replace the failure itself.
    await recordOutcome(cfg, {
      lastRunAt: startedAt.toISOString(),
      lastStatus: `failed: ${brief}`,
    }).catch((recordErr) =>
      logger.error({ err: recordErr }, '[backup] could not record the failure')
    )
    return { status: 'failed', error: message }
  } finally {
    // An upload refused before reading the file leaves it open; close it so the
    // temp file can be removed (Windows) and its disk space freed.
    upload?.destroy()
    await fs.rm(tmpFile, { force: true }).catch(() => {})
  }
}

/**
 * Write the run's outcome onto the settings as they are NOW — a backup can take
 * minutes, and settings saved meanwhile must not be reverted to the snapshot
 * taken at the start. A scheduled run has no user behind it: `updatedById` null.
 */
async function recordOutcome(
  startCfg: BackupConfig,
  outcome: Pick<BackupConfig, 'lastRunAt' | 'lastStatus'>
): Promise<void> {
  const latest = (await getBackupConfig()) ?? startCfg
  await setBackupConfig({ ...latest, ...outcome }, null)
}

/**
 * pg_dump → gzip → file, without a shell: no `gzip` binary needed (Node's zlib
 * compresses), no quoting of the connection string, and a failed pg_dump fails
 * the backup — a shell pipe reports gzip's exit code, so it would have saved an
 * empty "successful" backup.
 */
async function dumpAndCompress(connectionString: string, outFile: string): Promise<void> {
  const child = spawn('pg_dump', [`--dbname=${connectionString}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  const exited = new Promise<void>((resolve, reject) => {
    child.on('error', (err: NodeJS.ErrnoException) => {
      reject(
        err.code === 'ENOENT'
          ? new Error('pg_dump was not found — install the PostgreSQL client tools on this server')
          : err
      )
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`pg_dump exited ${code}: ${stderr.trim().slice(0, 500)}`))
    })
  })
  const written = pipeline(child.stdout, createGzip(), createWriteStream(outFile))
  written.catch(() => child.kill())
  await Promise.all([exited, written])
}
