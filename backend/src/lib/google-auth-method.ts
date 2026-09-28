// Which Google Calendar auth method is currently active for the clinic.
// Stored as a single clinic_settings row so admins can toggle from the UI.

import { eq } from 'drizzle-orm'
import type { getDb } from '../db'
import { clinicSettings } from '../db/schema'

export const AUTH_METHOD_KEY = 'integrations:google_calendar_auth_method'

export type GoogleAuthMethod = 'oauth' | 'service_account'

const DEFAULT_METHOD: GoogleAuthMethod = 'oauth'

type Db = ReturnType<typeof getDb>

export async function getActiveAuthMethod(db: Db): Promise<GoogleAuthMethod> {
  const [row] = await db
    .select({ value: clinicSettings.value })
    .from(clinicSettings)
    .where(eq(clinicSettings.key, AUTH_METHOD_KEY))
    .limit(1)
  const v = row?.value
  if (typeof v === 'string' && (v === 'oauth' || v === 'service_account')) return v
  if (v && typeof v === 'object' && 'method' in v) {
    const m = (v as { method: unknown }).method
    if (m === 'oauth' || m === 'service_account') return m
  }
  return DEFAULT_METHOD
}

export async function setActiveAuthMethod(
  db: Db,
  method: GoogleAuthMethod,
  updatedById: string
): Promise<void> {
  await db
    .insert(clinicSettings)
    .values({ key: AUTH_METHOD_KEY, value: { method }, updatedById })
    .onConflictDoUpdate({
      target: clinicSettings.key,
      set: { value: { method }, updatedById, updatedAt: new Date() },
    })
}
