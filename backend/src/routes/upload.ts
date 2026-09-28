import { Hono } from 'hono'
import { logError } from '../lib/logger'
import { getCurrentUser } from '../lib/rbac'
import type { FileCategory } from '../lib/storage-router'
import { uploadToCategory } from '../lib/storage-router'
import type { HonoEnv } from '../lib/types'
import { type UploadProfile, uploadProfiles, validateUpload } from '../lib/upload-validation'

const uploadApp = new Hono<HonoEnv>()

const VALID_STORAGE_CATEGORIES: readonly FileCategory[] = [
  'patient_records',
  'staff',
  'system_docs',
  'misc',
] as const

function parseStorageCategory(input: string | null, fallback: FileCategory): FileCategory {
  if (!input) return fallback
  return (VALID_STORAGE_CATEGORIES as readonly string[]).includes(input)
    ? (input as FileCategory)
    : fallback
}

/**
 * Pick an upload profile based on the `profile` form field.
 * Defaults to `imageOrPdf` for backward compatibility with legacy callers.
 */
function pickProfile(profileName: string | null): UploadProfile {
  switch (profileName) {
    case 'image':
      return uploadProfiles.image
    case 'pdf':
      return uploadProfiles.pdf
    case 'csv':
      return uploadProfiles.csv
    case 'video':
      return uploadProfiles.video
    case 'audio':
      return uploadProfiles.audio
    default:
      return uploadProfiles.imageOrPdf
  }
}

function getOrdinalSuffix(day: number): string {
  if (day > 3 && day < 21) return 'th'
  switch (day % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

const MONTH_NAMES = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
]

/**
 * POST /api/upload/expense
 * Uploads an expense receipt with a structured filename. Storage category is
 * fixed to `system_docs`; routing is read from the integrations config.
 * Body: multipart/form-data { file, category, paidTo?, date }
 *   - `category` here is the *expense* category (used in the filename), not
 *     the storage category.
 */
uploadApp.post('/expense', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    const category = formData.get('category') as string
    const paidTo = formData.get('paidTo') as string | null
    const dateStr = formData.get('date') as string | null

    if (!file || !category) {
      return c.json({ error: 'Missing required fields: file, category' }, 400)
    }

    const validation = await validateUpload(file, uploadProfiles.imageOrPdf)
    if (!validation.ok) {
      return c.json({ error: validation.error }, 400)
    }

    const date = dateStr ? new Date(dateStr) : new Date()
    const year = date.getFullYear()
    const month = MONTH_NAMES[date.getMonth()]
    const day = date.getDate()

    const fileExtension = file.name.split('.').pop() || 'pdf'
    const categorySlug = category.toLowerCase().replace(/\s+/g, '_')
    const paidToSlug = paidTo ? paidTo.toLowerCase().replace(/\s+/g, '_') : ''
    const dayOrdinal = `${day}${getOrdinalSuffix(day)}`
    const monthLower = month.toLowerCase()

    let fileName = categorySlug
    if (paidToSlug) fileName += `_${paidToSlug}`
    fileName += `_${dayOrdinal}_${monthLower}_${year}.${fileExtension}`

    const key = `expenses/${year}/${month}/${fileName}`

    const result = await uploadToCategory(
      'system_docs',
      key,
      Buffer.from(validation.buffer as ArrayBuffer),
      file.type
    )

    return c.json({ success: true, url: result.url })
  } catch (error: unknown) {
    logError(error, { context: '[Upload] Expense error' })
    return c.json({ success: false, error: 'Failed' }, 500)
  }
})

/**
 * POST /api/upload
 * Generic file upload — the routing config decides which provider handles it.
 * Body: multipart/form-data { file, storageCategory?, folder?, subfolder?, name?, profile? }
 *   - `storageCategory`: one of `patient_records|staff|system_docs|misc`. Defaults to `misc`.
 *   - `folder` / `subfolder` / `name`: build the object key only; the bucket is
 *     decided by the active provider for the storage category.
 */
uploadApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    if (!file) return c.json({ error: 'Missing file' }, 400)

    const profileName = formData.get('profile') as string | null
    const profile = pickProfile(profileName)
    const validation = await validateUpload(file, profile)
    if (!validation.ok) {
      return c.json({ error: validation.error }, 400)
    }

    const storageCategory = parseStorageCategory(
      formData.get('storageCategory') as string | null,
      'misc'
    )
    const folder = (formData.get('folder') as string) || ''
    const subfolder = (formData.get('subfolder') as string) || ''
    const nameOverride = formData.get('name') as string | null

    const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
    const baseName = nameOverride
      ? `${nameOverride.toLowerCase().replace(/\s+/g, '_')}.${ext}`
      : `${Date.now()}-${file.name.replace(/\s+/g, '-')}`

    let key = ''
    if (folder) key += `${folder}/`
    if (subfolder) key += `${subfolder}/`
    key += baseName

    const result = await uploadToCategory(
      storageCategory,
      key,
      Buffer.from(validation.buffer as ArrayBuffer),
      file.type
    )
    return c.json({ success: true, url: result.url })
  } catch (error: unknown) {
    logError(error, { context: '[Upload] Generic error' })
    return c.json({ success: false, error: 'Failed' }, 500)
  }
})

export { uploadApp }
