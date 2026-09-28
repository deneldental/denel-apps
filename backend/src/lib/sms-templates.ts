/**
 * Central SMS template resolution.
 *
 * Every system SMS whose body an admin can edit lives in the `reminder_templates`
 * table under a stable `key` (e.g. `patient:welcome`, `appointment:scheduled`,
 * `lab_status:sent`), editable in one place via the CRM → SMS Templates page.
 * A change there applies everywhere the message is sent.
 *
 * `resolveSmsTemplate` reads the active keyed template; when it's absent or
 * deactivated it returns the caller's `fallback` (the historical env-var/default
 * text) so behaviour is identical until an admin actually customises the copy.
 *
 * Token substitution stays at the call site convention: `renderSms` replaces
 * `{token}` occurrences with the supplied values (exact-case keys).
 */

import { and, eq } from 'drizzle-orm'
import type { getDb } from '../db'
import { reminderTemplates } from '../db/schema'

type Db = ReturnType<typeof getDb>

/**
 * Resolve a system SMS body by key from the central store, falling back to the
 * provided default when no active template exists for that key.
 */
export async function resolveSmsTemplate(db: Db, key: string, fallback: string): Promise<string> {
  try {
    const [row] = await db
      .select({ messageTemplate: reminderTemplates.messageTemplate })
      .from(reminderTemplates)
      .where(and(eq(reminderTemplates.key, key), eq(reminderTemplates.isActive, true)))
      .limit(1)
    const tpl = row?.messageTemplate?.trim()
    return tpl || fallback
  } catch {
    // Never let a template lookup break the send path — use the caller's default.
    return fallback
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Substitute `{token}` placeholders in a template with the given values.
 * Keys are matched exactly (case-sensitive) so `{Patientname}` and `{firstName}`
 * are distinct. Unknown placeholders are left as-is.
 */
export function renderSms(template: string, vars: Record<string, string | number>): string {
  let out = template
  for (const [token, value] of Object.entries(vars)) {
    // Function replacer so a `$` in a value (e.g. a document/patient name) is
    // never interpreted as a `$&`/`$1` replacement pattern.
    const str = String(value)
    out = out.replace(new RegExp(`\\{${escapeRegExp(token)}\\}`, 'g'), () => str)
  }
  return out
}
