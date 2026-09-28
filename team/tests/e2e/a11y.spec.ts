import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signInAsPatient, signInAsStaff, signOut } from './helpers'

// STALE (pre-T27): this spec drives the old account-id + password login form,
// which the Team app no longer has — sign-in is phone + OTP. Skipped rather
// than left to fail on a selector that cannot match. Migrating these is
// follow-up work; `authenticated-csrf.spec.ts` is the migrated reference.
test.skip(true, 'Not yet migrated to the phone + OTP sign-in flow (T27 follow-up).')

test.describe.configure({ mode: 'serial' })

/**
 * Accessibility smoke. We assert that high-severity WCAG violations
 * (`serious` + `critical`) do not appear on key pages.
 *
 * `moderate` and `minor` violations are NOT failing the suite — they're
 * reported as console output so the team can triage. This matches what
 * teams typically commit to as a fail-the-build gate; if you want a
 * stricter bar later, drop the include() filter below.
 */

// Gate the suite on both `serious` and `critical` impacts. The runner below
// dumps the offending selectors so any new failures point straight at the
// element that needs fixing.
const SEVERE: Array<'serious' | 'critical'> = ['serious', 'critical']

async function assertNoSevereA11yIssues(
  page: Awaited<ReturnType<typeof test.step>> | unknown,
  label: string
) {
  const { page: p } = page as { page: import('@playwright/test').Page }
  const results = await new AxeBuilder({ page: p })
    .include('body')
    // Disable known noisy rules for our component library (Radix Slot, etc.).
    // None disabled by default — left here as a hook if false-positives surface.
    .disableRules([])
    .analyze()

  const severe = results.violations.filter((v) =>
    SEVERE.includes(v.impact as 'serious' | 'critical')
  )
  if (severe.length > 0) {
    console.error(`\n[a11y] ${label} — ${severe.length} severe violation(s):`)
    for (const v of severe) {
      console.error(`  - ${v.id} (${v.impact}): ${v.help}`)
      for (const node of v.nodes.slice(0, 3)) {
        console.error(`      ${node.target.join(' ')}`)
      }
    }
  }
  expect(severe, `${label} has serious/critical WCAG violations`).toEqual([])
}

test('a11y: login page', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel(/account id/i).waitFor({ state: 'visible' })
  await assertNoSevereA11yIssues({ page }, '/login')
})

test('a11y: admin home (/dashboard)', async ({ page }) => {
  await signOut(page)
  await signInAsStaff(page, 'admin')
  await expect(page).toHaveURL(/\/dashboard/)
  await assertNoSevereA11yIssues({ page }, '/dashboard (admin)')
})

test('a11y: doctor home', async ({ page }) => {
  await signOut(page)
  await signInAsStaff(page, 'doctor')
  await expect(page).toHaveURL(/\/doctor\/home/)
  await assertNoSevereA11yIssues({ page }, '/doctor/home')
})

test('a11y: lab tech home (/lab/jobs)', async ({ page }) => {
  await signOut(page)
  await signInAsStaff(page, 'labtech')
  await expect(page).toHaveURL(/\/lab\/jobs/)
  await assertNoSevereA11yIssues({ page }, '/lab/jobs')
})

test('a11y: trainer home', async ({ page }) => {
  await signOut(page)
  await signInAsStaff(page, 'trainer')
  await expect(page).toHaveURL(/\/trainer\/home/)
  await assertNoSevereA11yIssues({ page }, '/trainer/home')
})

test('a11y: patient home', async ({ page }) => {
  await signOut(page)
  await signInAsPatient(page)
  await expect(page).toHaveURL(/\/patient\/home/)
  await assertNoSevereA11yIssues({ page }, '/patient/home')
})
