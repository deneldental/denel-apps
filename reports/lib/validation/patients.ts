import { z } from 'zod'

export const createPatientSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email().optional().or(z.literal('')),
    phone: z.string().optional(),
    dob: z.date(),
    gender: z.enum(['male', 'female', 'other']),
    address: z.string().optional(),
    occupation: z.string().optional(),
    profileImage: z.string().optional(),
    type: z.enum(['general', 'external']).default('general'),
    isChild: z.boolean().default(false),
    isOrtho: z.boolean().default(false),
    guardianName: z.string().optional(),
    guardianPhone: z.string().optional(),
    guardianEmail: z.string().email().optional().or(z.literal('')),
    guardianAddress: z.string().optional(),
    guardianOccupation: z.string().optional(),
    insuranceProvider: z.string().optional(),
    insurancePolicyNumber: z.string().optional(),
    emergencyContactName: z.string().optional(),
    emergencyContactPhone: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.isChild) {
        return (
          !!data.guardianName &&
          !!data.guardianPhone &&
          !!data.guardianAddress &&
          !!data.guardianOccupation
        )
      }
      return true
    },
    {
      message: 'Guardian information is required for child patients',
      path: ['guardianName'],
    }
  )
  .refine(
    (data) => {
      if (!data.isChild) {
        return !!data.address && !!data.occupation && !!data.phone
      }
      return true
    },
    {
      message: 'Address, occupation, and phone are required for adult patients',
      path: ['address'],
    }
  )

export const updatePatientSchema = createPatientSchema.partial()

export type CreatePatientInput = z.infer<typeof createPatientSchema>
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>
