import { sql } from 'drizzle-orm'
import { db } from '../lib/db'

async function verifyRoleColumn() {
  try {
    // Check if the role column exists in the user table
    const result = await db.execute(sql`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'user' AND column_name = 'role'
        `)

    console.log("Checking for 'role' column in 'user' table...")
    console.log('Result:', result)

    interface ColumnInfo {
      column_name: string
      data_type: string
    }
    const rows = result.rows as unknown as ColumnInfo[]
    if (rows && rows.length > 0) {
      console.log("✓ 'role' column exists!")
      console.log('Column details:', rows[0])
    } else {
      console.log("✗ 'role' column does NOT exist. Migration may not have been applied.")
    }

    // Also check all columns in user table
    const allColumns = await db.execute(sql`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'user'
            ORDER BY ordinal_position
        `)

    console.log("\nAll columns in 'user' table:")
    const allRows = allColumns.rows as unknown as ColumnInfo[]
    allRows.forEach((col: ColumnInfo) => {
      console.log(`  - ${col.column_name} (${col.data_type})`)
    })

    process.exit(0)
  } catch (error) {
    console.error('Error verifying column:', error)
    process.exit(1)
  }
}

verifyRoleColumn()
