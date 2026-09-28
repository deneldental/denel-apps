import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const BASE_URL = 'http://localhost:3000'
const ORIGIN = 'http://localhost:5173' // Mock origin

const ROLES = [
  { role: 'Admin', email: 'admin@test.framada.app', password: 'password123' },
  { role: 'Doctor', email: 'doctor@test.framada.app', password: 'password123' },
  { role: 'Receptionist', email: 'receptionist@test.framada.app', password: 'password123' }
]

const ENDPOINTS_TO_TEST = [
  { method: 'GET', path: '/api/patients' },
  { method: 'GET', path: '/api/appointments' },
  { method: 'GET', path: '/api/settings' },
  { method: 'GET', path: '/api/financials' },
  { method: 'GET', path: '/api/staff' },
  { method: 'GET', path: '/api/roles' }
]

async function auditBackend() {
  const reports: Record<string, string[]> = {}

  for (const r of ROLES) {
    console.log(`Auditing as ${r.role} (${r.email})...`)
    const reportLines: string[] = []
    reportLines.push(`# Backend Audit Report: ${r.role}`)
    reportLines.push(`**Email:** ${r.email}`)
    reportLines.push(`**Time:** ${new Date().toISOString()}`)
    reportLines.push('')
    reportLines.push('| Method | Endpoint | Status | Result |')
    reportLines.push('|---|---|---|---|')

    try {
      // 0. Get CSRF Token
      const csrfRes = await fetch(`${BASE_URL}/api/csrf`, {
        method: 'GET',
        headers: { 'Origin': ORIGIN }
      })
      const csrfJson = await csrfRes.json()
      const csrfToken = csrfJson.token
      
      const csrfCookie = csrfRes.headers.get('set-cookie')?.split(';')[0] || ''

      // 1. Authenticate with Better Auth
      const loginRes = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Origin': ORIGIN,
          'X-CSRF-Token': csrfToken,
          'Cookie': csrfCookie
        },
        body: JSON.stringify({ email: r.email, password: r.password })
      })

      if (!loginRes.ok) {
        console.error(`  [!] Failed to login: ${loginRes.status}`)
        const text = await loginRes.text()
        console.error(`  [!] Error text: ${text}`)
        reportLines.push(`**Error:** Failed to login. Status ${loginRes.status}`)
        reports[r.role] = reportLines
        continue
      }

      // Extract cookies
      let setCookie = loginRes.headers.get('set-cookie')
      if (!setCookie) {
        console.error(`  [!] No cookie returned on login`)
        reportLines.push(`**Error:** No cookie returned.`)
        reports[r.role] = reportLines
        continue
      }
      
      // Merge cookies
      const cookies = setCookie.split(',').map(c => c.split(';')[0]).join('; ') + '; ' + csrfCookie

      // 2. Test each endpoint
      for (const endpoint of ENDPOINTS_TO_TEST) {
        const res = await fetch(`${BASE_URL}${endpoint.path}`, {
          method: endpoint.method,
          headers: {
            'Cookie': cookies,
            'Content-Type': 'application/json',
            'Origin': ORIGIN,
            'X-CSRF-Token': csrfToken
          }
        })

        const status = res.status
        let result = 'Unexpected'
        if (status === 200) result = 'Success'
        else if (status === 401) result = 'Unauthorized'
        else if (status === 403) result = 'Forbidden'
        else if (status === 404) result = 'Not Found'
        else if (status >= 500) result = 'Server Error'

        reportLines.push(`| ${endpoint.method} | \`${endpoint.path}\` | ${status} | ${result} |`)
      }

    } catch (e) {
      console.error(`  [!] Exception auditing ${r.role}:`, e)
      reportLines.push(`**Exception:** ${String(e)}`)
    }

    reports[r.role] = reportLines
    console.log(`  Done auditing ${r.role}.`)
  }

  const reportsDir = join(__dirname, '../../reports')
  mkdirSync(reportsDir, { recursive: true })
  for (const r of ROLES) {
    const filename = join(reportsDir, `${r.role.toLowerCase()}_audit_report.md`)
    writeFileSync(filename, reports[r.role].join('\n'))
    console.log(`Wrote ${filename}`)
  }
}

auditBackend().catch(console.error)
