const fs = require('fs')
const path = require('path')

const schemaDir = path.join(__dirname, '../src/db/schema')
const files = fs.readdirSync(schemaDir).filter(f => f.endsWith('.ts'))

let totalReplaced = 0

for (const file of files) {
  const filePath = path.join(schemaDir, file)
  let content = fs.readFileSync(filePath, 'utf8')
  
  // Replace money fields: numeric('name', { precision: X, scale: 2 }) or numeric('name', { precision: X, scale: 2 }).$type<number>()
  // -> integer('name')
  // We must match optionally the .$type<number>() part.
  const regex = /numeric\('([^']+)',\s*\{\s*precision:\s*\d+,\s*scale:\s*2\s*\}\)(?:\.\$type<number>\(\))?/g
  
  let changed = false
  content = content.replace(regex, (match, colName) => {
    // If it's a rate field, skip it.
    if (colName.includes('rate') || colName.includes('Rate') || colName.includes('Percent') || colName.includes('percent')) {
      return match
    }
    changed = true
    totalReplaced++
    return `integer('${colName}')`
  })

  // Ensure `integer` is imported if we made changes
  if (changed) {
    if (!content.includes('integer,')) {
      const importRegex = /import\s+\{([^}]+)\}\s+from\s+'drizzle-orm\/pg-core'/
      content = content.replace(importRegex, (match, imports) => {
        const importList = imports.split(',').map(i => i.trim()).filter(Boolean)
        if (!importList.includes('integer')) {
          importList.push('integer')
          importList.sort()
        }
        return `import { ${importList.join(', ')} } from 'drizzle-orm/pg-core'`
      })
    }
    fs.writeFileSync(filePath, content, 'utf8')
    console.log(`Updated ${file}`)
  }
}

console.log(`Done! Replaced ${totalReplaced} additional numeric fields with integer.`)
