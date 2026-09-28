import { Plus, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  addPettyCashStaff,
  getAvailableStaff,
  getPettyCashStaff,
  removePettyCashStaff,
} from '@/lib/actions/petty-cash'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

// No shared query-key group exists for petty-cash staff — local literals,
// module-scoped. `PETTY_STAFF_KEY` intentionally uses the same literal value
// as `petty-ref-picker.tsx`'s "staff" branch, so the two caches invalidate
// together.
const PETTY_STAFF_KEY = ['petty-cash', 'staff'] as const
const PETTY_STAFF_AVAILABLE_KEY = ['petty-cash', 'staff', 'available'] as const

/** Curated set of staff selectable in the errand petty-cash picker. */
export function PettyStaffTab() {
  const { data: rows = [], isLoading: loading } = useApiQuery(PETTY_STAFF_KEY, () =>
    getPettyCashStaff()
  )
  const [addOpen, setAddOpen] = useState(false)

  // Gated on `addOpen` — no point fetching the "who's left to add" list until
  // the dialog is actually shown.
  const { data: available = [] } = useApiQuery(
    PETTY_STAFF_AVAILABLE_KEY,
    () => getAvailableStaff(),
    { enabled: addOpen }
  )

  const addStaff = useApiMutation((staffId: string) => addPettyCashStaff(staffId), {
    invalidates: [PETTY_STAFF_KEY, PETTY_STAFF_AVAILABLE_KEY],
  })
  const removeStaff = useApiMutation((id: string) => removePettyCashStaff(id), {
    invalidates: [PETTY_STAFF_KEY],
  })
  const busy = addStaff.isPending

  function openAdd() {
    setAddOpen(true)
  }

  async function add(staffId: string) {
    try {
      await addStaff.mutateAsync(staffId)
      toast.success('Staff added')
      setAddOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add')
    }
  }

  async function remove(id: string) {
    try {
      await removeStaff.mutateAsync(id)
      toast.success('Removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove')
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold">Errand staff</h2>
          <p className="text-sm text-muted-foreground">
            Staff who can be selected when logging an errand petty expense.
          </p>
        </div>
        <Button onClick={openAdd}>
          <UserPlus className="mr-2 h-4 w-4" /> Add staff
        </Button>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          No staff added yet. Add the people who run errands.
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{r.fullName}</p>
                <p className="text-xs text-muted-foreground">
                  {[r.staffCode, r.position, r.phone].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive"
                onClick={() => remove(r.id)}
                aria-label="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add errand staff</DialogTitle>
            <DialogDescription>Pick a staff member to make them selectable.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-1 overflow-y-auto">
            {available.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                All active staff are already added.
              </p>
            ) : (
              available.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={busy}
                  onClick={() => add(s.id)}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                >
                  <span>
                    <span className="font-medium">{s.fullName}</span>
                    {s.position && (
                      <span className="ml-2 text-xs text-muted-foreground">{s.position}</span>
                    )}
                  </span>
                  <Plus className="h-4 w-4 text-muted-foreground" />
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
