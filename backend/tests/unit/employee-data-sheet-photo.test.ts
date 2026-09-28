/**
 * The Employee Data Sheet is HTML that Puppeteer renders to PDF on the server,
 * outside the API edge — a private staff photo must reach it as a link that
 * loads, not as a stored reference.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    PRIVATE_FILE_REF_SECRET: 'test-file-ref-secret-at-least-32-characters',
  },
}))
vi.mock('../../src/lib/integrations', () => ({
  getR2Config: vi.fn(async () => ({
    endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
    bucket: 'denel-public',
    privateBucket: 'denel-private',
    region: 'auto',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'secretEXAMPLE',
    publicUrl: 'https://pub-test.r2.dev',
  })),
  getDoSpacesConfig: vi.fn(async () => null),
  getCloudinaryConfig: vi.fn(async () => null),
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { buildEmployeeDataSheetHtml } from '../../src/lib/employee-data-sheet'
import { makePrivateRef } from '../../src/lib/private-files'

const OPTS = { clinicName: 'Denel Dental Clinic' }

describe('Employee Data Sheet photo', () => {
  it('turns a private photo into a link the PDF renderer can load', async () => {
    const html = await buildEmployeeDataSheetHtml(
      { fullName: 'Ama Mensah', profileImage: makePrivateRef('r2', 'staff/s1/photo.jpg') },
      OPTS
    )

    expect(html).not.toContain('private-file://')
    expect(html).toContain(
      'src="https://denel-private.0123456789abcdef.r2.cloudflarestorage.com/staff/s1/photo.jpg?'
    )
  })

  it('keeps a plain photo link as it is', async () => {
    const html = await buildEmployeeDataSheetHtml(
      { fullName: 'Ama Mensah', profileImage: 'https://pub-test.r2.dev/old/photo.jpg' },
      OPTS
    )

    expect(html).toContain('src="https://pub-test.r2.dev/old/photo.jpg"')
  })
})
