const fs = require('fs')
const path = require('path')

const snapshotPath = path.join(__dirname, '../migrations/meta/0196_snapshot.json')
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))

const alters = []

for (const tableName in snapshot.tables) {
  const table = snapshot.tables[tableName]
  for (const colName in table.columns) {
    const col = table.columns[colName]
    
    // Check if it's numeric and not a rate/percent
    if (col.type.startsWith('numeric') && !col.name.toLowerCase().includes('rate') && !col.name.toLowerCase().includes('percent')) {
      alters.push(`ALTER TABLE "${table.name}" ALTER COLUMN "${col.name}" TYPE integer USING ROUND("${col.name}" * 100)::integer;`)
    }
  }
}

fs.writeFileSync(path.join(__dirname, '../migrations/0197_dinero_migration.sql'), alters.join('\n'))
console.log(`Generated 0197_dinero_migration.sql with ${alters.length} alterations.`)
