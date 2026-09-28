const fs = require('fs')
const path = require('path')

function getFiles(dir, files = []) {
  const fileList = fs.readdirSync(dir)
  for (const file of fileList) {
    const name = `${dir}/${file}`
    if (fs.statSync(name).isDirectory()) {
      getFiles(name, files)
    } else if (name.endsWith('.ts')) {
      files.push(name)
    }
  }
  return files
}

const testFiles = getFiles('backend/tests')

for (const file of testFiles) {
  let content = fs.readFileSync(file, 'utf8')
  const original = content

  content = content.replace(/amount:\s*'(\d+)'/g, 'amount: $1')
  content = content.replace(/baseAmount:\s*'(\d+)'/g, 'baseAmount: $1')
  content = content.replace(/grossPay:\s*String\(([^)]+)\)/g, 'grossPay: $1')
  content = content.replace(/netPay:\s*String\(([^)]+)\)/g, 'netPay: $1')
  content = content.replace(/totalGross:\s*String\(([^)]+)\)/g, 'totalGross: Math.round($1)')
  content = content.replace(/totalNet:\s*String\(([^)]+)\)/g, 'totalNet: Math.round($1)')

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8')
    console.log(`Updated ${file}`)
  }
}
