/**
 * The largest body each route accepts — shared by the size guard and the
 * private-file layer, so both refuse at the same point.
 */
import { describe, expect, it } from 'vitest'
import { bodyLimitFor } from '../../src/lib/body-limit'
import { LIMITS } from '../../src/lib/constants'

describe('bodyLimitFor', () => {
  it.each([
    '/api/upload',
    '/api/upload/expense',
    '/api/integrations/branding/logo',
    '/api/patient-portal/avatar',
    '/api/kiosk/xrays/upload',
  ])('allows uploads on %s', (path) => {
    expect(bodyLimitFor(path)).toBe(LIMITS.BODY_SIZE_UPLOAD)
  })

  it.each([
    '/api/patients/1',
    '/api/settings/import',
    '/api/documents/templates',
  ])('keeps the general limit on %s', (path) => {
    expect(bodyLimitFor(path)).toBe(LIMITS.BODY_SIZE_GENERAL)
  })
})
