/**
 * Migration script to fix decimal places in all monetary amount fields.
 *
 * Problem: All amounts were stored with values 100x too small
 * (e.g., 90.00 instead of 9000.00 cents)
 *
 * Solution: Multiply all amount fields by 100
 *
 * This script updates:
 * - payments table (amount, balance)
 * - payment_plans table (totalAmount, amountPerInstallment)
 * - payment_plan_templates table (totalAmount, amountPerInstallment)
 * - products table (price, costPrice)
 * - sales table (unitPrice, costPrice, totalAmount, profit)
 * - expenses table (amount)
 * - daily_reports table (totalPayments, totalExpenses, balances JSONB)
 */

import { config } from 'dotenv'

config({ path: '.env.local' })

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'

async function main() {
  const databaseUrl = process.env.DATABASE_URL || process.env.STAGING_DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL or STAGING_DATABASE_URL environment variable must be set')
  }

  console.log('🔄 Starting decimal place fix migration...\n')

  // Create pg pool and drizzle instance (matching app's setup)
  const pool = new pg.Pool({
    connectionString: databaseUrl,
  })
  const db = drizzle(pool)

  try {
    // Begin transaction
    console.log('📦 Starting transaction...')
    await db.execute(sql`BEGIN`)

    // Track total records updated
    let totalUpdated = 0

    // 1. Update payments table
    console.log('\n📝 Updating payments table...')
    const paymentsResult = await db.execute(sql`
      UPDATE payments
      SET 
        amount = amount * 100,
        balance = CASE WHEN balance IS NOT NULL THEN balance * 100 ELSE NULL END
      WHERE amount < 1000000  -- Safety check: only update if amount seems wrong
      RETURNING id
    `)
    const paymentsCount = paymentsResult.rowCount || 0
    totalUpdated += paymentsCount
    console.log(`   ✓ Updated ${paymentsCount} payment records`)

    // 2. Update payment_plans table
    console.log('\n📝 Updating payment_plans table...')
    const plansResult = await db.execute(sql`
      UPDATE payment_plans
      SET 
        "totalAmount" = "totalAmount" * 100,
        "amountPerInstallment" = CASE 
          WHEN "amountPerInstallment" IS NOT NULL 
          THEN "amountPerInstallment" * 100 
          ELSE NULL 
        END
      WHERE "totalAmount" < 1000000  -- Safety check
      RETURNING id
    `)
    const plansCount = plansResult.rowCount || 0
    totalUpdated += plansCount
    console.log(`   ✓ Updated ${plansCount} payment plan records`)

    // 3. Update payment_plan_templates table
    console.log('\n📝 Updating payment_plan_templates table...')
    const templatesResult = await db.execute(sql`
      UPDATE payment_plan_templates
      SET 
        "totalAmount" = "totalAmount" * 100,
        "amountPerInstallment" = "amountPerInstallment" * 100
      WHERE "totalAmount" < 1000000  -- Safety check
      RETURNING id
    `)
    const templatesCount = templatesResult.rowCount || 0
    totalUpdated += templatesCount
    console.log(`   ✓ Updated ${templatesCount} payment plan template records`)

    // 4. Update products table
    console.log('\n📝 Updating products table...')
    const productsResult = await db.execute(sql`
      UPDATE products
      SET 
        price = price * 100,
        "costPrice" = CASE 
          WHEN "costPrice" IS NOT NULL 
          THEN "costPrice" * 100 
          ELSE NULL 
        END
      WHERE price < 1000000  -- Safety check
      RETURNING id
    `)
    const productsCount = productsResult.rowCount || 0
    totalUpdated += productsCount
    console.log(`   ✓ Updated ${productsCount} product records`)

    // 5. Update sales table
    console.log('\n📝 Updating sales table...')
    const salesResult = await db.execute(sql`
      UPDATE sales
      SET 
        "unitPrice" = "unitPrice" * 100,
        "costPrice" = "costPrice" * 100,
        "totalAmount" = "totalAmount" * 100,
        profit = profit * 100
      WHERE "unitPrice" < 1000000  -- Safety check
      RETURNING id
    `)
    const salesCount = salesResult.rowCount || 0
    totalUpdated += salesCount
    console.log(`   ✓ Updated ${salesCount} sales records`)

    // 6. Update expenses table
    console.log('\n📝 Updating expenses table...')
    const expensesResult = await db.execute(sql`
      UPDATE expenses
      SET amount = amount * 100
      WHERE amount < 1000000  -- Safety check
      RETURNING id
    `)
    const expensesCount = expensesResult.rowCount || 0
    totalUpdated += expensesCount
    console.log(`   ✓ Updated ${expensesCount} expense records`)

    // 7. Update daily_reports table (totalPayments, totalExpenses, and balances JSONB)
    console.log('\n📝 Updating daily_reports table...')
    const reportsResult = await db.execute(sql`
      UPDATE daily_reports
      SET 
        "totalPayments" = "totalPayments" * 100,
        "totalExpenses" = "totalExpenses" * 100,
        balances = (
          SELECT jsonb_agg(
            jsonb_set(
              balance_item,
              '{amount}',
              to_jsonb((balance_item->>'amount')::numeric * 100)
            )
          )
          FROM jsonb_array_elements(balances) AS balance_item
        )
      WHERE "totalPayments" < 1000000  -- Safety check
      RETURNING id
    `)
    const reportsCount = reportsResult.rowCount || 0
    totalUpdated += reportsCount
    console.log(`   ✓ Updated ${reportsCount} daily report records`)

    // Commit transaction
    console.log('\n✅ Committing transaction...')
    await db.execute(sql`COMMIT`)

    console.log(`\n${'='.repeat(60)}`)
    console.log('✅ Migration completed successfully!')
    console.log('='.repeat(60))
    console.log(`\n📊 Summary:`)
    console.log(`   - Payments: ${paymentsCount} records`)
    console.log(`   - Payment Plans: ${plansCount} records`)
    console.log(`   - Payment Plan Templates: ${templatesCount} records`)
    console.log(`   - Products: ${productsCount} records`)
    console.log(`   - Sales: ${salesCount} records`)
    console.log(`   - Expenses: ${expensesCount} records`)
    console.log(`   - Daily Reports: ${reportsCount} records`)
    console.log(`   - TOTAL: ${totalUpdated} records updated\n`)
  } catch (error) {
    // Rollback on error
    console.error('\n❌ Error during migration:', error)
    console.log('🔙 Rolling back transaction...')
    await db.execute(sql`ROLLBACK`)
    throw error
  } finally {
    // Close connection
    await pool.end()
    console.log('🔌 Database connection closed')
  }
}

main()
  .then(() => {
    console.log('\n✨ Migration script finished successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n💥 Migration script failed:', error)
    process.exit(1)
  })
