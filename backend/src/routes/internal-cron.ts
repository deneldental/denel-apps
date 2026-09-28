/**
 * Internal cron webhook endpoints.
 *
 * Two auth paths:
 *   - `Upstash-Signature` header → verified against the configured QStash
 *     signing keys. Path for prod schedules.
 *   - `X-Cron-Secret` header → matched against `CronEngineConfig.internalSecret`.
 *     Path for manual triggers from the Integrations UI and for local
 *     node-cron when running in QStash-only prod mode.
 *
 * Mounted at `/api/internal/cron` in `app.ts`.
 */

import { Hono } from 'hono'
import { runJob } from '../lib/cron'
import { CRON_JOBS } from '../lib/cron/registry'
import { verifyQStashSignature } from '../lib/cron/verify-qstash'
import { getCronEngineConfig } from '../lib/integrations'
import { logger } from '../lib/logger'
import type { HonoEnv } from '../lib/types'

const internalCron = new Hono<HonoEnv>()

internalCron.get('/jobs', async (c) => {
  // List the registry so the UI can render the table. No secrets needed —
  // job ids + descriptions are not sensitive.
  return c.json({
    success: true,
    data: CRON_JOBS.map((j) => ({
      id: j.id,
      description: j.description,
      cron: j.cron,
      timeoutMs: j.timeoutMs,
    })),
  })
})

internalCron.post('/:jobId', async (c) => {
  const jobId = c.req.param('jobId')
  const rawBody = await c.req.text()

  // Auth route A: QStash signature.
  const signature = c.req.header('upstash-signature')
  let source: 'qstash' | 'manual' = 'manual'
  if (signature) {
    const targetUrl = `${c.req.url.split('?')[0]}`
    const verify = await verifyQStashSignature(signature, rawBody, targetUrl)
    if (!verify.valid) {
      logger.warn({ jobId, reason: verify.reason }, '[internal-cron] qstash sig invalid')
      return c.json({ error: 'invalid signature' }, 401)
    }
    source = 'qstash'
  } else {
    // Auth route B: shared secret.
    const provided = c.req.header('x-cron-secret') ?? ''
    const cfg = await getCronEngineConfig()
    if (!cfg?.internalSecret) {
      return c.json({ error: 'cron engine not configured' }, 409)
    }
    if (provided !== cfg.internalSecret) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    source = 'manual'
  }

  const result = await runJob(jobId, { source })
  if (result.status === 'unknown_job') {
    return c.json({ error: 'unknown job', jobId }, 404)
  }
  return c.json({ success: result.status === 'success', ...result })
})

export { internalCron }
