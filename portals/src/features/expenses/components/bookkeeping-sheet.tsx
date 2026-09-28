import { BookOpen, FileCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { type Account, listAccounts } from '@/lib/actions/accounting'
import {
  type ExpenseGLCategory,
  fileExpense,
  getExpenseGLCategories,
  getUnpostedExpenses,
  mapExpenseCategoryAccount,
  type UnpostedExpense,
} from '@/lib/actions/expense-gl'
import { Button } from '@/shared/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/shared/components/ui/sheet'
import { formatCurrency } from '@/shared/utils/currency'

/**
 * Admin-v1 Phase 4 — expense bookkeeping. Link each category to its accounting
 * bucket (auto-files the backlog) and file anything still pending.
 */
export function BookkeepingSheet() {
  const [open, setOpen] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [cats, setCats] = useState<ExpenseGLCategory[]>([])
  const [pending, setPending] = useState<UnpostedExpense[]>([])
  const [busy, setBusy] = useState(false)

  async function load() {
    const [a, c, p] = await Promise.all([
      listAccounts({ type: 'expense' }),
      getExpenseGLCategories(),
      getUnpostedExpenses(),
    ])
    if (a.success && a.data) setAccounts(a.data.filter((x) => !x.isControl))
    if (c.success && c.data) setCats(c.data)
    if (p.success && p.data) setPending(p.data)
  }

  async function map(catId: string, accountId: string) {
    setBusy(true)
    const res = await mapExpenseCategoryAccount(catId, accountId || null)
    setBusy(false)
    if (res.success) {
      const filed = (res.data as { filed?: number } | undefined)?.filed ?? 0
      toast.success(filed > 0 ? `Linked — ${filed} expense(s) filed` : 'Category linked')
      load()
    } else toast.error(res.error || 'Failed to link category')
  }

  async function file(id: string) {
    const res = await fileExpense(id)
    if (res.success && res.data?.glPosted) {
      toast.success('Filed to the books')
      load()
    } else {
      const reason = res.data?.glReason
      toast.error(
        reason === 'closed_period'
          ? 'That month is closed — reopen it first'
          : reason === 'unmapped_category'
            ? 'Link its category to a bucket first'
            : 'Could not file'
      )
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) load()
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline">
          <BookOpen className="mr-1.5 h-4 w-4" /> Bookkeeping
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Expense bookkeeping</SheetTitle>
          <SheetDescription>
            Link each category to its accounting bucket so expenses post to the books, and file
            anything still pending.
          </SheetDescription>
        </SheetHeader>

        <section className="mt-6">
          <h3 className="mb-1 text-sm font-semibold">Category → accounting bucket</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Linking a category files any backlog in it automatically.
          </p>
          <div className="rounded-lg border">
            {cats.map((cat) => (
              <div
                key={cat.id}
                className="flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
              >
                <span className="text-sm">
                  {cat.displayName || cat.name}
                  {!cat.accountId && (
                    <span className="ml-2 text-amber-600 text-xs">not linked</span>
                  )}
                </span>
                <select
                  value={cat.accountId ?? ''}
                  disabled={busy}
                  onChange={(e) => map(cat.id, e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">— not linked —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {cats.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">No categories yet.</p>
            )}
          </div>
        </section>

        <section className="mt-6">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <FileCheck className="h-4 w-4" /> Pending to file ({pending.length})
          </h3>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing pending — every expense is on the books.
            </p>
          ) : (
            <div className="rounded-lg border">
              {pending.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {p.category} · {formatCurrency(p.amount)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {new Date(p.date).toLocaleDateString()}
                      {!p.accountId ? ' · category not linked' : ' · month may be closed'}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => file(p.id)}>
                    File now
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </SheetContent>
    </Sheet>
  )
}
