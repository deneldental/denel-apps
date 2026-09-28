const fs = require('fs')
const path = require('path')

const schemaDir = path.join(__dirname, '../src/db/schema')
const files = fs.readdirSync(schemaDir).filter(f => f.endsWith('.ts'))

for (const file of files) {
  const filePath = path.join(schemaDir, file)
  let content = fs.readFileSync(filePath, 'utf8')
  
  const regex = /\.default\(['"]0(?:\.00)?['"]\)/g
  
  if (regex.test(content)) {
    content = content.replace(regex, '.default(0)')
    fs.writeFileSync(filePath, content, 'utf8')
    console.log(`Updated ${file}`)
  }
}
console.log('Done fixing defaults!')
