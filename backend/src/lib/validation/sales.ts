import { z } from 'zod'

export const createSaleSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  quantity: z.number().int().positive('Quantity must be positive'),
  unitPrice: z.number().int().nonnegative('Unit price must be non-negative'),
  costPrice: z.number().int().nonnegative('Cost price must be non-negative'),
})

export type CreateSaleInput = z.infer<typeof createSaleSchema>
