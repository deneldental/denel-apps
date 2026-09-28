/**
 * Clinic-wide attendance scoring config, stored in `clinic_settings` under
 * `hr.attendance_config` and merged over the hardcoded defaults. Lets HR adjust
 * work hours / late thresholds / scoring weights without a deploy.
 */

import { eq } from 'drizzle-orm'
import type { getDb } from '../db'
import { clinicSettings } from '../db/schema'
import { type AttendanceConfig, DEFAULT_ATTENDANCE_CONFIG } from './attendance'

export const ATTENDANCE_CONFIG_KEY = 'hr.attendance_config'

type Db = ReturnType<typeof getDb>

/** Load the effective attendance config (stored overrides merged over defaults). */
export async function getAttendanceConfig(db: Db): Promise<AttendanceConfig> {
  const [row] = await db
    .select({ value: clinicSettings.value })
    .from(clinicSettings)
    .where(eq(clinicSettings.key, ATTENDANCE_CONFIG_KEY))
    .limit(1)
  const stored = (row?.value ?? {}) as Partial<AttendanceConfig>
  return { ...DEFAULT_ATTENDANCE_CONFIG, ...stored }
}
