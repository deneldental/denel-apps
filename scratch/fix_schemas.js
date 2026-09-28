const fs = require('fs')
const path = require('path')

const dir = 'backend/src/db/schema'
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => `${dir}/${f}`)

const fixEnums = [
  'full',
  'single',
  'paid',
  'draft',
  'pending',
  'window',
  'PENDING',
  'exempt',
  'pending_approval',
  'GHS',
  'pwa',
  'slate',
  'other',
  'Module',
  'general',
  'present',
  'active',
]

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8')
  const original = content

  fixEnums.forEach((word) => {
    const regex = new RegExp(`\\.default\\(${word}\\)`, 'g')
    content = content.replace(regex, `.default('${word}')`)
  })

  content = content.replace(
    /numeric\([^,]+,\s*{[^}]+}\)\s*\n\s*\.notNull\(\)\s*\n\s*\.default\((0)\)/g,
    (match) => {
      return match.replace('.default(0)', ".default('0')")
    }
  )

  content = content.replace(
    /numeric\([^,]+,\s*{[^}]+}\)\s*\.notNull\(\)\s*\.default\((0)\)/g,
    (match) => {
      return match.replace('.default(0)', ".default('0')")
    }
  )

  if (file.includes('specialists.ts')) {
    content = content.replace(/\.default\(0\)/g, ".default('0')")
  }

  content = content.replace(/\.default\('true'\)/g, '.default(true)')
  content = content.replace(/\.default\('false'\)/g, '.default(false)')

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8')
    console.log(`Fixed ${file}`)
  }
}
