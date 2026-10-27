/**
 * F06 — every in-app ortho-consent link uses the canonical URL. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (Step 5).
 *
 * The list's row click and its View action navigated to the legacy
 * `/ortho-consent/:id`, and the detail page's "not found" and the viewer's Back went
 * to the legacy `/ortho-consent`. Each hop went through a redirect (and, with the
 * old redirect, lost the record). They now go straight to `/consents/ortho…`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/ortho-consent', () => ({
  getOrthoConsentForms: vi.fn(),
  deleteConsentForm: vi.fn(),
  uploadConsentForm: vi.fn(),
}))
vi.mock('@/lib/loading-context', () => ({ useLoading: () => ({ setIsLoading: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/features/ortho-consent/components/upload-consent-dialog', () => ({
  UploadConsentDialog: () => null,
}))

import OrthoConsentDetailPage from '@/features/ortho-consent/pages/detail'
import { OrthoConsentContent } from '@/features/ortho-consent/pages/ortho-consent-content'
import { getOrthoConsentForms } from '@/lib/actions/ortho-consent'
import { renderWithRouter } from './_test-utils'

afterEach(() => vi.resetAllMocks())

function Where() {
  const { pathname } = useLocation()
  return <output data-testid="where">{pathname}</output>
}
const where = () => screen.getByTestId('where').textContent

const row = {
  id: 'row-1',
  patientId: 'DD-0001',
  name: 'Ama Mensah',
  phone: '0240000001',
  email: null,
  profileImage: null,
  consentFormId: null,
  consentFormUrl: null,
  status: 'pending',
  uploadedAt: null,
  notes: null,
  createdAt: new Date('2026-10-20T09:00:00Z'),
}

describe('Ortho consent list', () => {
  it('opens a record on the canonical URL when its row is clicked', async () => {
    const user = userEvent.setup()
    renderWithRouter(
      <>
        <OrthoConsentContent consentForms={[row]} onReload={() => {}} />
        <Where />
      </>,
      { initialRoute: '/consents/ortho' }
    )

    await user.click(screen.getByText('Ama Mensah'))

    expect(where()).toBe('/consents/ortho/row-1')
  })

  it('opens it on the canonical URL from the View action too', async () => {
    const user = userEvent.setup()
    renderWithRouter(
      <>
        <OrthoConsentContent consentForms={[row]} onReload={() => {}} />
        <Where />
      </>,
      { initialRoute: '/consents/ortho' }
    )

    await user.click(screen.getByTitle(/view consent form page/i))

    expect(where()).toBe('/consents/ortho/row-1')
  })
})

describe('Ortho consent detail page', () => {
  it('returns to the canonical list when the record is not found', async () => {
    vi.mocked(getOrthoConsentForms).mockResolvedValue({ success: true, data: [] } as never)
    renderWithRouter(
      <>
        <Routes>
          <Route path="/consents/ortho/:patientId" element={<OrthoConsentDetailPage />} />
          <Route path="/consents/ortho" element={<div>list</div>} />
        </Routes>
        <Where />
      </>,
      { initialRoute: '/consents/ortho/missing' }
    )

    await waitFor(() => expect(where()).toBe('/consents/ortho'))
  })
})

describe('no in-app ortho-consent link goes through the legacy URL', () => {
  // The viewer's Back button is too heavy to render here, so read the sources: the
  // only places allowed to mention the legacy path are the redirect table and the
  // permission map (which must keep guarding the old URL).
  const src = resolve(__dirname, '../../src')
  const allowed = new Set([
    join(src, 'app', 'modules', 'consent-management.tsx'),
    join(src, 'app', 'route-access.ts'),
    join(src, 'lib', 'menu.ts'),
  ])
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name)
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : []
    })
  }

  it('finds no navigate() or link to /ortho-consent outside the redirect table', () => {
    const offenders: string[] = []
    for (const file of walk(src)) {
      if (allowed.has(file)) continue
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/(navigate\(|to=|href=)\s*[{(]?\s*[`'"]\/ortho-consent/g)) {
        offenders.push(`${file.replace(src, 'src')}: ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
