import { api } from '@/lib/api-client'
import { logger } from '@/lib/logger'

type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'login'
  | 'logout'
  | 'view'
  | 'export'
  | 'upload'
  | 'download'
  | 'lock'
  | 'unlock'

interface AuditLogParams {
  userId: string
  action: AuditAction
  module: string
  entityId?: string
  entityName?: string
  changes?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
}

/**
 * Create an audit log entry
 */
export async function createAuditLog(params: AuditLogParams) {
  try {
    await api.post('/api/audit-logs', params)

    logger.info(
      {
        userId: params.userId,
        action: params.action,
        module: params.module,
        entityId: params.entityId,
      },
      'Audit log created'
    )
  } catch (error) {
    logger.error({ error, params }, 'Failed to create audit log')
    // Don't throw error to prevent breaking the main operation
  }
}

/**
 * Helper function to format changes for audit log
 */
export function formatChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, { before: unknown; after: unknown }> {
  const changes: Record<string, { before: unknown; after: unknown }> = {}

  // Get all unique keys from both objects
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)])

  for (const key of allKeys) {
    if (before[key] !== after[key]) {
      changes[key] = {
        before: before[key],
        after: after[key],
      }
    }
  }

  return changes
}
