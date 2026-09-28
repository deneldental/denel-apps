import { neon } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-http'

// Load environment variables
dotenv.config({ path: '.env.local' })

const sqlClient = neon(process.env.DATABASE_URL!)
const db = drizzle(sqlClient)

const BUCKET_NAME = process.env.DO_SPACES_BUCKET!
const REGION = process.env.DO_SPACES_REGION?.toLowerCase()

// Old URL format: https://fra1.digitaloceanspaces.com/...
// New URL format: https://ortho-img.fra1.cdn.digitaloceanspaces.com/...
const OLD_ENDPOINT = 'https://fra1.digitaloceanspaces.com'
const NEW_ENDPOINT = `https://${BUCKET_NAME}.${REGION}.cdn.digitaloceanspaces.com`

async function updateUrls() {
  console.log('Starting URL migration...\n')
  console.log(`Old endpoint: ${OLD_ENDPOINT}`)
  console.log(`New endpoint: ${NEW_ENDPOINT}\n`)

  try {
    // Update patient avatars
    console.log('Updating patient avatars...')
    const patientsResult = await db.execute(sql`
      UPDATE patients 
      SET "profileImage" = REPLACE("profileImage", ${OLD_ENDPOINT}, ${NEW_ENDPOINT})
      WHERE "profileImage" LIKE ${`${OLD_ENDPOINT}%`}
    `)
    console.log(`✓ Updated ${patientsResult.rowCount || 0} patient avatars`)

    // Update medical record attachments (JSON array of URLs)
    console.log('Updating medical record attachments...')
    const medicalRecordsResult = await db.execute(sql`
      UPDATE medical_records 
      SET attachments = REPLACE(attachments, ${OLD_ENDPOINT}, ${NEW_ENDPOINT})
      WHERE attachments LIKE ${`${OLD_ENDPOINT}%`}
    `)
    console.log(`✓ Updated ${medicalRecordsResult.rowCount || 0} medical records`)

    // Update product images
    console.log('Updating product images...')
    const productsResult = await db.execute(sql`
      UPDATE products 
      SET image = REPLACE(image, ${OLD_ENDPOINT}, ${NEW_ENDPOINT})
      WHERE image LIKE ${`${OLD_ENDPOINT}%`}
    `)
    console.log(`✓ Updated ${productsResult.rowCount || 0} product images`)

    // Update inventory images
    console.log('Updating inventory images...')
    const inventoryResult = await db.execute(sql`
      UPDATE inventory 
      SET image = REPLACE(image, ${OLD_ENDPOINT}, ${NEW_ENDPOINT})
      WHERE image LIKE ${`${OLD_ENDPOINT}%`}
    `)
    console.log(`✓ Updated ${inventoryResult.rowCount || 0} inventory images`)

    // Update ortho consent forms
    console.log('Updating ortho consent forms...')
    const consentFormsResult = await db.execute(sql`
      UPDATE ortho_consent_forms 
      SET "consentFormUrl" = REPLACE("consentFormUrl", ${OLD_ENDPOINT}, ${NEW_ENDPOINT})
      WHERE "consentFormUrl" LIKE ${`${OLD_ENDPOINT}%`}
    `)
    console.log(`✓ Updated ${consentFormsResult.rowCount || 0} consent forms`)

    console.log('\n✅ URL migration completed successfully!')
  } catch (error) {
    console.error('❌ Error updating URLs:', error)
    process.exit(1)
  }
}

updateUrls()
