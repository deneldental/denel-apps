/**
 * What `POST /api/upload` will accept, and the object keys it makes (F22 / D9).
 *
 * The route used to take the storage category, the folder, the sub-folder and the file name from
 * the caller and build the key out of them, for any signed-in session. Now every upload names a
 * KIND of file the clinic really stores (a patient photo, a compliance document, a leave-request
 * attachment…). The kind fixes:
 *
 *   - the storage category the object goes to (so a caller cannot steer a file into another
 *     provider's bucket by naming a different category),
 *   - which apps may use it and which permission is needed (or, for the Team app, that it is the
 *     caller's own area),
 *   - which validation profiles apply, and
 *   - the shape of the path.
 *
 * The last part of the key is always generated here (a timestamp, 64 random bits and a cleaned
 * label), so a caller can neither choose an existing key to overwrite nor make one predictable.
 *
 * This file is pure (no database, no request): `lib/upload-access.ts` answers "may THIS person?",
 * and a source-scanning test (tests/unit/upload-policy-callers.test.ts) fails if an app starts
 * calling the route with a folder that no kind covers.
 */
import { randomBytes } from 'node:crypto'
import { ACTIONS, MODULES } from '@denel/rbac'
import type { FileCategory } from './storage-router'

export type UploadApp = 'portal' | 'pwa' | 'hr'
export type UploadProfileName = 'image' | 'pdf' | 'imageOrPdf' | 'video' | 'audio'

type Permission = readonly [module: string, action: string]

/** Any ONE of the permissions is enough; `self-*` kinds need no module permission at all. */
export type UploadNeed =
  | { type: 'permission'; anyOf: readonly Permission[] }
  /** The Team app: the caller's own staff area. Needs a staff record linked to the login. */
  | { type: 'self-staff' }
  /** Anyone signed in, in an area keyed by their own user id. */
  | { type: 'self-user' }

export type UploadKindId =
  | 'patient-files'
  | 'patient-xrays'
  | 'medical-record-images'
  | 'lab-case-photos'
  | 'patient-avatars'
  | 'staff-avatars'
  | 'specialist-avatars'
  | 'staff-credentials'
  | 'staff-documents'
  | 'handbook'
  | 'memos'
  | 'training'
  | 'compliance'
  | 'document-templates'
  | 'consent-templates'
  | 'inventory-receipts'
  | 'product-images'
  | 'alert-audio'
  | 'team-requests'
  | 'personal-misc'

export interface UploadKind {
  id: UploadKindId
  /** The storage category (and so the provider) objects of this kind go to. */
  category: FileCategory
  /** Shapes of the whole path (folder + sub-folder), matched case-insensitively. */
  paths: readonly RegExp[]
  /**
   * For a kind whose sub-folder is free text typed by a person (the title of a staff document):
   * the folder it lives under. The text is turned into a safe slug rather than validated.
   */
  textUnder?: RegExp
  apps: readonly UploadApp[]
  need: UploadNeed
  profiles: readonly UploadProfileName[]
  defaultProfile: UploadProfileName
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const ANY_ID = `(?:${UUID}|new)`
const SLUG = '[a-z0-9][a-z0-9_-]{0,119}'
const re = (pattern: string) => new RegExp(`^${pattern}$`, 'i')

const p = (module: string, ...actions: string[]): Permission[] =>
  actions.map((a) => [module, a] as const)

const PATIENT_WRITE = [
  ...p(MODULES.PATIENTS, ACTIONS.UPDATE, ACTIONS.CREATE),
  ...p(MODULES.MEDICAL_RECORDS, ACTIONS.CREATE, ACTIONS.UPDATE),
]
const STAFF_WRITE = p(MODULES.STAFF, ACTIONS.CREATE, ACTIONS.UPDATE)
const COMPLIANCE_WRITE = p(MODULES.COMPLIANCE, ACTIONS.CREATE, ACTIONS.UPDATE)

const FILE_PROFILES = ['imageOrPdf', 'image', 'pdf'] as const
const MEDIA_PROFILES = ['imageOrPdf', 'image', 'pdf', 'video', 'audio'] as const

/**
 * Every place the portal, HR and Team apps upload today. Order matters only for the free-text kind,
 * which is tried last. The reports app resolves to the portal and uses the same folders.
 */
export const UPLOAD_KINDS: readonly UploadKind[] = [
  // ── Patient files (clinic portal) ───────────────────────────────────────────
  {
    id: 'patient-files',
    category: 'patient_records',
    paths: [
      re(
        `patients/${UUID}(?:/(?:documents|photos|case-images|signatures(?:/(?:consent|treatment-plan))?))?`
      ),
    ],
    apps: ['portal'],
    need: { type: 'permission', anyOf: PATIENT_WRITE },
    profiles: FILE_PROFILES,
    defaultProfile: 'imageOrPdf',
  },
  {
    id: 'patient-xrays',
    category: 'patient_records',
    paths: [re(`xrays/${UUID}`)],
    apps: ['portal'],
    need: { type: 'permission', anyOf: p(MODULES.XRAYS, ACTIONS.CREATE, ACTIONS.UPDATE) },
    profiles: ['image'],
    defaultProfile: 'image',
  },
  {
    id: 'medical-record-images',
    category: 'patient_records',
    paths: [re(`treatments(?:/${SLUG})?`)],
    apps: ['portal'],
    need: {
      type: 'permission',
      anyOf: p(MODULES.MEDICAL_RECORDS, ACTIONS.CREATE, ACTIONS.UPDATE),
    },
    profiles: ['image'],
    defaultProfile: 'image',
  },
  {
    id: 'lab-case-photos',
    category: 'patient_records',
    paths: [re(`labs/${UUID}/photos`)],
    apps: ['portal'],
    need: { type: 'permission', anyOf: p(MODULES.LABS, ACTIONS.CREATE, ACTIONS.UPDATE) },
    profiles: ['image'],
    defaultProfile: 'image',
  },
  {
    id: 'patient-avatars',
    category: 'staff',
    paths: [re('avatars')],
    apps: ['portal'],
    need: { type: 'permission', anyOf: p(MODULES.PATIENTS, ACTIONS.CREATE, ACTIONS.UPDATE) },
    profiles: ['image'],
    defaultProfile: 'image',
  },
  // ── Staff (HR app and portal) ───────────────────────────────────────────────
  {
    id: 'staff-avatars',
    category: 'staff',
    paths: [re(`staff/${ANY_ID}/avatar`)],
    apps: ['portal', 'hr'],
    need: { type: 'permission', anyOf: STAFF_WRITE },
    profiles: ['image'],
    defaultProfile: 'image',
  },
  {
    id: 'specialist-avatars',
    category: 'staff',
    paths: [re(`specialists/${ANY_ID}/avatar`)],
    apps: ['portal', 'hr'],
    // The HR app edits a doctor's staff record too, which is why staff rights count here.
    need: {
      type: 'permission',
      anyOf: [...p(MODULES.SPECIALISTS, ACTIONS.CREATE, ACTIONS.UPDATE), ...STAFF_WRITE],
    },
    profiles: ['image'],
    defaultProfile: 'image',
  },
  {
    id: 'staff-credentials',
    category: 'staff',
    paths: [re(`credentials/${UUID}`)],
    apps: ['portal', 'hr'],
    need: { type: 'permission', anyOf: STAFF_WRITE },
    profiles: FILE_PROFILES,
    defaultProfile: 'imageOrPdf',
  },
  {
    id: 'handbook',
    category: 'system_docs',
    paths: [re('handbook')],
    apps: ['hr', 'portal'],
    need: { type: 'permission', anyOf: p(MODULES.STAFF, ACTIONS.UPDATE) },
    profiles: MEDIA_PROFILES,
    defaultProfile: 'imageOrPdf',
  },
  {
    id: 'memos',
    category: 'misc',
    paths: [re('memos')],
    apps: ['hr', 'portal'],
    need: { type: 'permission', anyOf: STAFF_WRITE },
    profiles: MEDIA_PROFILES,
    defaultProfile: 'imageOrPdf',
  },
  {
    id: 'training',
    category: 'staff',
    paths: [re('training')],
    apps: ['hr', 'portal'],
    need: {
      type: 'permission',
      anyOf: p(MODULES.STAFF_TRAINING, ACTIONS.CREATE, ACTIONS.UPDATE),
    },
    profiles: MEDIA_PROFILES,
    defaultProfile: 'imageOrPdf',
  },
  // ── Clinic documents (portal) ───────────────────────────────────────────────
  {
    id: 'compliance',
    category: 'system_docs',
    paths: [re('compliance(?:/renewals)?')],
    apps: ['portal'],
    need: { type: 'permission', anyOf: COMPLIANCE_WRITE },
    profiles: FILE_PROFILES,
    defaultProfile: 'imageOrPdf',
  },
  {
    id: 'document-templates',
    category: 'system_docs',
    paths: [re('document-templates')],
    apps: ['portal'],
    need: { type: 'permission', anyOf: COMPLIANCE_WRITE },
    profiles: ['pdf'],
    defaultProfile: 'pdf',
  },
  {
    id: 'consent-templates',
    category: 'system_docs',
    paths: [re('consent-templates')],
    apps: ['portal'],
    need: { type: 'permission', anyOf: COMPLIANCE_WRITE },
    profiles: ['pdf'],
    defaultProfile: 'pdf',
  },
  {
    id: 'inventory-receipts',
    category: 'system_docs',
    paths: [re('inventory/receipts')],
    apps: ['portal'],
    need: { type: 'permission', anyOf: p(MODULES.INVENTORY, ACTIONS.CREATE, ACTIONS.UPDATE) },
    profiles: FILE_PROFILES,
    defaultProfile: 'imageOrPdf',
  },
  {
    id: 'product-images',
    category: 'system_docs',
    paths: [re('(?:products|inventory)')],
    apps: ['portal'],
    need: {
      type: 'permission',
      anyOf: [
        ...p(MODULES.PRODUCTS, ACTIONS.CREATE, ACTIONS.UPDATE),
        ...p(MODULES.INVENTORY, ACTIONS.CREATE, ACTIONS.UPDATE),
        ...p(MODULES.ITEMS, ACTIONS.CREATE, ACTIONS.UPDATE),
      ],
    },
    profiles: ['image'],
    defaultProfile: 'image',
  },
  {
    id: 'alert-audio',
    category: 'system_docs',
    paths: [re('system/audio')],
    apps: ['portal'],
    need: { type: 'permission', anyOf: p(MODULES.SETTINGS, ACTIONS.UPDATE) },
    profiles: ['audio'],
    defaultProfile: 'audio',
  },
  // ── The Team app: its own area only ─────────────────────────────────────────
  {
    id: 'team-requests',
    category: 'staff',
    paths: [re('requests')],
    apps: ['pwa'],
    need: { type: 'self-staff' },
    profiles: FILE_PROFILES,
    defaultProfile: 'imageOrPdf',
  },
  {
    id: 'personal-misc',
    category: 'misc',
    paths: [re(''), re('misc')],
    apps: ['portal', 'pwa', 'hr'],
    need: { type: 'self-user' },
    profiles: FILE_PROFILES,
    defaultProfile: 'imageOrPdf',
  },
  // ── Free-text sub-folder: tried last ────────────────────────────────────────
  {
    id: 'staff-documents',
    category: 'staff',
    paths: [],
    textUnder: re('staff'),
    apps: ['portal', 'hr'],
    need: { type: 'permission', anyOf: STAFF_WRITE },
    profiles: FILE_PROFILES,
    defaultProfile: 'imageOrPdf',
  },
]

const CATEGORIES: readonly FileCategory[] = ['patient_records', 'staff', 'system_docs', 'misc']
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const MAX_SEGMENTS = 8
const MAX_PATH_LENGTH = 200

export type UploadResolveError = {
  ok: false
  code:
    | 'UPLOAD_PATH_INVALID'
    | 'UPLOAD_PATH_UNKNOWN'
    | 'UPLOAD_CATEGORY_INVALID'
    | 'UPLOAD_CATEGORY_MISMATCH'
  error: string
}
export type UploadResolved = { ok: true; kind: UploadKind; path: string }

/**
 * Segments of a clean relative path, or null when anything about it is not clean. Only slashes are
 * stripped from the ends: whitespace and control characters are not tidied up, they are refused.
 */
function cleanSegments(raw: string): string[] | null {
  const trimmed = raw.replace(/^\/+|\/+$/g, '')
  if (trimmed === '') return []
  const segments = trimmed.split('/')
  if (segments.length > MAX_SEGMENTS) return null
  for (const segment of segments) if (!SEGMENT.test(segment)) return null
  if (segments.join('/').length > MAX_PATH_LENGTH) return null
  return segments
}

/** Lower-case letters, digits, `_` and `-` only; one separator per run; never empty. */
export function slugText(text: string, fallback = 'document'): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 80)
    .replace(/[_-]+$/g, '')
  return slug || fallback
}

/** The readable part of a file name: letters and digits joined by `-`, at most 60 characters. */
function labelOf(text: string): string {
  const label = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return label || 'file'
}

/**
 * Which kind of upload is this? Pure: no permission is decided here, only what the request is
 * and whether it is shaped like something the clinic stores.
 */
export function resolveUpload(input: {
  category?: string | null
  folder?: string | null
  subfolder?: string | null
}): UploadResolved | UploadResolveError {
  const category = (input.category ?? '').trim()
  if (category && !(CATEGORIES as readonly string[]).includes(category)) {
    return {
      ok: false,
      code: 'UPLOAD_CATEGORY_INVALID',
      error: `storageCategory must be one of ${CATEGORIES.join(', ')}.`,
    }
  }

  const folder = cleanSegments(input.folder ?? '')
  if (!folder) {
    return { ok: false, code: 'UPLOAD_PATH_INVALID', error: 'The upload folder is not valid.' }
  }
  const subRaw = input.subfolder ?? ''
  const sub = cleanSegments(subRaw)

  let found: { kind: UploadKind; path: string } | null = null
  if (sub && folder.length + sub.length <= MAX_SEGMENTS) {
    const path = [...folder, ...sub].join('/')
    const kind = UPLOAD_KINDS.find((k) => k.paths.some((pattern) => pattern.test(path)))
    if (kind) found = { kind, path }
  }
  if (!found) {
    // A sub-folder a person typed (a document title): keep what is safe in it, never reject it.
    const under = folder.join('/')
    const kind = UPLOAD_KINDS.find((k) => k.textUnder?.test(under))
    if (kind) {
      const text = subRaw.trim()
      found = { kind, path: text ? `${under}/${slugText(text)}` : under }
    }
  }
  if (!found) {
    return sub
      ? {
          ok: false,
          code: 'UPLOAD_PATH_UNKNOWN',
          error: 'Files cannot be uploaded to that folder.',
        }
      : { ok: false, code: 'UPLOAD_PATH_INVALID', error: 'The upload sub-folder is not valid.' }
  }

  // "misc" is what the apps send when a screen names no category, so it says nothing; only an
  // explicit, different category contradicts the folder.
  if (category && category !== 'misc' && category !== found.kind.category) {
    return {
      ok: false,
      code: 'UPLOAD_CATEGORY_MISMATCH',
      error: `Files for "${found.path || 'misc'}" go to the ${found.kind.category} category, not ${category}.`,
    }
  }
  return { ok: true, kind: found.kind, path: found.path }
}

function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return 'bin'
  const ext = base.slice(dot + 1).toLowerCase()
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin'
}

function baseOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

const defaultRandom = () => randomBytes(8).toString('hex')

/**
 * The object key for an upload. The folder part is the validated path (or the caller's own area for
 * the self-scoped kinds); the file part is `<timestamp>-<64 random bits>-<label>.<ext>`, so the
 * caller cannot name an existing object. `name` is only a hint for the label.
 */
export function buildObjectKey(input: {
  kind: UploadKind
  path: string
  filename: string
  name?: string | null
  userId: string
  staffId?: string | null
  now?: number
  random?: () => string
}): string {
  let root = input.path
  if (input.kind.need.type === 'self-staff') {
    if (!input.staffId) throw new Error('A staff record is needed to upload to a staff area')
    root = `staff/${input.staffId}/${input.path}`
  } else if (input.kind.need.type === 'self-user') {
    root = `misc/${input.userId.replace(/[^A-Za-z0-9_-]/g, '_')}`
  }
  const hint = input.name?.trim() ? input.name : baseOf(input.filename)
  const file = `${input.now ?? Date.now()}-${(input.random ?? defaultRandom)()}-${labelOf(hint)}.${extensionOf(input.filename)}`
  return root ? `${root}/${file}` : file
}

// ── Expense receipts ──────────────────────────────────────────────────────────

function ordinalSuffix(day: number): string {
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
 * `expenses/<year>/<MONTH>/<category>_<payee>_<day>_<month>_<year>-<random>.<ext>`. The readable name
 * is kept; the random part makes two receipts for the same category on the same day two objects.
 * The category and the payee are cleaned, so they cannot add path segments.
 */
export function buildExpenseKey(input: {
  category: string
  paidTo?: string | null
  date?: Date | null
  filename: string
  random?: () => string
}): string {
  const raw = input.date ?? new Date()
  const date = Number.isNaN(raw.getTime()) ? new Date() : raw
  const year = date.getFullYear()
  const month = MONTH_NAMES[date.getMonth()]
  const day = date.getDate()

  let name = slugText(input.category, 'expense')
  const payee = input.paidTo?.trim() ? slugText(input.paidTo, '') : ''
  if (payee) name += `_${payee}`
  name += `_${day}${ordinalSuffix(day)}_${month.toLowerCase()}_${year}`
  return `expenses/${year}/${month}/${name}-${(input.random ?? defaultRandom)()}.${extensionOf(input.filename)}`
}
