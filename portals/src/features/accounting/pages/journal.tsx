import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getJournalEntry, type JournalEntry, listJournalEntries } from '@/lib/actions/accounting'
import { useApiQuery } from '@/lib/query'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { formatCurrency } from '@/shared/utils/currency'

// Local query keys — accounting has no matching group in `query-keys.ts`.
const JOURNAL_ENTRIES_KEY = ['accounting', 'journal-entries'] as const
const journalEntryKey = (id: string) => ['accounting', 'journal-entry', id] as const

export default function JournalPage() {
  const [openEntryId, setOpenEntryId] = useState<string | null>(null)

  const entriesQuery = useApiQuery<JournalEntry[]>(JOURNAL_ENTRIES_KEY, () => listJournalEntries())
  const entries = entriesQuery.data ?? []
  const loading = entriesQuery.isLoading
  const error = entriesQuery.isError
    ? (entriesQuery.error?.message ?? 'Failed to load journal')
    : null

  const entryQuery = useApiQuery<JournalEntry>(
    journalEntryKey(openEntryId ?? ''),
    () => getJournalEntry(openEntryId as string),
    { enabled: openEntryId !== null }
  )
  const openEntry = entryQuery.data ?? null
  const openLoading = entryQuery.isLoading

  // Surface the failure instead of silently swallowing it — otherwise the
  // dialog never opens and the user gets no feedback (remediation M28).
  useEffect(() => {
    if (openEntryId !== null && entryQuery.isError) {
      toast.error(entryQuery.error?.message ?? 'Failed to load journal entry')
    }
  }, [openEntryId, entryQuery.isError, entryQuery.error])

  function viewEntry(id: string) {
    setOpenEntryId(id)
  }

  if (loading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (error) {
    return <div className="p-6 text-red-600">{error}</div>
  }

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Journal</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {entries.length} most-recent journal entries. Every financial document writes one
            balanced entry.
          </p>
        </div>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No journal entries yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Entry #</TableHead>
              <TableHead className="w-32">Date</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-24">Reversal?</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono text-sm">{e.entryNumber}</TableCell>
                <TableCell className="text-sm">{e.entryDate}</TableCell>
                <TableCell>
                  <Badge variant="outline">{e.sourceDocType}</Badge>
                </TableCell>
                <TableCell className="text-sm">{e.description ?? '—'}</TableCell>
                <TableCell>{e.isReversal ? <Badge>reversal</Badge> : null}</TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" onClick={() => viewEntry(e.id)}>
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={openEntryId !== null} onOpenChange={(o) => !o && setOpenEntryId(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{openEntry?.entryNumber ?? 'Entry'}</DialogTitle>
            <DialogDescription>
              {openEntry?.entryDate} · {openEntry?.sourceDocType}
              {openEntry?.description ? ` · ${openEntry.description}` : ''}
            </DialogDescription>
          </DialogHeader>

          {openLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openEntry?.lines?.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>{line.lineNumber}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {line.account?.code ?? line.accountId.slice(0, 8)} —{' '}
                      <span className="font-sans">{line.account?.name ?? ''}</span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {line.partyType ? `${line.partyType}:${line.partyId?.slice(0, 8)}` : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {line.debit > 0 ? formatCurrency(line.debit) : ''}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {line.credit > 0 ? formatCurrency(line.credit) : ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
