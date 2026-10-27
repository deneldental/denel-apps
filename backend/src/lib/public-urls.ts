/**
 * The addresses people are sent to by a link (F13).
 *
 * Two apps are involved, and they are not interchangeable:
 *
 *   - the clinic PORTAL serves the token pages (`/c/:token` appointment confirmation,
 *     `/xray-share/:token`, document signing), receives people back from Google's consent screen and
 *     renders the analytics print view;
 *   - the PATIENT app is where a patient is told to sign in.
 *
 * Every route that built such a link used to read `PORTAL_URL` / `PATIENT_PORTAL_URL` for itself and
 * carry its own fallback. Two of them defaulted `PORTAL_URL` to the patient app's host, so a patient
 * or a referring doctor followed a link to a page that app does not have; four fell back to
 * `http://localhost:5173`, an address nobody else can open (the PDF export would have aimed the
 * server's own browser at itself). Nothing stopped a deploy from starting without either variable.
 *
 * Now `config/env.ts` refuses to start a staging or production backend without both, and this module
 * is the only code that reads them. On a developer machine, and only there, an unset variable means
 * the local dev server; anywhere else it is an error rather than a guess. A source-scanning test
 * (tests/unit/no-hardcoded-public-urls.test.ts) fails if a route goes back to its own fallback.
 */
import { isDevEnvironment } from '../config/env'

const DEV_PORTAL_URL = 'http://localhost:5173'
const DEV_PATIENT_APP_URL = 'http://localhost:5177'

/** Read when asked, not when the file loads, so a changed environment is honoured. */
function address(name: 'PORTAL_URL' | 'PATIENT_PORTAL_URL', devDefault: string): string {
  const configured = (process.env[name] ?? '').trim().replace(/\/+$/, '')
  if (configured) return configured
  if (isDevEnvironment()) return devDefault
  throw new Error(`${name} is not set`)
}

/** The clinic portal, without a trailing slash. */
export function portalUrl(): string {
  return address('PORTAL_URL', DEV_PORTAL_URL)
}

/** The patient app, without a trailing slash. */
export function patientAppUrl(): string {
  return address('PATIENT_PORTAL_URL', DEV_PATIENT_APP_URL)
}

/** A page of the portal, e.g. a confirmation link: portalLink('/c/' + token). */
export function portalLink(path: string): string {
  return `${portalUrl()}${path.startsWith('/') ? path : `/${path}`}`
}
