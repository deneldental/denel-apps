/**
 * The shared DataTable under a background refetch. A private file's link is
 * re-signed every 15 minutes, so a refetch hands the table new row objects
 * even when nothing changed. The user must stay on their page, and a row's own
 * state (an open actions menu or edit sheet) must stay with its record.
 */
import type { ColumnDef } from '@tanstack/react-table'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { DataTable } from '@/shared/components/data-table/data-table'

type Row = { id: string; name: string; photo: string }

function Toggle({ name }: { name: string }) {
  const [open, setOpen] = useState(false)
  return (
    <button type="button" onClick={() => setOpen(true)}>
      {open ? `${name} open` : `open ${name}`}
    </button>
  )
}

const COLUMNS: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'name', header: 'Name' },
  { id: 'actions', cell: ({ row }) => <Toggle name={row.original.name} /> },
]

/** Let the table's queued follow-up work (it resets the page after a change) run. */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })

const rows = (window: string, names = Array.from({ length: 25 }, (_, i) => `Item ${i + 1}`)) =>
  names.map((name) => ({
    id: `id-${name}`,
    name,
    photo: `https://x/${name}.jpg?X-Amz-Date=20260927T${window}00Z`,
  }))

describe('DataTable after a refetch', () => {
  it('stays on the page the user was on', async () => {
    const { rerender } = render(<DataTable columns={COLUMNS} data={rows('1000')} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /go to next page/i }))
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()

    rerender(<DataTable columns={COLUMNS} data={rows('1015')} />)
    await settle()

    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
  })

  it('goes back to the first page when the user filters', async () => {
    render(<DataTable columns={COLUMNS} data={rows('1000')} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /go to next page/i }))

    fireEvent.change(screen.getByPlaceholderText(/filter/i), { target: { value: 'Item 1' } })
    await settle()

    expect(screen.getByText(/^Page 1 of/)).toBeInTheDocument()
  })

  it('moves to the last page left when the list shrinks', async () => {
    const { rerender } = render(<DataTable columns={COLUMNS} data={rows('1000')} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /go to last page/i }))
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()

    rerender(<DataTable columns={COLUMNS} data={rows('1015').slice(0, 12)} />)
    await settle()

    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
  })

  it("keeps a row's open state with its record when the rows come back reordered", async () => {
    const names = ['Alpha', 'Bravo', 'Charlie']
    const { rerender } = render(<DataTable columns={COLUMNS} data={rows('1000', names)} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'open Bravo' }))
    expect(screen.getByRole('button', { name: 'Bravo open' })).toBeInTheDocument()

    rerender(<DataTable columns={COLUMNS} data={rows('1015', ['Charlie', 'Alpha', 'Bravo'])} />)
    await settle()

    expect(screen.getByRole('button', { name: 'Bravo open' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'open Charlie' })).toBeInTheDocument()
  })
})

describe('DataTable rows without unique ids', () => {
  it('still renders every row when two share an id', async () => {
    const data = [
      { id: 'same', name: 'First', photo: '' },
      { id: 'same', name: 'Second', photo: '' },
    ]
    render(<DataTable columns={COLUMNS} data={data} />)
    await settle()

    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })
})
