import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { PATIENT, readLatestOtp, STAFF, signOut, TEST_PASSWORD } from './helpers'

// STALE (pre-T27): this spec drives the old account-id + password login form,
// which the Team app no longer has — sign-in is phone + OTP. Skipped rather
// than left to fail on a selector that cannot match. Migrating these is
// follow-up work; `authenticated-csrf.spec.ts` is the migrated reference.
test.skip(true, 'Not yet migrated to the phone + OTP sign-in flow (T27 follow-up).')

/**
 * A11y on INTERACTION states — pages re-checked after they've reached a
 * non-initial state (form error visible, OTP step active, modal open).
 *
 * Same threshold as the page-level a11y suite: fail on `critical`, log
 * `serious` (mostly contrast issues that need design tweaks).
 */

test.describe.configure({ mode: 'serial' })

const SEVERE: Array<'critical'> = ['critical']

async function assertNoSevereA11yIssues(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze()
  const severe = results.violations.filter((v) => SEVERE.includes(v.impact as 'critical'))
  if (severe.length > 0) {
    console.error(`\n[a11y states] ${label} — ${severe.length} severe violation(s):`)
    for (const v of severe) {
      console.error(`  - ${v.id} (${v.impact}): ${v.help}`)
      for (const node of v.nodes.slice(0, 3)) {
        console.error(`      ${node.target.join(' ')}`)
      }
    }
  }
  expect(severe, `${label} has critical WCAG violations`).toEqual([])
}

test('a11y state: login form with credential error visible', async ({ page }) => {
  await signOut(page)
  await page.goto('/login')
  await page.getByLabel(/account id/i).waitFor({ state: 'visible' })
  await page.getByLabel(/account id/i).fill(STAFF.admin.staffId)
  await page.getByLabel(/^password$/i).fill('definitely-wrong')
  await page.getByRole('button', { name: /^sign in/i }).click()
  await expect(
    page.getByText(/invalid.*staff id.*password|invalid.*username.*password/i)
  ).toBeVisible({ timeout: 8000 })
  await assertNoSevereA11yIssues(page, '/login (credential-error state)')
})

test('a11y state: login form with OTP step visible (staff)', async ({ page }) => {
  await signOut(page)
  const cutoff = new Date().toISOString()
  await page.goto('/login')
  await page.getByLabel(/account id/i).waitFor({ state: 'visible' })
  await page.getByLabel(/account id/i).fill(STAFF.admin.staffId)
  await page.getByLabel(/^password$/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /^sign in/i }).click()
  await expect(page.getByLabel(/6-digit code/i)).toBeVisible({ timeout: 15_000 })
  await assertNoSevereA11yIssues(page, '/login (OTP step)')

  // Also assert wrong-OTP error state.
  await page.getByLabel(/6-digit code/i).fill('000000')
  await page.getByRole('button', { name: /verify/i }).click()
  await expect(page.getByText(/incorrect|invalid|expired/i)).toBeVisible({ timeout: 8000 })
  await assertNoSevereA11yIssues(page, '/login (OTP wrong-code error)')

  // Clean up: enter the correct OTP so the trust cookie is set and the
  // next test doesn't burn an extra OTP slot for admin.
  const code = await readLatestOtp(cutoff)
  await page.getByLabel(/6-digit code/i).fill(code)
  await page.getByRole('button', { name: /verify/i }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 })
})

test('a11y state: login form with patient OTP step visible', async ({ page }) => {
  await signOut(page)
  await page.goto('/login')
  await page.getByLabel(/account id/i).waitFor({ state: 'visible' })
  await page.getByLabel(/account id/i).fill(PATIENT.patientId)
  await page.getByLabel(/^password$/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /^sign in/i }).click()
  await expect(page.getByLabel(/6-digit code/i)).toBeVisible({ timeout: 15_000 })
  await assertNoSevereA11yIssues(page, '/login (patient OTP step)')
})

test('a11y state: forgot-password — enter-id step', async ({ page }) => {
  await signOut(page)
  await page.goto('/forgot-password')
  await assertNoSevereA11yIssues(page, '/forgot-password (enter-id)')
})

test('a11y state: forgot-password — verify-otp step', async ({ page }) => {
  await signOut(page)
  await page.goto('/forgot-password')
  await page.getByLabel(/patient id|staff id/i).waitFor({ state: 'visible' })
  await page.getByLabel(/patient id|staff id/i).fill(PATIENT.patientId)
  await page.getByRole('button', { name: /send otp/i }).click()
  await expect(page.getByLabel(/otp code/i)).toBeVisible({ timeout: 10_000 })
  await assertNoSevereA11yIssues(page, '/forgot-password (verify-otp)')
})

test('a11y state: forgot-password — new-password step', async ({ page }) => {
  await signOut(page)
  const cutoff = new Date().toISOString()
  await page.goto('/forgot-password')
  await page.getByLabel(/patient id|staff id/i).waitFor({ state: 'visible' })
  await page.getByLabel(/patient id|staff id/i).fill(PATIENT.patientId)
  await page.getByRole('button', { name: /send otp/i }).click()
  await expect(page.getByLabel(/otp code/i)).toBeVisible({ timeout: 10_000 })
  const code = await readLatestOtp(cutoff)
  await page.getByLabel(/otp code/i).fill(code)
  await page.getByRole('button', { name: /verify code/i }).click()
  await expect(page.getByLabel(/new password/i)).toBeVisible({ timeout: 10_000 })
  await assertNoSevereA11yIssues(page, '/forgot-password (new-password)')
})
