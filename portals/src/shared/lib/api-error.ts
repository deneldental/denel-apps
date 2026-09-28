import { toast } from 'sonner'
import type { ApiResponse } from '@/lib/api-client'

/**
 * Build a human-readable message from a failed `ApiResponse`.
 *
 * Prefers the backend's field-level zod `issues` (e.g. "amount: Expected number"),
 * then the top-level `error` string, then the provided fallback. Keeps form
 * error handling consistent and stops the audit's "errors swallowed into a
 * generic toast / structured issues discarded" pattern.
 */
export function apiErrorMessage(
  res: Pick<ApiResponse, 'error' | 'issues'>,
  fallback = 'Something went wrong'
): string {
  const issue = res.issues?.[0]
  if (issue) {
    const path = issue.path?.filter((p) => p !== 'data').join('.')
    return path ? `${path}: ${issue.message}` : issue.message
  }
  return res.error || fallback
}

/** Toast a failed `ApiResponse` with the best available message. */
export function surfaceApiError(
  res: Pick<ApiResponse, 'error' | 'issues'>,
  fallback?: string
): void {
  toast.error(apiErrorMessage(res, fallback))
}
