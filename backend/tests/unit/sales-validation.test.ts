import { describe, expect, it } from 'vitest'
import { type CreateSaleInput, createSaleSchema } from '../../src/lib/validation/sales'

describe('Sales Validation', () => {
  describe('createSaleSchema', () => {
    const validSale: CreateSaleInput = {
      productId: '550e8400-e29b-41d4-a716-446655440000',
      quantity: 2,
      unitPrice: 1000,
      costPrice: 800,
    }

    it('should accept a valid sale input', () => {
      const result = createSaleSchema.safeParse(validSale)
      expect(result.success).toBe(true)
    })

    it('should reject invalid UUID for productId', () => {
      const result = createSaleSchema.safeParse({ ...validSale, productId: 'not-a-uuid' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Invalid product ID')
      }
    })

    it('should reject zero or negative quantity', () => {
      expect(createSaleSchema.safeParse({ ...validSale, quantity: 0 }).success).toBe(false)
      expect(createSaleSchema.safeParse({ ...validSale, quantity: -1 }).success).toBe(false)
    })

    it('should reject non-integer quantity', () => {
      const result = createSaleSchema.safeParse({ ...validSale, quantity: 1.5 })
      expect(result.success).toBe(false)
    })

    it('should accept zero unit price and cost price', () => {
      const result = createSaleSchema.safeParse({ ...validSale, unitPrice: 0, costPrice: 0 })
      expect(result.success).toBe(true)
    })

    it('should reject negative unit price', () => {
      const result = createSaleSchema.safeParse({ ...validSale, unitPrice: -1 })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('non-negative')
      }
    })

    it('should reject negative cost price', () => {
      const result = createSaleSchema.safeParse({ ...validSale, costPrice: -100 })
      expect(result.success).toBe(false)
    })

    it('should reject missing required fields', () => {
      expect(createSaleSchema.safeParse({}).success).toBe(false)
      expect(createSaleSchema.safeParse({ productId: validSale.productId }).success).toBe(false)
    })
  })
})
