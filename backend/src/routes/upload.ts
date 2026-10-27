import { Hono } from 'hono'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { getCurrentUser } from '../lib/rbac'
import { hasAnyPermission } from '../lib/route-access'
import { uploadToCategory } from '../lib/storage-router'
import type { HonoEnv } from '../lib/types'
import { authorizeUpload } from '../lib/upload-access'
import { buildExpenseKey, buildObjectKey, resolveUpload } from '../lib/upload-policy'
import { uploadProfiles, validateUpload } from '../lib/upload-validation'

const uploadApp = new Hono<HonoEnv>()

/**
 * POST /api/upload/expense
 * Uploads an expense receipt. Storage category is fixed to `system_docs`; routing is read from the
 * integrations config. Needs permission to record expenses.
 * Body: multipart/form-data { file, category, paidTo?, date }
 *   - `category` here is the *expense* category (used in the filename), not the storage category.
 *
 * The object name keeps the readable "<category>_<payee>_<day>_<month>_<year>" but ends in random
 * bits: it used to be exactly that text, so two receipts for the same category on the same day
 * replaced each other, and the category and payee went into the key unchecked.
 */
uploadApp.post('/expense', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await hasAnyPermission(c, user.id, [
      [MODULES.EXPENSES, ACTIONS.CREATE],
      [MODULES.EXPENSES, ACTIONS.UPDATE],
    ]))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    const category = formData.get('category') as string | null
    const paidTo = formData.get('paidTo') as string | null
    const dateStr = formData.get('date') as string | null

    if (!file || !category) {
      return c.json({ error: 'Missing required fields: file, category' }, 400)
    }

    const validation = await validateUpload(file, uploadProfiles.imageOrPdf)
    if (!validation.ok) {
      return c.json({ error: validation.error }, 400)
    }

    const key = buildExpenseKey({
      category,
      paidTo,
      date: dateStr ? new Date(dateStr) : new Date(),
      filename: file.name,
    })
    const result = await uploadToCategory(
      'system_docs',
      key,
      Buffer.from(validation.buffer as ArrayBuffer),
      file.type || 'application/octet-stream'
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
 *
 * `folder` / `subfolder` pick a KIND of file (lib/upload-policy.ts): the kind decides the storage
 * category, which apps and permissions may use it, and which validation profiles apply. `name` is
 * only a hint for the readable part of the object name, which the server generates in full.
 * The response carries the url at the top level and under `data` (older screens read either).
 */
uploadApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    if (!file) return c.json({ error: 'Missing file' }, 400)

    const resolved = resolveUpload({
      category: formData.get('storageCategory') as string | null,
      folder: formData.get('folder') as string | null,
      subfolder: formData.get('subfolder') as string | null,
    })
    if (!resolved.ok) return c.json({ error: resolved.error, code: resolved.code }, 400)
    const { kind, path } = resolved

    const access = await authorizeUpload(c, user, kind)
    if (!access.ok) return c.json({ error: access.error, code: 'UPLOAD_FORBIDDEN' }, 403)

    const requested = ((formData.get('profile') as string | null) ?? '').trim()
    const profileName = requested || kind.defaultProfile
    if (!(kind.profiles as readonly string[]).includes(profileName)) {
      return c.json(
        {
          error: `The "${profileName}" validation profile is not allowed for this kind of file.`,
          code: 'UPLOAD_PROFILE_NOT_ALLOWED',
        },
        400
      )
    }
    const validation = await validateUpload(
      file,
      uploadProfiles[profileName as keyof typeof uploadProfiles]
    )
    if (!validation.ok) {
      return c.json({ error: validation.error }, 400)
    }

    const key = buildObjectKey({
      kind,
      path,
      filename: file.name,
      name: formData.get('name') as string | null,
      userId: user.id,
      staffId: access.staffId,
    })
    const result = await uploadToCategory(
      kind.category,
      key,
      Buffer.from(validation.buffer as ArrayBuffer),
      file.type || 'application/octet-stream'
    )
    return c.json({ success: true, url: result.url, data: { url: result.url } })
  } catch (error: unknown) {
    logError(error, { context: '[Upload] Generic error' })
    return c.json({ success: false, error: 'Failed' }, 500)
  }
})

export { uploadApp }
