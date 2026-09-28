const fs = require('fs')
const path = require('path')

const schemaDir = path.join(__dirname, '../src/db/schema')
const files = fs.readdirSync(schemaDir).filter(f => f.endsWith('.ts'))

for (const file of files) {
  const filePath = path.join(schemaDir, file)
  let content = fs.readFileSync(filePath, 'utf8')
  let changed = false
  
  // Find all integer(...).default('X') and replace with .default(X)
  // because integer columns must have number defaults.
  content = content.replace(/integer\(([^)]+)\)(\.[^$]*?)\.default\(['"]([^'"]+)['"]\)/g, (match, p1, p2, val) => {
    changed = true;
    return `integer(${p1})${p2}.default(${val})`
  })

  // Find all numeric(...).default(X) and replace with .default('X')
  // because numeric columns must have string defaults.
  content = content.replace(/numeric\(([^)]+)\)(\.[^$]*?)\.default\(([^'"]+?)\)/g, (match, p1, p2, val) => {
    // Only if it doesn't already have quotes
    if (val.startsWith("'") || val.startsWith('"')) return match;
    changed = true;
    return `numeric(${p1})${p2}.default('${val}')`
  })

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8')
    console.log(`Updated ${file}`)
  }
}
console.log('Done fixing defaults part 2!')
