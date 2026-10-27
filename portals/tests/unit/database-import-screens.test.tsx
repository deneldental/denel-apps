/**
 * The CSV import screens (F24 / D10) — see project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.12).
 *
 * The browser used to read the CSV itself, splitting every line on every comma. A quoted value such
 * as "Crown, porcelain" became two cells and its row disappeared; a row with the wrong number of
 * cells disappeared without a word; and the Settings screen offered Upload for every table, payments
 * and patients included. Now the file is sent to the server exactly as it was read, the screens show
 * what the server left out and why, and Upload is offered only for the lookup tables.
 *
 * What the server accepts, and the rows it leaves out, is pinned in
 * backend/tests/integration/database-import.test.ts and backend/tests/unit/table-import.test.ts.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DataInjectPage, { ImportSection } from '@/features/data-inject/pages'
import { CsvUploadDialog } from '@/features/settings/components/csv-upload-dialog'
import { DatabaseManagementSection } from '@/features/settings/components/database-management-section'
import { renderWithRouter } from './_test-utils'

vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn(), post: vi.fn() } }))
vi.mock('@/lib/actions/reports-injection', () => ({
  getInjectionConfigs: vi.fn(async () => ({ success: true, data: [] })),
  updateInjectionSection: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { toast } from 'sonner'
import { api } from '@/lib/api-client'

const post = vi.mocked(api.post)
const get = vi.mocked(api.get)

const ALL_TABLES = ['appointments', 'patients', 'payments', 'treatment_types', 'units']
const IMPORTABLE = ['treatment_types', 'units']

beforeEach(() => {
  vi.resetAllMocks()
  // jsdom lacks what Radix's Select reaches for
  const proto = Element.prototype as unknown as Record<string, unknown>
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => {}
  proto.releasePointerCapture ??= () => {}
  proto.scrollIntoView ??= () => {}
  get.mockImplementation((async (path: string) => {
    if (path === '/api/database/tables') return { success: true, data: ALL_TABLES }
    if (path === '/api/database/importable-tables') return { success: true, data: IMPORTABLE }
    if (path.startsWith('/api/database/template/'))
      return { success: true, data: 'name,displayName' }
    return { success: true, data: [] }
  }) as never)
})

const csvFile = (text: string, name = 'rows.csv') => new File([text], name, { type: 'text/csv' })

async function chooseFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  await userEvent.upload(input, file)
}

describe('the import dialog', () => {
  const setup = () => {
    const onOpenChange = vi.fn()
    const onSuccess = vi.fn()
    renderWithRouter(
      <CsvUploadDialog
        open
        onOpenChange={onOpenChange}
        tableName="treatment_types"
        onSuccess={onSuccess}
      />
    )
    return { onOpenChange, onSuccess }
  }

  it('sends the file to the server exactly as it was read, quoted commas and all', async () => {
    post.mockResolvedValue({
      success: true,
      count: 1,
      existing: 0,
      skipped: [],
      skippedTotal: 0,
    } as never)
    setup()
    const text = 'name,displayName\n"Crown, porcelain",Crown\n'
    await chooseFile(csvFile(text))
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(post).toHaveBeenCalledWith('/api/database/import/treatment_types', { csv: text })
  })

  it('closes when every row went in', async () => {
    post.mockResolvedValue({
      success: true,
      count: 3,
      existing: 0,
      skipped: [],
      skippedTotal: 0,
    } as never)
    const { onOpenChange, onSuccess } = setup()
    await chooseFile(csvFile('name\nA\nB\nC\n'))
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(toast.success).toHaveBeenCalledWith('Imported 3 records')
  })

  it('stays open and lists the rows that were left out, with the reasons', async () => {
    post.mockResolvedValue({
      success: true,
      count: 2,
      existing: 1,
      skippedTotal: 2,
      skipped: [
        { row: 3, reason: 'The row has 1 value but the header has 2 columns.' },
        { row: 5, reason: '"isActive" must be true or false (got "maybe").' },
      ],
    } as never)
    const { onOpenChange, onSuccess } = setup()
    await chooseFile(csvFile('name,displayName\nA,a\n'))
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }))

    const report = await screen.findByTestId('import-report')
    expect(within(report).getByText(/Imported 2 rows\./)).toBeInTheDocument()
    expect(within(report).getByText(/1 row was already there/)).toBeInTheDocument()
    expect(within(report).getByText(/2 rows were left out/)).toBeInTheDocument()
    expect(within(report).getByText('Row 3')).toBeInTheDocument()
    expect(within(report).getByText(/1 value but the header has 2 columns/)).toBeInTheDocument()
    expect(within(report).getByText(/isActive/)).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onSuccess).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('stays open and says so when the file only held rows that were already there', async () => {
    post.mockResolvedValue({
      success: true,
      count: 0,
      existing: 3,
      skipped: [],
      skippedTotal: 0,
    } as never)
    const { onOpenChange, onSuccess } = setup()
    await chooseFile(csvFile('name\nA\nB\nC\n'))
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }))

    const report = await screen.findByTestId('import-report')
    expect(within(report).getByText(/No rows were imported\./)).toBeInTheDocument()
    expect(within(report).getByText(/3 rows were already there/)).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onSuccess).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('says how many more were left out than it lists', async () => {
    post.mockResolvedValue({
      success: true,
      count: 0,
      skippedTotal: 450,
      skipped: Array.from({ length: 200 }, (_, i) => ({ row: i + 2, reason: 'bad' })),
    } as never)
    setup()
    await chooseFile(csvFile('name\nA\n'))
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }))
    expect(await screen.findByText(/and 250 more/)).toBeInTheDocument()
  })

  it('shows the reasons when the whole import was refused', async () => {
    post.mockResolvedValue({
      success: false,
      error: 'No rows could be imported: every row was left out.',
      skippedTotal: 1,
      skipped: [{ row: 2, reason: '"name" is required.' }],
    } as never)
    const { onSuccess } = setup()
    await chooseFile(csvFile('name\n\n'))
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }))
    expect(await screen.findByText(/"name" is required/)).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('refuses a file over the 1 MB the server reads', async () => {
    setup()
    const big = new File([new Uint8Array(1024 * 1024 + 1)], 'big.csv', { type: 'text/csv' })
    await chooseFile(big)
    expect(toast.error).toHaveBeenCalledWith(
      'File exceeds the 1 MB limit. Please use a smaller CSV.'
    )
    expect(post).not.toHaveBeenCalled()
  })
})

describe('Settings → Database management', () => {
  it('offers Upload and Template only for the lookup tables', async () => {
    renderWithRouter(<DatabaseManagementSection />)

    for (const table of ALL_TABLES) {
      await screen.findByText(table.replace(/_/g, ' '))
    }
    const rowOf = (table: string) =>
      screen.getByText(table.replace(/_/g, ' ')).closest('tr') as HTMLElement

    for (const table of IMPORTABLE) {
      expect(within(rowOf(table)).getByTitle('Upload CSV')).toBeInTheDocument()
      expect(within(rowOf(table)).getByTitle('Download Template')).toBeInTheDocument()
    }
    for (const table of ['appointments', 'patients', 'payments']) {
      expect(within(rowOf(table)).queryByTitle('Upload CSV')).not.toBeInTheDocument()
      expect(within(rowOf(table)).queryByTitle('Download Template')).not.toBeInTheDocument()
      expect(within(rowOf(table)).getByText('Not importable')).toBeInTheDocument()
      // clearing a table is a different feature and stays where it was
      expect(within(rowOf(table)).getByTitle('Clear Table')).toBeInTheDocument()
    }
  })
})

describe('Data Inject → Import CSV', () => {
  it('on the page itself, the import target list is the importable tables, not every table', async () => {
    renderWithRouter(<DataInjectPage />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Data' }))
    // the export side of the same tab does list every table; the import side must not
    const [importTarget] = await screen.findAllByRole('combobox') // the import card comes first
    await userEvent.click(importTarget)
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Treatment Types', 'Units'])
  })

  it('offers only the importable tables as a target', async () => {
    renderWithRouter(<ImportSection tables={IMPORTABLE} />)
    await userEvent.click(screen.getByRole('combobox'))
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Treatment Types', 'Units'])
  })

  it('imports through the same action and reports what was left out', async () => {
    post.mockResolvedValue({
      success: true,
      count: 1,
      skippedTotal: 1,
      skipped: [{ row: 3, reason: 'The row has 1 value but the header has 2 columns.' }],
    } as never)
    renderWithRouter(<ImportSection tables={IMPORTABLE} />)
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(await screen.findByRole('option', { name: 'Units' }))
    const text = 'name,displayName\n"Box, large",Box\nbag\n'
    await userEvent.upload(
      document.getElementById('csv-import-input') as HTMLInputElement,
      csvFile(text)
    )
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }))

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/database/import/units', { csv: text })
    )
    expect(await screen.findByTestId('import-report')).toHaveTextContent('Row 3')
  })
})
