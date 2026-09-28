// The largest request body each route accepts. One definition shared by the
// size guard in app.ts (which checks Content-Length) and the private-file layer
// (which reads bodies, so it enforces the same limit on bodies sent without one).

import { LIMITS } from './constants'

/** Routes that take file uploads, on top of everything under /api/upload. */
const UPLOAD_ROUTES = new Set([
  '/api/integrations/branding/logo',
  '/api/patient-portal/avatar',
  '/api/kiosk/xrays/upload',
])

export function bodyLimitFor(path: string): number {
  return path.startsWith('/api/upload') || UPLOAD_ROUTES.has(path)
    ? LIMITS.BODY_SIZE_UPLOAD
    : LIMITS.BODY_SIZE_GENERAL
}
