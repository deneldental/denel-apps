import { z } from 'zod'
import type { ApiResponse } from '@/lib/api-client'

/**
 * Result shape every report action returns — the contract `useReport` consumes.
 */
export type ReportActionResult<T> = {
  success: boolean
  data?: T | null
  error?: string
}

/**
 * Shared monetary-amount schema for every report response (H25).
 *
 * Accepts a real number or a numeric string (the backend's raw-SQL aggregates
 * sometimes arrive as strings) and coerces it to a number — but, unlike a bare
 * `z.coerce.number()`, it explicitly REJECTS `null` / `undefined` / `''` /
 * non-numeric strings rather than silently coercing them to `0`. This makes
 * `NaN` currency impossible: a malformed amount becomes a validation error.
 */
export const moneySchema = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === 'number' ? v : v.trim() === '' ? Number.NaN : Number(v)
  if (!Number.isFinite(n)) {
    ctx.addIssue({ code: 'custom', message: 'Expected a finite numeric amount' })
    return Number.NaN
  }
  return n
})

/** Like {@link moneySchema} but additionally requires an integer (row counts). */
export const countSchema = moneySchema.refine((n) => Number.isInteger(n), {
  message: 'Expected an integer count',
})

/**
 * Runtime-validate a raw API response against a zod schema (H25).
 *
 * `api.get` blind-casts `response.json()`, so a string amount, a `null`, or a
 * partial payload would otherwise reach the UI and render as `GHS NaN` (or
 * crash on a missing nested field). This funnels every report response through
 * its schema first:
 *  - a transport failure (`!success`) is passed through as-is
 *  - a schema mismatch becomes a clear `success: false` error, never `NaN`
 *  - on success the parsed (and numerically-coerced) data is returned
 */
export function parseReport<T>(
  schema: z.ZodType<T>,
  res: ApiResponse<unknown>
): ReportActionResult<T> {
  if (!res.success) {
    return { success: false, error: res.error ?? 'Failed to load report' }
  }

  const parsed = schema.safeParse(res.data)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const path = first?.path.join('.') || 'response'
    return {
      success: false,
      error: `Malformed report data (${path}: ${first?.message ?? 'invalid'})`,
    }
  }

  return { success: true, data: parsed.data }
}
