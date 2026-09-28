import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'csv-parse/sync'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { patients } from '@/lib/db/schema'
import { importPatientsWithPaymentPlans } from './import_patients_with_payment_plans'
import { importZeroBalancePatients } from './import_patients_zero_balance_v2'

async function updateOrthoFlags() {
  console.log('\n🏥 Setting ortho flags...\n')

  // Read ortho patients CSV
  const csvPath = path.join(process.cwd(), 'Ortho Cases Import - 000.csv')
  const fileContent = fs.readFileSync(csvPath, 'utf-8')

  const records: Array<{ 'Full Name': string }> = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  })

  // Remove duplicates
  const uniqueNames = [...new Set(records.map((r) => r['Full Name'].trim()))]
  console.log(`📋 Found ${uniqueNames.length} unique ortho patients\n`)

  let updated = 0
  let notFound = 0
  const notFoundNames: string[] = []

  for (const name of uniqueNames) {
    try {
      const result = await db
        .update(patients)
        .set({ isOrtho: true })
        .where(sql`LOWER(${patients.name}) = LOWER(${name})`)

      if (result.rowCount === 0) {
        notFound++
        notFoundNames.push(name)
      } else {
        updated++
      }
    } catch (error) {
      console.error(`❌ Error updating ${name}:`, error)
      notFound++
      notFoundNames.push(name)
    }
  }

  console.log(`✅ Updated ${updated} ortho patients`)
  console.log(`⚠️  Not found: ${notFound} patients`)

  if (notFoundNames.length > 0) {
    console.log('\n📝 Patients not found:')
    notFoundNames.slice(0, 20).forEach((name) => console.log(`  - ${name}`))
    if (notFoundNames.length > 20) {
      console.log(`  ... and ${notFoundNames.length - 20} more`)
    }
  }

  return { updated, notFound, notFoundNames }
}

async function reimportAllPatients() {
  console.log('🎯 MASTER IMPORT SCRIPT - Re-importing All Patient Data\n')
  console.log('='.repeat(60))

  const startTime = Date.now()
  const results = {
    zeroBalance: { imported: 0, skipped: 0 },
    nonZeroBalance: { imported: 0, plansCreated: 0, skipped: 0 },
    ortho: { updated: 0, notFound: 0 },
  }

  try {
    // Step 1: Import zero-balance patients
    console.log('\n📊 STEP 1/3: Importing zero-balance patients')
    console.log('-'.repeat(60))
    const zeroBalanceResult = await importZeroBalancePatients()
    results.zeroBalance = {
      imported: zeroBalanceResult.imported,
      skipped: zeroBalanceResult.skipped,
    }

    // Step 2: Import non-zero balance patients with payment plans
    console.log('\n💰 STEP 2/3: Importing non-zero balance patients + payment plans')
    console.log('-'.repeat(60))
    const nonZeroResult = await importPatientsWithPaymentPlans()
    results.nonZeroBalance = {
      imported: nonZeroResult.imported,
      plansCreated: nonZeroResult.plansCreated,
      skipped: nonZeroResult.skipped,
    }

    // Step 3: Set ortho flags
    console.log('\n🏥 STEP 3/3: Setting ortho flags')
    console.log('-'.repeat(60))
    const orthoResult = await updateOrthoFlags()
    results.ortho = {
      updated: orthoResult.updated,
      notFound: orthoResult.notFound,
    }

    // Final Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log(`\n${'='.repeat(60)}`)
    console.log('✨ IMPORT COMPLETE - FINAL SUMMARY')
    console.log('='.repeat(60))
    console.log('\n📊 Zero-Balance Patients:')
    console.log(`   ✅ Imported: ${results.zeroBalance.imported}`)
    console.log(`   ⚠️  Skipped: ${results.zeroBalance.skipped}`)

    console.log('\n💰 Non-Zero Balance Patients:')
    console.log(`   ✅ Imported: ${results.nonZeroBalance.imported}`)
    console.log(`   💳 Payment Plans Created: ${results.nonZeroBalance.plansCreated}`)
    console.log(`   ⚠️  Skipped: ${results.nonZeroBalance.skipped}`)

    console.log('\n🏥 Ortho Flags:')
    console.log(`   ✅ Updated: ${results.ortho.updated}`)
    console.log(`   ⚠️  Not Found: ${results.ortho.notFound}`)

    const totalImported = results.zeroBalance.imported + results.nonZeroBalance.imported
    const totalSkipped = results.zeroBalance.skipped + results.nonZeroBalance.skipped

    console.log('\n📈 TOTALS:')
    console.log(`   👥 Total Patients: ${totalImported}`)
    console.log(`   💳 Payment Plans: ${results.nonZeroBalance.plansCreated}`)
    console.log(`   🏥 Ortho Patients: ${results.ortho.updated}`)
    console.log(`   ⚠️  Total Skipped: ${totalSkipped}`)
    console.log(`   ⏱️  Duration: ${duration}s`)

    console.log(`\n${'='.repeat(60)}`)

    return results
  } catch (error) {
    console.error('\n💥 IMPORT FAILED:', error)
    throw error
  }
}

// Run if called directly
if (require.main === module) {
  reimportAllPatients()
    .then(() => {
      console.log('\n✅ All imports completed successfully!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('\n❌ Import process failed:', error)
      process.exit(1)
    })
}

export { reimportAllPatients }
