import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AddExpenseSheet } from '@/features/expenses/components/add-expense-sheet'
import { BookkeepingSheet } from '@/features/expenses/components/bookkeeping-sheet'
import { CsvImportDialog } from '@/features/expenses/components/csv-import-dialog'
import { ExpenseDetailContent } from '@/features/expenses/components/expense-detail-content'
import { TopExpensesCard } from '@/features/expenses/components/top-expenses-card'
import { queryKeys } from '@/lib/query-keys'
import { DataTable } from '@/shared/components/data-table/data-table'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { usePermissions } from '@/shared/hooks/use-permissions'
import { columns, type Expense } from './columns'

interface ExpensesClientProps {
  expenses: Expense[]
}

export function ExpensesClient({ expenses }: ExpensesClientProps) {
  const queryClient = useQueryClient()
  const { isAdmin } = usePermissions()
  // The open expense is remembered by id and read from the current list, so the
  // details show its latest values and attachment link (links are re-signed and
  // expire after an hour).
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null)
  const selectedExpense = selectedExpenseId
    ? (expenses.find((e) => e.id === selectedExpenseId) ?? null)
    : null
  const [showDetailSheet, setShowDetailSheet] = useState(false)

  const handleSheetOpenChange = (open: boolean) => {
    setShowDetailSheet(open)
    if (!open) setSelectedExpenseId(null)
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Expenses</h1>
          <p className="text-muted-foreground">Manage clinic operational expenses.</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && <BookkeepingSheet />}
          <CsvImportDialog />
          <AddExpenseSheet
            onSuccess={() => queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all })}
          />
        </div>
      </div>

      {isAdmin && <TopExpensesCard expenses={expenses} />}

      <DataTable
        columns={columns}
        data={expenses}
        initialColumnVisibility={{
          description: false,
        }}
        meta={{
          onRowClick: (expense: Expense) => {
            setSelectedExpenseId(expense.id)
            setShowDetailSheet(true)
          },
        }}
      />

      <Sheet open={showDetailSheet} onOpenChange={handleSheetOpenChange}>
        <SheetContent side="right" className="!w-full !max-w-[520px] overflow-y-auto">
          {selectedExpense && (
            <>
              <SheetHeader className="mb-6">
                <SheetTitle>Expense Details</SheetTitle>
                <SheetDescription>Complete information about this expense</SheetDescription>
              </SheetHeader>
              <ExpenseDetailContent
                expense={selectedExpense}
                onDeleted={() => {
                  setShowDetailSheet(false)
                  setSelectedExpenseId(null)
                  // Refresh the list to remove the deleted row.
                  queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all })
                }}
                onEdited={() => {
                  // After edit, close sheet + refresh so latest values show.
                  setShowDetailSheet(false)
                  setSelectedExpenseId(null)
                  queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all })
                }}
              />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
