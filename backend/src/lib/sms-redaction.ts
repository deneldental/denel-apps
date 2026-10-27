/**
 * What Denel keeps of an SMS that carries a credential.
 *
 * Login, reset and registration codes, and tokenised links, are texted to ONE
 * person. `sms_messages`, the dev console and the logs are read by many (the SMS
 * log is a messaging screen, and was readable by every signed-in staff session),
 * so the credential must not be stored there. The recipient still receives the
 * real text; only what we keep changes. See F01 in
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md.
 *
 * Pure on purpose: no database, no environment, so the SMS library, the routes
 * and the one-off purge script can all share it.
 */

/** Stored in place of a message that is entirely sensitive (one-time codes). */
export const REDACTED_SMS_BODY = '[sensitive message redacted]'

/** Stored in place of a bearer token inside an otherwise ordinary message. */
export const REDACTED_TOKEN_MARKER = '[token redacted]'

export interface StorableSms {
  message: string
  /** The whole message is a credential: keep nothing of it. */
  sensitive?: boolean
  /** Keep this text instead of `message` (the message with its token cut out). */
  storedMessage?: string
}

/** The text to keep (database row, log preview, dev console) for an outgoing message. */
export function storedSmsBody(sms: StorableSms): string {
  if (sms.sensitive) return REDACTED_SMS_BODY
  return sms.storedMessage ?? sms.message
}

/**
 * Is this stored text a redaction stand-in rather than what was really sent?
 * Resending it would text the patient a message with the secret cut out.
 */
export function isRedactedSmsContent(content: string): boolean {
  return content === REDACTED_SMS_BODY || content.includes(REDACTED_TOKEN_MARKER)
}

/**
 * Messages stored BEFORE redaction existed, recognised by the wording the
 * senders used (lib/staff-otp.ts, lib/patient-otp.ts, routes/staff-registration.ts)
 * and by the confirmation link (`/c/<uuid>`). Used only by the one-off purge
 * script; the brand prefix before the colon varies, so it is not matched.
 */
const HISTORICAL_SENSITIVE_PATTERNS: readonly RegExp[] = [
  /your (?:staff portal login|patient portal verification|password reset|staff registration) code is \d{4,8}\b/i,
  /\/c\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
]

export function looksLikeHistoricalSensitiveSms(content: string): boolean {
  return HISTORICAL_SENSITIVE_PATTERNS.some((pattern) => pattern.test(content))
}
