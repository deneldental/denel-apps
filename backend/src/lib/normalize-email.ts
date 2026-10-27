/**
 * The one form an e-mail address is stored and compared in.
 *
 * Better Auth looks an account up by `email = lower(input)` — at sign-in and when it
 * sends a password reset — so an address stored with capitals can never match and the
 * login it belongs to never works (F21). It also makes "Henry@…" and "henry@…" two
 * rows to the unique index but one person to everything else.
 *
 * Every path that WRITES `user.email` (or a copy of it) must store this form, and
 * every path that LOOKS an address up must compare `lower(column)` against it.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}
