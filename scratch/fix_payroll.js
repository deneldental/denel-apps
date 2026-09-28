const fs = require('fs')

const payroll = 'backend/src/routes/payroll.ts'
let content = fs.readFileSync(payroll, 'utf8')

// replace amount: '...' with amount: ... for payroll.ts inserts
content = content.replace(/lowerBoundMonthly:\s*'([^']+)'/g, 'lowerBoundMonthly: Number("$1")')
content = content.replace(/upperBoundMonthly:\s*'([^']+)'/g, 'upperBoundMonthly: Number("$1")')
content = content.replace(/ratePercent:\s*'([^']+)'/g, 'ratePercent: Number("$1")')
content = content.replace(/principalAmount:\s*'([^']+)'/g, 'principalAmount: Number("$1")')
content = content.replace(/monthlyInstallment:\s*'([^']+)'/g, 'monthlyInstallment: Number("$1")')

fs.writeFileSync(payroll, content, 'utf8')

const hrRoutesTest = 'backend/tests/integration/hr-routes.test.ts'
let hrContent = fs.readFileSync(hrRoutesTest, 'utf8')
hrContent = hrContent.replace(/Math\.round\(totalGross\.toFixed\(2\)\)/g, 'totalGross')
hrContent = hrContent.replace(/Math\.round\(totalNet\.toFixed\(2\)\)/g, 'totalNet')
fs.writeFileSync(hrRoutesTest, hrContent, 'utf8')

const hrTest2 = 'backend/tests/integration/admin-v1-money-flows.test.ts'
let hrContent2 = fs.readFileSync(hrTest2, 'utf8')
hrContent2 = hrContent2.replace(/grossPay:\s*String\(([^)]+)\)/g, 'grossPay: $1')
hrContent2 = hrContent2.replace(/netPay:\s*String\(([^)]+)\)/g, 'netPay: $1')
fs.writeFileSync(hrTest2, hrContent2, 'utf8')

console.log('Fixed payroll and tests')
