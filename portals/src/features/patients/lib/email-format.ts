/**
 * Email check for the patient add/edit sheets. Deliberately loose — something,
 * an @, a dotted domain — so it catches typos without rejecting real addresses;
 * the backend's zod `.email()` is the final word.
 */
export function isValidEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
}
