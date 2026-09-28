import type { patients } from '../db/schema'
import type { VerifiedApiKey } from './api-keys'

export type HonoEnv = {
  Variables: {
    skipAudit?: boolean
    requestId?: string
    apiKey?: VerifiedApiKey
    patientUser?: typeof patients.$inferSelect
    /** A backup export: send stored private-file references as they are, unsigned. */
    keepPrivateRefs?: boolean
  }
}
