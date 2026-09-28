import { db } from '@/lib/db'
import { patients } from '@/lib/db/schema'

async function createLegacyPatient() {
  try {
    const patientData = {
      name: 'Legacy Test Patient',
      dob: new Date('1980-01-01'),
      gender: 'male',
      type: 'legacy' as const, // This cast is important now
      isChild: false,
      isOrtho: false,
      phone: '0555555555',
      address: 'Legacy Address',
      patientId: '#LEGACY001',
      occupation: 'Tester',
    }

    await db.insert(patients).values(patientData)
    console.log('Legacy patient created successfully')
  } catch (error) {
    console.error('Error creating legacy patient:', error)
  }
}

createLegacyPatient()
