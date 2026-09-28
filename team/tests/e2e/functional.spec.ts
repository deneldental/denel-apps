import { expect, test } from '@playwright/test'
import { signInAsPatient, signInAsStaff, signOut } from './helpers'

// STALE (pre-T27): this spec drives the old account-id + password login form,
// which the Team app no longer has — sign-in is phone + OTP. Skipped rather
// than left to fail on a selector that cannot match. Migrating these is
// follow-up work; `authenticated-csrf.spec.ts` is the migrated reference.
test.skip(true, 'Not yet migrated to the phone + OTP sign-in flow (T27 follow-up).')

/**
 * Sample functional smokes — beyond "the page renders," these assert that
 * each page reaches its intended UI surface (form fields, list headers,
 * empty-state copy). Two examples here as the seed for a larger functional
 * suite that the team can grow.
 */

test.describe.configure({ mode: 'serial' })

test('patient → /patient/appointments shows the appointments surface', async ({ page }) => {
  await signOut(page)
  await signInAsPatient(page)
  await page.goto('/patient/appointments')

  // The page must render either an empty-state or a list — confirm by
  // looking for any of the canonical text elements the route renders.
  // (Don't pin to a specific heading because copy may evolve.)
  await expect(
    page.getByText(/appointment|booking|schedule|no upcoming|empty/i).first()
  ).toBeVisible({ timeout: 10_000 })
})

test('admin → /requests/new renders the new-request form fields', async ({ page }) => {
  await signOut(page)
  await signInAsStaff(page, 'admin')

  await page.goto('/requests/new')

  // "New Request" heading is the load signal (waits for the React tree to
  // settle past the auth probes). After it appears, assert there's at least
  // one interactive form-ish control on the page. Accept textbox, combobox,
  // or button — different browsers expose Radix selects as different ARIA
  // roles, and iOS WebKit specifically reports them as `combobox`.
  await expect(page.getByRole('heading', { name: /new request/i })).toBeVisible({
    timeout: 15_000,
  })
  const interactiveCount =
    (await page.getByRole('textbox').count()) +
    (await page.getByRole('combobox').count()) +
    (await page.getByRole('button').count())
  expect(
    interactiveCount,
    '/requests/new should expose at least one interactive control'
  ).toBeGreaterThan(0)
})

test("admin /profile shows the signed-in user's name", async ({ page }) => {
  await signOut(page)
  await signInAsStaff(page, 'admin')
  await page.goto('/profile')

  // The Test Admin user has fullName "Test Admin" and email
  // "admin@test.framada.app". One or the other MUST appear once the
  // /api/staff-portal/profile fetch resolves. Use Locator + first() with
  // toBeVisible(timeout) so the assertion polls instead of asserting
  // against an empty DOM the moment navigation completes.
  await expect(page.getByText(/test admin|admin@test\.framada\.app/i).first()).toBeVisible({
    timeout: 15_000,
  })
})

test('lab tech /lab/jobs renders the lab dashboard surface', async ({ page }) => {
  await signOut(page)
  await signInAsStaff(page, 'labtech')
  await page.goto('/lab/jobs')

  // Wait for the page heading to confirm render is past auth probes.
  await expect(page.getByRole('heading', { name: /lab jobs/i })).toBeVisible({
    timeout: 15_000,
  })
  // Lab Jobs renders status stat cards ("Due Today", "In Progress",
  // "Completed", etc.) and filter chips below. At least one stat label
  // MUST be visible. Filter chips render once data resolves and aren't
  // assertable here without race-condition risk on mobile viewports.
  await expect(page.getByText(/due today|in progress|completed|pending/i).first()).toBeVisible({
    timeout: 10_000,
  })
})

test('trainer /trainer/modules renders create/empty surface', async ({ page }) => {
  await signOut(page)
  await signInAsStaff(page, 'trainer')
  await page.goto('/trainer/modules')

  // Wait for the "Modules" heading so we know the page is mounted past auth.
  await expect(page.getByRole('heading', { name: /^modules$/i })).toBeVisible({
    timeout: 15_000,
  })
  // Then verify either a "New / Create / Add" CTA or an existing modules
  // link is present — i.e. the trainer can either create or view modules.
  const hasCta = (await page.getByRole('button', { name: /^(create|add|new)$/i }).count()) > 0
  const hasModuleLink = (await page.locator('a[href^="/trainer/modules/"]').count()) > 0
  expect(
    hasCta || hasModuleLink,
    '/trainer/modules should offer a way to create or view modules'
  ).toBe(true)
})

test('doctor /doctor/today renders schedule heading', async ({ page }) => {
  await signOut(page)
  await signInAsStaff(page, 'doctor')
  await page.goto('/doctor/today')

  // The page exposes a "Today's schedule" heading. Assert via role so we
  // don't fight ambiguous body-text matches (the bottom nav also contains
  // "Today" / "Patients" which were causing strict-mode resolution issues
  // on mobile-ios).
  await expect(page.getByRole('heading', { name: /today.?s schedule|schedule/i })).toBeVisible({
    timeout: 15_000,
  })
})

test('patient /patient/profile shows the patient name from seed data', async ({ page }) => {
  await signOut(page)
  await signInAsPatient(page)
  await page.goto('/patient/profile')

  // #P-TEST is seeded with name "Test Patient". Wait up to 15s for the
  // /api/patient-auth/me-driven render to surface it (page polls a profile
  // fetch on mount).
  await expect(page.getByText(/test patient/i).first()).toBeVisible({ timeout: 15_000 })
})
