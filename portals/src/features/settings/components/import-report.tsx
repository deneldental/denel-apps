import type { ImportResult } from '@/lib/actions/database'

/**
 * What an import did: how many rows went in, how many were already there, and which rows were
 * left out with the reason. The old import skipped rows without saying so.
 */
export function ImportReport({ result }: { result: ImportResult }) {
  const skipped = result.skipped ?? []
  const skippedTotal = result.skippedTotal ?? skipped.length
  const imported = result.count ?? 0
  const existing = result.existing ?? 0

  return (
    <div className="space-y-3 text-sm" data-testid="import-report">
      <p>
        {imported === 0
          ? 'No rows were imported.'
          : `Imported ${imported} row${imported === 1 ? '' : 's'}.`}
        {existing > 0 &&
          ` ${existing} row${existing === 1 ? ' was' : 's were'} already there and left as they are.`}
      </p>
      {skippedTotal > 0 && (
        <div className="space-y-1">
          <p className="font-medium text-destructive">
            {skippedTotal} row{skippedTotal === 1 ? ' was' : 's were'} left out:
          </p>
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded border bg-muted/40 p-2 text-xs">
            {skipped.map((s) => (
              <li key={`${s.row}-${s.reason}`}>
                <span className="font-mono">Row {s.row}</span> — {s.reason}
              </li>
            ))}
            {skippedTotal > skipped.length && (
              <li className="text-muted-foreground">…and {skippedTotal - skipped.length} more.</li>
            )}
          </ul>
          <p className="text-xs text-muted-foreground">
            Row 1 is the header; the first record after it is row 2, and so on.
          </p>
        </div>
      )}
    </div>
  )
}
