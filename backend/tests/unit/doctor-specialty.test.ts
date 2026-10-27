/**
 * The specialty a doctor row shows (D17 / F47). Pure function; the database round trip is
 * covered by tests/integration/specialist-sync.test.ts.
 *
 * `specialists.specialty` is a foreign key to the `specialties` lookup, so in practice every value
 * has a display name. The readable-text fallback is defensive: a lookup row removed by hand must
 * not turn into a raw slug on an appointment.
 */
import { describe, expect, it } from 'vitest'
import { doctorRowSpecialty, prettifySpecialty } from '../../src/lib/doctor-specialty'

const labels = new Map([['orthodontics', 'Orthodontics & Braces']])

describe('doctorRowSpecialty', () => {
  it("uses the lookup's display name", () => {
    expect(
      doctorRowSpecialty({ specialty: 'orthodontics', specialistType: 'internal' }, labels)
    ).toBe('Orthodontics & Braces')
  })

  it('falls back to readable text when the lookup row is gone', () => {
    expect(
      doctorRowSpecialty({ specialty: 'paediatric_dentistry', specialistType: 'internal' }, labels)
    ).toBe('Paediatric Dentistry')
  })

  it.each([
    [null, 'internal', 'General'],
    ['', 'internal', 'General'],
    ['   ', 'internal', 'General'],
    [null, 'external', 'Specialist'],
    [undefined, 'external', 'Specialist'],
  ])('keeps the placeholder when there is no specialty (%j, %s)', (specialty, type, expected) => {
    expect(doctorRowSpecialty({ specialty, specialistType: type }, labels)).toBe(expected)
  })
})

describe('prettifySpecialty', () => {
  it.each([
    ['oral_surgery', 'Oral Surgery'],
    ['ENDODONTICS', 'Endodontics'],
    ['  general   dentistry ', 'General Dentistry'],
  ])('%j → %j', (input, expected) => {
    expect(prettifySpecialty(input)).toBe(expected)
  })
})
