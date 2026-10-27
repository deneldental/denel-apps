/**
 * F22 / D9 — what a caller may ask the upload route to do, and the keys it gets.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.12).
 *
 * `POST /api/upload` used to take the storage category, the folder, the sub-folder and
 * the file name from the caller and build the object key out of them, for any signed-in
 * session. That meant a Team-app user could write into patient-record storage, anyone
 * could put an object where another one lived (a plain PutObject overwrites), and a
 * folder such as `../x` was passed through.
 *
 * Now every upload names a KIND of file the clinic really stores (a patient photo, a
 * compliance document, a leave-request attachment…). The kind decides the category, the
 * apps and permissions that may use it, the validation profiles and the shape of the
 * path; the file name is generated here. These tests pin the pure part: every call the
 * apps make today resolves to its kind, nothing else does, and the keys cannot be chosen.
 */
import { describe, expect, it } from 'vitest'
import {
  buildExpenseKey,
  buildObjectKey,
  resolveUpload,
  UPLOAD_KINDS,
  type UploadKind,
  type UploadKindId,
} from '../../src/lib/upload-policy'

const ID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

type Call = {
  who: string
  category?: string
  folder?: string
  subfolder?: string
  kind: UploadKindId
}

/** One entry per place the portal, HR and Team apps call the upload route today. */
const REAL_CALLS: Call[] = [
  // portal
  { who: 'compliance document', category: 'system_docs', folder: 'compliance', kind: 'compliance' },
  {
    who: 'compliance renewal',
    category: 'system_docs',
    folder: 'compliance/renewals',
    kind: 'compliance',
  },
  {
    who: 'document template',
    category: 'system_docs',
    folder: 'document-templates',
    kind: 'document-templates',
  },
  {
    who: 'consent template',
    category: 'system_docs',
    folder: 'consent-templates',
    kind: 'consent-templates',
  },
  {
    who: 'stock receipt',
    category: 'system_docs',
    folder: 'inventory/receipts',
    kind: 'inventory-receipts',
  },
  { who: 'product image', category: 'system_docs', folder: 'products', kind: 'product-images' },
  { who: 'inventory image', category: 'system_docs', folder: 'inventory', kind: 'product-images' },
  {
    who: 'alert sound',
    category: 'system_docs',
    folder: 'System',
    subfolder: 'audio',
    kind: 'alert-audio',
  },
  {
    who: 'patient document',
    category: 'patient_records',
    folder: 'patients',
    subfolder: `${ID}/documents`,
    kind: 'patient-files',
  },
  {
    who: 'patient photo (category omitted by the screen)',
    folder: 'patients',
    subfolder: `${ID}/photos`,
    kind: 'patient-files',
  },
  {
    who: 'case image',
    category: 'patient_records',
    folder: 'Patients',
    subfolder: `${ID}/case-images`,
    kind: 'patient-files',
  },
  {
    who: 'consent signature',
    category: 'patient_records',
    folder: 'Patients',
    subfolder: `${ID}/signatures/consent`,
    kind: 'patient-files',
  },
  {
    who: 'treatment-plan signature',
    category: 'patient_records',
    folder: 'Patients',
    subfolder: `${ID}/signatures/treatment-plan`,
    kind: 'patient-files',
  },
  {
    who: 'patient folder only (round-trip fixture)',
    category: 'patient_records',
    folder: `patients/${ID}`,
    kind: 'patient-files',
  },
  {
    who: 'x-ray',
    category: 'patient_records',
    folder: 'xrays',
    subfolder: ID,
    kind: 'patient-xrays',
  },
  { who: 'x-ray (category omitted)', folder: 'xrays', subfolder: ID, kind: 'patient-xrays' },
  {
    who: 'medical-record image',
    category: 'patient_records',
    folder: 'treatments',
    subfolder: 'ama_mensah_26oct2026',
    kind: 'medical-record-images',
  },
  {
    who: 'lab case photo (category omitted)',
    folder: 'labs',
    subfolder: `${ID}/photos`,
    kind: 'lab-case-photos',
  },
  { who: 'patient avatar', category: 'staff', folder: 'avatars', kind: 'patient-avatars' },
  {
    who: 'staff avatar',
    category: 'staff',
    folder: 'Staff',
    subfolder: `${ID}/avatar`,
    kind: 'staff-avatars',
  },
  {
    who: 'staff avatar while creating',
    category: 'staff',
    folder: 'Staff',
    subfolder: 'new/avatar',
    kind: 'staff-avatars',
  },
  {
    who: 'specialist avatar',
    category: 'staff',
    folder: 'Specialists',
    subfolder: `${ID}/avatar`,
    kind: 'specialist-avatars',
  },
  {
    who: 'staff credential (category omitted)',
    folder: 'credentials',
    subfolder: ID,
    kind: 'staff-credentials',
  },
  // HR
  {
    who: 'HR staff document',
    category: 'staff',
    folder: 'staff',
    subfolder: 'employee_contract',
    kind: 'staff-documents',
  },
  { who: 'handbook media', category: 'system_docs', folder: 'handbook', kind: 'handbook' },
  { who: 'memo media', category: 'misc', folder: 'memos', kind: 'memos' },
  { who: 'training media', category: 'staff', folder: 'training', kind: 'training' },
  // Team app
  { who: 'request attachment', category: 'staff', folder: 'requests', kind: 'team-requests' },
  // the default a caller gets by sending nothing
  { who: 'nothing at all', kind: 'personal-misc' },
  { who: 'misc, no folder', category: 'misc', kind: 'personal-misc' },
]

describe('resolveUpload — what the apps send today', () => {
  it.each(REAL_CALLS)('$who → $kind', (call) => {
    const r = resolveUpload({
      category: call.category ?? null,
      folder: call.folder ?? null,
      subfolder: call.subfolder ?? null,
    })
    expect(r.ok, JSON.stringify(r)).toBe(true)
    if (r.ok) expect(r.kind.id).toBe(call.kind)
  })

  it('knows a kind for every row of the table, and nothing is unreachable', () => {
    const reached = new Set(REAL_CALLS.map((c) => c.kind))
    for (const kind of UPLOAD_KINDS) expect(reached.has(kind.id), kind.id).toBe(true)
  })

  it('is case-insensitive about the folder but keeps the caller’s spelling in the path', () => {
    const r = resolveUpload({
      category: 'patient_records',
      folder: 'PATIENTS',
      subfolder: `${ID}/photos`,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.path).toBe(`PATIENTS/${ID}/photos`)
  })

  it('turns the free-text title of an HR staff document into a safe sub-folder', () => {
    const r = resolveUpload({
      category: 'staff',
      folder: 'staff',
      subfolder: 'employment_contract_(2024) / signed!',
    })
    expect(r.ok, JSON.stringify(r)).toBe(true)
    if (r.ok) {
      expect(r.kind.id).toBe('staff-documents')
      expect(r.path).toBe('staff/employment_contract_2024_signed')
    }
  })

  it('does not let the free-text sub-folder of a staff document reach a staff avatar or an id folder by accident', () => {
    const avatar = resolveUpload({ category: 'staff', folder: 'Staff', subfolder: `${ID}/avatar` })
    expect(avatar.ok && avatar.kind.id).toBe('staff-avatars')
  })

  it('ignores stray slashes around the folder', () => {
    const r = resolveUpload({ category: 'staff', folder: '/training/', subfolder: '' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.path).toBe('training')
  })
})

describe('resolveUpload — what is refused', () => {
  const refused = (folder?: string, subfolder?: string, category?: string) =>
    resolveUpload({
      category: category ?? null,
      folder: folder ?? null,
      subfolder: subfolder ?? null,
    })

  it.each([
    ['a parent segment', '../patients', ''],
    ['a parent segment in the sub-folder', 'patients', `${ID}/../${ID}/photos`],
    ['a current-directory segment', 'patients/./x', ''],
    ['an empty middle segment', 'patients//x', ''],
    ['a backslash', 'patients\\x', ''],
    ['a percent-encoded dot', '%2e%2e/x', ''],
    ['a NUL byte', 'patients\u0000', ''],
    ['a control character', 'patients\n', ''],
    ['a space', 'my folder', ''],
    ['a query string', 'patients?x=1', ''],
    ['a hidden segment', '.hidden', ''],
    ['too many segments', 'a/b/c/d/e/f/g/h/i', ''],
    ['an over-long path', 'a'.repeat(300), ''],
  ])('refuses %s', (_label, folder, subfolder) => {
    const r = refused(folder, subfolder)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('UPLOAD_PATH_INVALID')
  })

  it.each([
    ['an unknown folder', 'secrets', ''],
    ['a patient folder without a patient id', 'patients', 'documents'],
    ['a patient folder with a made-up id', 'patients', 'not-a-uuid/documents'],
    ['a patient folder with an unknown leaf', 'patients', `${ID}/anything-i-like`],
    ['the bucket root with a name', 'avatars', 'sub/dir'],
    ['a specialist avatar for something that is not an id', 'Specialists', 'someone/avatar'],
  ])('does not know %s', (_label, folder, subfolder) => {
    const r = refused(folder, subfolder)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('UPLOAD_PATH_UNKNOWN')
  })

  it('refuses a category that contradicts the kind', () => {
    const r = refused('requests', '', 'patient_records')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('UPLOAD_CATEGORY_MISMATCH')
    const r2 = refused('patients', `${ID}/photos`, 'system_docs')
    expect(r2.ok).toBe(false)
  })

  it('refuses a category that is not one of the four', () => {
    const r = refused('requests', '', 'nonsense')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('UPLOAD_CATEGORY_INVALID')
  })

  it('treats "misc" as "not said": the portal sends it when a screen names no category', () => {
    expect(refused('compliance', '', 'misc').ok).toBe(true)
    expect(refused('requests', '', 'misc').ok).toBe(true)
  })
})

describe('buildObjectKey — the caller cannot choose the key', () => {
  const kindOf = (folder: string, subfolder = '', category?: string) => {
    const r = resolveUpload({ category: category ?? null, folder, subfolder })
    if (!r.ok) throw new Error(JSON.stringify(r))
    return r
  }

  it('keeps the path and generates the file name', () => {
    const { kind, path } = kindOf('patients', `${ID}/photos`)
    const key = buildObjectKey({
      kind,
      path,
      filename: 'My Photo.PNG',
      userId: 'u1',
      now: 1_700_000_000_000,
      random: () => 'abcd1234abcd1234',
    })
    expect(key).toBe(`patients/${ID}/photos/1700000000000-abcd1234abcd1234-my-photo.png`)
  })

  it('never produces the same key twice for the same request', () => {
    const { kind, path } = kindOf('compliance')
    const keys = new Set(
      Array.from({ length: 200 }, () =>
        buildObjectKey({ kind, path, filename: 'licence.pdf', name: 'licence', userId: 'u1' })
      )
    )
    expect(keys.size).toBe(200)
  })

  it('treats the `name` field as a hint, not a name: it cannot make the key predictable', () => {
    const { kind, path } = kindOf('avatars', '', 'staff')
    const a = buildObjectKey({ kind, path, filename: 'x.jpg', name: 'Ama Mensah 1', userId: 'u1' })
    const b = buildObjectKey({ kind, path, filename: 'x.jpg', name: 'Ama Mensah 1', userId: 'u1' })
    expect(a).not.toBe(b)
    expect(a).toMatch(/^avatars\/\d+-[0-9a-f]{16}-ama-mensah-1\.jpg$/)
  })

  it.each([
    ['../../etc/passwd', 'etc-passwd'],
    ['a/b\\c', 'a-b-c'],
    ['  spaced   out  ', 'spaced-out'],
    ['UPPER_case.file', 'upper-case-file'],
    [`${String.fromCharCode(0, 0x202e)} evil`, 'evil'], // a NUL byte and a bidi override
    ['', 'x'], // no hint: the uploaded file's own name is used
    ['....', 'file'],
  ])('cleans the name hint %j', (hint, slug) => {
    const { kind, path } = kindOf('memos', '', 'misc')
    const key = buildObjectKey({ kind, path, filename: 'x.png', name: hint, userId: 'u1' })
    expect(key).toMatch(new RegExp(`^memos/\\d+-[0-9a-f]{16}-${slug}\\.png$`))
    expect(key).not.toContain('..')
  })

  it('limits a very long name hint', () => {
    const { kind, path } = kindOf('memos', '', 'misc')
    const key = buildObjectKey({
      kind,
      path,
      filename: 'x.png',
      name: 'a'.repeat(500),
      userId: 'u1',
    })
    expect(key.length).toBeLessThan(120)
  })

  it('takes the extension from the validated file name, lower-cased and cleaned', () => {
    const { kind, path } = kindOf('compliance')
    expect(buildObjectKey({ kind, path, filename: 'scan.PDF', userId: 'u1' })).toMatch(/\.pdf$/)
    expect(buildObjectKey({ kind, path, filename: 'noextension', userId: 'u1' })).toMatch(/\.bin$/)
    expect(buildObjectKey({ kind, path, filename: 'weird.p/d/f', userId: 'u1' })).toMatch(/\.bin$/)
  })

  it.each([
    ['photo.jpeg', 'jpeg'],
    ['PHOTO.JpEg', 'jpeg'],
    ['archive.tar.gz', 'gz'],
    ['a.ninechars', 'bin'], // nine characters: longer than any real extension
    ['a.p$f', 'bin'],
    ['a.pd f', 'bin'],
    ['a.', 'bin'],
    ['.env', 'bin'],
    ['a.<b>', 'bin'],
    ['a.é', 'bin'],
  ])('reads the extension of %j as %j and nothing else', (filename, ext) => {
    const { kind, path } = kindOf('compliance')
    const key = buildObjectKey({ kind, path, filename, userId: 'u1' })
    expect(key.endsWith(`.${ext}`)).toBe(true)
    expect(key.split('/').pop()).toMatch(/^\d+-[0-9a-f]{16}-[a-z0-9-]+\.[a-z0-9]{1,8}$/)
  })

  it('puts a Team-app attachment under the caller’s own staff id, whatever the folder said', () => {
    const { kind, path } = kindOf('requests', '', 'staff')
    const key = buildObjectKey({ kind, path, filename: 'note.pdf', userId: 'u1', staffId: ID })
    expect(key.startsWith(`staff/${ID}/requests/`)).toBe(true)
  })

  it('refuses to build a staff-scoped key without a staff id', () => {
    const { kind, path } = kindOf('requests', '', 'staff')
    expect(() => buildObjectKey({ kind, path, filename: 'note.pdf', userId: 'u1' })).toThrow(
      /staff/i
    )
  })

  it('puts everyone’s personal "misc" files under their own user id', () => {
    const { kind, path } = kindOf('', '', 'misc')
    const key = buildObjectKey({ kind, path, filename: 'a.png', userId: 'user-42' })
    expect(key.startsWith('misc/user-42/')).toBe(true)
  })

  it('cleans the user id before it becomes a folder name', () => {
    const { kind, path } = kindOf('', '', 'misc')
    const key = buildObjectKey({ kind, path, filename: 'a.png', userId: '../../x/y z' })
    expect(key.startsWith('misc/')).toBe(true)
    expect(key.split('/')).toHaveLength(3) // misc / <user folder> / <file>
    expect(key).not.toContain('..')
  })
})

describe('buildExpenseKey — the receipt name stays readable, the folder and the file are the server’s', () => {
  const base = { filename: 'Receipt.PDF', random: () => 'abcd1234abcd1234' }

  it('keeps the readable name and adds random bits', () => {
    const key = buildExpenseKey({
      ...base,
      category: 'Utilities',
      paidTo: 'ECG Ghana',
      date: new Date(2026, 9, 26),
    })
    expect(key).toBe(
      'expenses/2026/OCTOBER/utilities_ecg_ghana_26th_october_2026-abcd1234abcd1234.pdf'
    )
  })

  it('leaves the payee out when there is none', () => {
    const key = buildExpenseKey({
      ...base,
      category: 'Rent',
      paidTo: '  ',
      date: new Date(2026, 4, 5),
    })
    expect(key).toBe('expenses/2026/MAY/rent_5th_may_2026-abcd1234abcd1234.pdf')
  })

  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [30, '30th'],
    [31, '31st'],
  ])('writes day %i as %s', (day, written) => {
    const key = buildExpenseKey({ ...base, category: 'x', date: new Date(2026, 0, day) })
    expect(key).toContain(`_${written}_january_2026-`)
  })

  it('makes two receipts for the same category on the same day two objects', () => {
    const input = { category: 'Rent', date: new Date(2026, 4, 5), filename: 'a.pdf' }
    expect(buildExpenseKey(input)).not.toBe(buildExpenseKey(input))
  })

  it('turns a category or payee that tries to be a path into a harmless label', () => {
    const key = buildExpenseKey({
      ...base,
      category: '../../etc/passwd',
      paidTo: 'a/b\\c',
      date: new Date(2026, 4, 5),
    })
    expect(key.split('/')).toHaveLength(4) // expenses / year / MONTH / file
    expect(key).not.toContain('..')
    expect(key).toContain('/etc_passwd_a_b_c_5th_may_2026-')
  })

  it('falls back to "expense" for a category with nothing usable in it', () => {
    const key = buildExpenseKey({ ...base, category: '///', date: new Date(2026, 4, 5) })
    expect(key).toContain('/expense_5th_may_2026-')
  })

  it('means today for a missing or invalid date, never "NaN"', () => {
    const year = new Date().getFullYear()
    for (const date of [new Date('not a date'), null, undefined]) {
      const key = buildExpenseKey({ ...base, category: 'Rent', date })
      expect(key).toMatch(
        new RegExp(`^expenses/${year}/[A-Z]+/rent_\\d+(?:st|nd|rd|th)_[a-z]+_${year}-`)
      )
      expect(key).not.toMatch(/NaN|undefined/)
    }
  })

  it('cleans the extension like any other upload', () => {
    const key = buildExpenseKey({ ...base, category: 'x', filename: 'receipt.p$f' })
    expect(key.endsWith('.bin')).toBe(true)
  })
})

describe('the table itself', () => {
  it('lets the Team app reach only its own areas', () => {
    const teamKinds = UPLOAD_KINDS.filter((k) => k.apps.includes('pwa')).map((k) => k.id)
    expect(teamKinds.sort()).toEqual(['personal-misc', 'team-requests'])
  })

  it('never allows the csv profile, and never a profile a kind did not list', () => {
    for (const kind of UPLOAD_KINDS) {
      expect(kind.profiles as readonly string[]).not.toContain('csv')
      expect(kind.profiles).toContain(kind.defaultProfile)
    }
  })

  it('pins what every kind is: its storage category, apps, who may use it and which file checks apply', () => {
    // Written out in full on purpose: widening a kind (another app, a weaker permission, a
    // bigger set of file types, another bucket) must show up as a reviewed change to this table.
    const FILE = ['image', 'imageOrPdf', 'pdf']
    const MEDIA = ['audio', 'image', 'imageOrPdf', 'pdf', 'video']
    const write = (module: string) => [`${module}:create`, `${module}:update`]
    const PATIENT = [...write('patients'), ...write('medical_records')]
    type Want = {
      category: string
      apps: string[]
      need: string[]
      profiles: string[]
      defaultProfile: string
    }
    const expected: Record<UploadKindId, Want> = {
      'patient-files': {
        category: 'patient_records',
        apps: ['portal'],
        need: PATIENT,
        profiles: FILE,
        defaultProfile: 'imageOrPdf',
      },
      'patient-xrays': {
        category: 'patient_records',
        apps: ['portal'],
        need: write('xrays'),
        profiles: ['image'],
        defaultProfile: 'image',
      },
      'medical-record-images': {
        category: 'patient_records',
        apps: ['portal'],
        need: write('medical_records'),
        profiles: ['image'],
        defaultProfile: 'image',
      },
      'lab-case-photos': {
        category: 'patient_records',
        apps: ['portal'],
        need: write('labs'),
        profiles: ['image'],
        defaultProfile: 'image',
      },
      'patient-avatars': {
        category: 'staff',
        apps: ['portal'],
        need: write('patients'),
        profiles: ['image'],
        defaultProfile: 'image',
      },
      'staff-avatars': {
        category: 'staff',
        apps: ['hr', 'portal'],
        need: write('staff'),
        profiles: ['image'],
        defaultProfile: 'image',
      },
      'specialist-avatars': {
        category: 'staff',
        apps: ['hr', 'portal'],
        need: [...write('specialists'), ...write('staff')],
        profiles: ['image'],
        defaultProfile: 'image',
      },
      'staff-credentials': {
        category: 'staff',
        apps: ['hr', 'portal'],
        need: write('staff'),
        profiles: FILE,
        defaultProfile: 'imageOrPdf',
      },
      handbook: {
        category: 'system_docs',
        apps: ['hr', 'portal'],
        need: ['staff:update'],
        profiles: MEDIA,
        defaultProfile: 'imageOrPdf',
      },
      memos: {
        category: 'misc',
        apps: ['hr', 'portal'],
        need: write('staff'),
        profiles: MEDIA,
        defaultProfile: 'imageOrPdf',
      },
      training: {
        category: 'staff',
        apps: ['hr', 'portal'],
        need: write('staff_training'),
        profiles: MEDIA,
        defaultProfile: 'imageOrPdf',
      },
      compliance: {
        category: 'system_docs',
        apps: ['portal'],
        need: write('compliance'),
        profiles: FILE,
        defaultProfile: 'imageOrPdf',
      },
      'document-templates': {
        category: 'system_docs',
        apps: ['portal'],
        need: write('compliance'),
        profiles: ['pdf'],
        defaultProfile: 'pdf',
      },
      'consent-templates': {
        category: 'system_docs',
        apps: ['portal'],
        need: write('compliance'),
        profiles: ['pdf'],
        defaultProfile: 'pdf',
      },
      'inventory-receipts': {
        category: 'system_docs',
        apps: ['portal'],
        need: write('inventory'),
        profiles: FILE,
        defaultProfile: 'imageOrPdf',
      },
      'product-images': {
        category: 'system_docs',
        apps: ['portal'],
        need: [...write('products'), ...write('inventory'), ...write('items')],
        profiles: ['image'],
        defaultProfile: 'image',
      },
      'alert-audio': {
        category: 'system_docs',
        apps: ['portal'],
        need: ['settings:update'],
        profiles: ['audio'],
        defaultProfile: 'audio',
      },
      'team-requests': {
        category: 'staff',
        apps: ['pwa'],
        need: ['self-staff'],
        profiles: FILE,
        defaultProfile: 'imageOrPdf',
      },
      'personal-misc': {
        category: 'misc',
        apps: ['hr', 'portal', 'pwa'],
        need: ['self-user'],
        profiles: FILE,
        defaultProfile: 'imageOrPdf',
      },
      'staff-documents': {
        category: 'staff',
        apps: ['hr', 'portal'],
        need: write('staff'),
        profiles: FILE,
        defaultProfile: 'imageOrPdf',
      },
    }
    const needOf = (k: UploadKind) =>
      k.need.type === 'permission' ? k.need.anyOf.map(([m, a]) => `${m}:${a}`) : [k.need.type]

    expect(UPLOAD_KINDS.map((k) => k.id).sort()).toEqual(Object.keys(expected).sort())
    for (const kind of UPLOAD_KINDS) {
      const want = expected[kind.id]
      expect(
        {
          category: kind.category,
          apps: [...kind.apps].sort(),
          need: needOf(kind).sort(),
          profiles: [...kind.profiles].sort(),
          defaultProfile: kind.defaultProfile,
        },
        kind.id
      ).toEqual({
        ...want,
        apps: [...want.apps].sort(),
        need: [...want.need].sort(),
        profiles: [...want.profiles].sort(),
      })
    }
  })

  it('gives every kind that is not self-scoped at least one permission', () => {
    for (const kind of UPLOAD_KINDS) {
      if (kind.need.type === 'permission') expect(kind.need.anyOf.length).toBeGreaterThan(0)
    }
  })
})
