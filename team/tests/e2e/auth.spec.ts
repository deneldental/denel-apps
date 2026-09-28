import { expect, test } from '@playwright/test'
import { PATIENT, readLatestOtp, STAFF, signOut, TEST_PASSWORD } from './helpers'

// STALE (pre-T27): this spec drives the old account-id + password login form,
// which the Team app no longer has — sign-in is phone + OTP. Skipped rather
// than left to fail on a selector that cannot match. Migrating these is
// follow-up work; `authenticated-csrf.spec.ts` is the migrated reference.
test.skip(true, 'Not yet migrated to the phone + OTP sign-in flow (T27 follow-up).')

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await signOut(page)
})

test('login page renders required inputs and Sign In button', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByLabel(/account id/i)).toBeVisible()
  await expect(page.getByLabel(/^password$/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /^sign in/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /forgot password/i })).toBeVisible()
})

test('empty submit shows validation message', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: /^sign in/i }).click()
  // HTML5 required-field validation prevents submission; URL stays on /login.
  await expect(page).toHaveURL(/\/login/)
})

test('staff sign-in: wrong password rejected', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel(/account id/i).fill(STAFF.admin.staffId)
  await page.getByLabel(/^password$/i).fill('definitely-wrong')
  await page.getByRole('button', { name: /^sign in/i }).click()
  await expect(
    page.getByText(/invalid.*staff id.*password|invalid.*username.*password/i)
  ).toBeVisible({
    timeout: 8000,
  })
  await expect(page).toHaveURL(/\/login/)
})

test('staff sign-in: bogus staffId rejected', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel(/account id/i).fill('FDM-S9999')
  await page.getByLabel(/^password$/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /^sign in/i }).click()
  await expect(page.getByText(/invalid/i)).toBeVisible({ timeout: 8000 })
})

test('patient sign-in: wrong password rejected', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel(/account id/i).fill(PATIENT.patientId)
  await page.getByLabel(/^password$/i).fill('not-the-real-password')
  await page.getByRole('button', { name: /^sign in/i }).click()
  await expect(page.getByText(/invalid.*patient id.*password|invalid/i)).toBeVisible({
    timeout: 8000,
  })
})

test('staff sign-in: valid creds → OTP step → verify → landing page', async ({ page }) => {
  const cutoff = new Date().toISOString()
  await page.goto('/login')
  await page.getByLabel(/account id/i).fill(STAFF.admin.staffId)
  await page.getByLabel(/^password$/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /^sign in/i }).click()

  // First sign-in from this browser context → device-trust check returns
  // false → OTP screen is shown.
  await expect(page.getByLabel(/6-digit code/i)).toBeVisible({ timeout: 10_000 })

  // Wrong code rejected.
  await page.getByLabel(/6-digit code/i).fill('000000')
  await page.getByRole('button', { name: /verify/i }).click()
  await expect(page.getByText(/incorrect|invalid|expired/i)).toBeVisible({ timeout: 8000 })

  // Correct code accepted.
  const code = await readLatestOtp(cutoff)
  await page.getByLabel(/6-digit code/i).fill(code)
  await page.getByRole('button', { name: /verify/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 10_000 })
})

test('forgot password link navigates to the right surface', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('link', { name: /forgot password/i }).click()
  await expect(page).toHaveURL(/forgot/i)
})
