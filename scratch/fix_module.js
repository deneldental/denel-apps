const fs = require('fs')

const staff = 'backend/src/db/schema/staff.ts'
let content = fs.readFileSync(staff, 'utf8')
content = content.replace(/\.default\(module\)/g, ".default('module')")
fs.writeFileSync(staff, content, 'utf8')

const clinical = 'backend/src/db/schema/clinical.ts'
let clinicalContent = fs.readFileSync(clinical, 'utf8')
clinicalContent = clinicalContent.replace(/\.default\(window\)/g, ".default('window')")
fs.writeFileSync(clinical, clinicalContent, 'utf8')

console.log('Fixed')
