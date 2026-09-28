/**
 * Canonical storage path structure for all file uploads.
 *
 * Bucket: clinic (single bucket per deployment)
 *
 * Top-level folders:
 *
 *   System/
 *     Products/          — product images
 *     Inventory/         — inventory item images
 *     Training/          — training material files
 *     Compliance/        — compliance documents
 *     ConsentTemplates/  — consent form templates
 *
 *   Staff/[id]/          — all files belonging to a staff member
 *
 *   Patients/[id]/       — all files belonging to a patient
 *     documents/         — uploaded documents (PDF, images, etc.)
 *     photos/            — clinical photos
 *     xrays/             — x-ray images
 *
 * This structure ensures:
 * - Predictable paths for data import/export
 * - Easy per-entity access control at the bucket level
 * - Consistent folder naming across R2, S3, and DO Spaces backends
 */

export const StoragePaths = {
  // ── System assets ────────────────────────────────────────────────────────
  system: {
    products: (filename: string) => `System/Products/${filename}`,
    inventory: (filename: string) => `System/Inventory/${filename}`,
    training: (filename: string) => `System/Training/${filename}`,
    compliance: (filename: string) => `System/Compliance/${filename}`,
    consentTemplates: (filename: string) => `System/ConsentTemplates/${filename}`,
    branding: (filename: string) => `System/Branding/${filename}`,
  },

  // ── Staff files ──────────────────────────────────────────────────────────
  staff: {
    root: (staffId: string) => `Staff/${staffId}`,
    file: (staffId: string, filename: string) => `Staff/${staffId}/${filename}`,
    credentials: (staffId: string, filename: string) => `Staff/${staffId}/credentials/${filename}`,
    avatar: (staffId: string, filename: string) => `Staff/${staffId}/avatar/${filename}`,
  },

  // ── Patient files ────────────────────────────────────────────────────────
  patients: {
    root: (patientId: string) => `Patients/${patientId}`,
    document: (patientId: string, filename: string) =>
      `Patients/${patientId}/documents/${filename}`,
    photo: (patientId: string, filename: string) => `Patients/${patientId}/photos/${filename}`,
    xray: (patientId: string, filename: string) => `Patients/${patientId}/xrays/${filename}`,
    statement: (patientId: string, filename: string) =>
      `Patients/${patientId}/statements/${filename}`,
  },
} as const

/**
 * Resolve upload folder + subfolder for the `uploadFile` action
 * from a StoragePaths path string.
 *
 * Example:
 *   resolveUploadPath(StoragePaths.patients.document('abc123', ''))
 *   → { folder: 'Patients', subfolder: 'abc123/documents' }
 */
export function resolveUploadPath(fullPath: string): { folder: string; subfolder: string } {
  const parts = fullPath.replace(/\/$/, '').split('/')
  return {
    folder: parts[0] ?? '',
    subfolder: parts.slice(1).join('/'),
  }
}
