/**
 * Data-Inject PII scoping — admin-v1 §22.2.
 *
 * Data Inject is a controlled ETL/publishing tool that moves *selected* data
 * from this project's DB into the **reports app's separate database**. Because
 * patient/clinical data crosses a database boundary, the admin must be able to
 * **exclude or anonymize** sensitive patient PII (name / phone / dob / email /
 * address …) before it lands in the reports DB. The reports app is read-only and
 * should only receive what it needs (DPA data-minimisation).
 *
 * This module is the single source of truth for:
 *   - which fields count as PII, per published section, and
 *   - the transform that omits or masks those fields based on the section's
 *     `piiScope` config option.
 *
 * The transform is a pure function so it can be unit-/integration-tested without
 * a DB (see admin-v1-data-inject-pii.test.ts) and reused by any future publish
 * path (push-on-toggle or scheduled sync).
 */

import type { InjectionSection } from '../db/schema/operations'

/**
 * How a section handles its PII fields when published to the reports DB.
 *  - `include` — keep PII as-is (the legacy default; full record crosses over).
 *  - `omit`    — strip the PII fields entirely (they never leave this DB).
 *  - `mask`    — replace PII values with an anonymized token, preserving shape.
 */
export const PII_SCOPE_MODES = ['include', 'omit', 'mask'] as const
export type PiiScopeMode = (typeof PII_SCOPE_MODES)[number]

export const DEFAULT_PII_SCOPE: PiiScopeMode = 'include'

export function isPiiScopeMode(v: unknown): v is PiiScopeMode {
  return typeof v === 'string' && (PII_SCOPE_MODES as readonly string[]).includes(v)
}

/**
 * Sensitive patient PII fields, per publishable section. A field listed here is
 * omitted or masked (per the section's `piiScope`) before the row is published.
 *
 * Sections not listed here carry no patient PII (overview / reports / analytics /
 * settings are aggregate/config surfaces) — scoping is a no-op for them.
 */
export const SECTION_PII_FIELDS: Partial<Record<InjectionSection, readonly string[]>> = {
  // Mirrors the direct-identifier columns on `patients` (schema/patients.ts).
  patient_records: [
    'name',
    'email',
    'phone',
    'dob',
    'address',
    'occupation',
    'profileImage',
    'guardianName',
    'guardianPhone',
    'guardianEmail',
    'guardianAddress',
    'guardianOccupation',
    'insuranceProvider',
    'insurancePolicyNumber',
    'emergencyContactName',
    'emergencyContactPhone',
    'nationality',
    'gender',
    'howDidYouHear',
    'howDidYouHearOther',
  ],
  // Clinical rows reference the patient by name/contact when denormalised.
  clinical: ['patientName', 'name', 'phone', 'email', 'dob', 'address'],
} as const

/** The fields scoped for a given section (empty when the section carries no PII). */
export function piiFieldsForSection(section: InjectionSection): readonly string[] {
  return SECTION_PII_FIELDS[section] ?? []
}

/**
 * Deterministic anonymized token for a masked field. Keeps the field present
 * (so the reports app's shape doesn't break) while removing the real value.
 * Dates collapse to `null` rather than a string so the column type still fits.
 */
function maskValue(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return null
  return '[redacted]'
}

/**
 * Credential / internal columns that must NEVER cross to the reports DB, in ANY
 * scope mode (`include` included). `pwaPasswordHash` is a PBKDF2 patient-portal
 * credential hash — it has no business in a read-only reporting database, so it
 * is stripped unconditionally rather than relying on the section PII list.
 */
const NEVER_PUBLISH = ['pwaPasswordHash'] as const

/**
 * Apply the PII-scoping transform to a single published row.
 *
 *  - Credential/internal fields ({@link NEVER_PUBLISH}) are ALWAYS stripped.
 *  - `include` → otherwise returns the row untouched.
 *  - `omit`    → drops every section PII field.
 *  - `mask`    → replaces every section PII field with an anonymized token.
 *
 * Non-PII fields are otherwise preserved verbatim.
 */
export function scopeRowPii<T extends Record<string, unknown>>(
  section: InjectionSection,
  row: T,
  mode: PiiScopeMode
): Partial<T> {
  const out: Record<string, unknown> = { ...row }
  // Always strip credential/internal fields — even in `include` mode.
  for (const field of NEVER_PUBLISH) delete out[field]

  if (mode !== 'include') {
    for (const field of piiFieldsForSection(section)) {
      if (!(field in out)) continue
      if (mode === 'omit') delete out[field]
      else out[field] = maskValue(out[field]) // mode === 'mask'
    }
  }
  return out as Partial<T>
}

/**
 * Apply {@link scopeRowPii} across a payload array. The publish path calls this
 * once on the rows it's about to push to the reports DB. Always routes through
 * scopeRowPii so {@link NEVER_PUBLISH} is enforced in every mode.
 */
export function scopePayloadPii<T extends Record<string, unknown>>(
  section: InjectionSection,
  rows: T[],
  mode: PiiScopeMode
): Partial<T>[] {
  return rows.map((r) => scopeRowPii(section, r, mode))
}

/** Read the section's chosen PII scope from its stored `config` blob. */
export function resolvePiiScope(config: unknown): PiiScopeMode {
  if (config && typeof config === 'object' && 'piiScope' in config) {
    const v = (config as { piiScope?: unknown }).piiScope
    if (isPiiScopeMode(v)) return v
  }
  return DEFAULT_PII_SCOPE
}
