import { describe, expect, it } from 'vitest'
import { createPatientSchema, updatePatientSchema } from '../../src/lib/validation/patients'

const validAdultBase = {
  name: 'Kwame Mensah',
  dob: new Date('1990-01-15'),
  gender: 'male' as const,
  phone: '0241234567',
  address: '12 Main Street, Accra',
  occupation: 'Engineer',
  isChild: false,
}

const validChildBase = {
  name: 'Ama Mensah',
  dob: new Date('2015-06-10'),
  gender: 'female' as const,
  isChild: true,
  guardianName: 'Kwame Mensah',
  guardianPhone: '0241234567',
  guardianAddress: '12 Main Street, Accra',
  guardianOccupation: 'Engineer',
}

describe('Patient Validation', () => {
  describe('createPatientSchema - adult patient', () => {
    it('should accept a valid adult patient', () => {
      const result = createPatientSchema.safeParse(validAdultBase)
      expect(result.success).toBe(true)
    })

    it('should reject when name is empty', () => {
      const result = createPatientSchema.safeParse({ ...validAdultBase, name: '' })
      expect(result.success).toBe(false)
    })

    it('should reject invalid email format', () => {
      const result = createPatientSchema.safeParse({
        ...validAdultBase,
        email: 'not-an-email',
      })
      expect(result.success).toBe(false)
    })

    it('should accept empty string for optional email', () => {
      const result = createPatientSchema.safeParse({ ...validAdultBase, email: '' })
      expect(result.success).toBe(true)
    })

    it('should accept valid email', () => {
      const result = createPatientSchema.safeParse({
        ...validAdultBase,
        email: 'kwame@example.com',
      })
      expect(result.success).toBe(true)
    })

    it('should reject invalid gender value', () => {
      const result = createPatientSchema.safeParse({
        ...validAdultBase,
        gender: 'unknown',
      })
      expect(result.success).toBe(false)
    })

    it('should accept all valid gender values', () => {
      for (const gender of ['male', 'female', 'other'] as const) {
        const result = createPatientSchema.safeParse({ ...validAdultBase, gender })
        expect(result.success).toBe(true)
      }
    })

    it('should reject adult patient missing address', () => {
      const { address, ...rest } = validAdultBase
      const result = createPatientSchema.safeParse(rest)
      expect(result.success).toBe(false)
    })

    it('should reject adult patient missing occupation', () => {
      const { occupation, ...rest } = validAdultBase
      const result = createPatientSchema.safeParse(rest)
      expect(result.success).toBe(false)
    })

    it('should reject adult patient missing phone', () => {
      const { phone, ...rest } = validAdultBase
      const result = createPatientSchema.safeParse(rest)
      expect(result.success).toBe(false)
    })

    it('should accept an optional tagIds array (§2.7 — replaces type/isOrtho)', () => {
      const result = createPatientSchema.safeParse({
        ...validAdultBase,
        tagIds: ['11111111-1111-1111-1111-111111111111'],
      })
      expect(result.success).toBe(true)
    })

    it('should accept a patient with no tags', () => {
      const result = createPatientSchema.safeParse(validAdultBase)
      expect(result.success).toBe(true)
    })
  })

  describe('createPatientSchema - child patient', () => {
    it('should accept a valid child patient with guardian info', () => {
      const result = createPatientSchema.safeParse(validChildBase)
      expect(result.success).toBe(true)
    })

    it('should reject child patient without guardianName', () => {
      const { guardianName, ...rest } = validChildBase
      const result = createPatientSchema.safeParse(rest)
      expect(result.success).toBe(false)
    })

    it('should reject child patient without guardianPhone', () => {
      const { guardianPhone, ...rest } = validChildBase
      const result = createPatientSchema.safeParse(rest)
      expect(result.success).toBe(false)
    })

    it('should reject child patient without guardianAddress', () => {
      const { guardianAddress, ...rest } = validChildBase
      const result = createPatientSchema.safeParse(rest)
      expect(result.success).toBe(false)
    })

    it('should reject child patient without guardianOccupation', () => {
      const { guardianOccupation, ...rest } = validChildBase
      const result = createPatientSchema.safeParse(rest)
      expect(result.success).toBe(false)
    })

    it('should accept valid guardian email', () => {
      const result = createPatientSchema.safeParse({
        ...validChildBase,
        guardianEmail: 'parent@example.com',
      })
      expect(result.success).toBe(true)
    })
  })

  describe('updatePatientSchema', () => {
    it('should accept partial updates', () => {
      expect(updatePatientSchema.safeParse({ name: 'New Name' }).success).toBe(true)
      expect(updatePatientSchema.safeParse({ occupation: 'Doctor' }).success).toBe(true)
      expect(updatePatientSchema.safeParse({}).success).toBe(true)
    })
  })
})
