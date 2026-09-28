/**
 * Patient phone display helpers — scoped to the patient add/edit sheets.
 *
 * Patient phones are stored as typed (`0200000000`), not E.164.
 * `react-phone-number-input` can only infer a country from an E.164 value, so a
 * stored local number left the country selector on `ZZ` ("International") and
 * rendered the globe icon instead of the Ghana flag. `defaultCountry="GH"` does
 * not help: it only applies when there is no value to parse, and a
 * present-but-unparseable value wins.
 *
 * These convert for DISPLAY only. The component's `value` gets E.164 so the flag
 * resolves; `onChange` runs back through `toStoredPhone` so component state — and
 * therefore the dirty check and the submitted payload — stay in the stored shape.
 * Nothing about what lands in the database changes.
 *
 * A proper normalisation (E.164 everywhere, plus a migration) is deliberately NOT
 * done here: it would cross the backend and the SMS paths. Note that patient
 * sign-in already compares `formatPhoneNumber()` on both sides
 * (`backend/src/routes/patient-auth.ts`), so it is unaffected either way.
 */

/** Ghana. Matches `DEFAULT_COUNTRY_CODE` in `backend/src/lib/constants`. */
const GH_DIALING_CODE = '233'

/**
 * Stored shape → E.164, for the input's `value`.
 *
 * Bare digits are assumed Ghanaian, which is what every existing row is; a value
 * already in `+…` form is passed through untouched so a foreign number entered
 * previously keeps its own country.
 */
export function toE164Phone(stored: string | null | undefined): string {
  const value = (stored ?? '').trim()
  if (!value) return ''
  if (value.startsWith('+')) return value

  const digits = value.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith(GH_DIALING_CODE)) return `+${digits}`
  if (digits.startsWith('0')) return `+${GH_DIALING_CODE}${digits.slice(1)}`
  return `+${GH_DIALING_CODE}${digits}`
}

/**
 * E.164 (from the component) → the stored shape.
 *
 * A Ghanaian number goes back to the local `0XXXXXXXXX` form every existing row
 * uses, so editing a patient cannot silently change the column's format. Any
 * other country keeps E.164 — the only unambiguous way to store a foreign number.
 */
export function toStoredPhone(e164: string | null | undefined): string {
  const value = (e164 ?? '').trim()
  if (!value) return ''

  const digits = value.replace(/\D/g, '')
  if (digits.startsWith(GH_DIALING_CODE)) {
    const national = digits.slice(GH_DIALING_CODE.length)
    return national ? `0${national}` : ''
  }
  return value
}
