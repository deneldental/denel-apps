import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Download, Loader2, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { CsvUploadDialog } from '@/features/settings/components/csv-upload-dialog'
import {
  clearAllBusinessData,
  clearTable,
  getImportableTables,
  getManageableTables,
  getTableTemplate,
} from '@/lib/actions/database'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

const TABLES_KEY = queryKeys.database.manageableTables()

export function DatabaseManagementSection() {
  const queryClient = useQueryClient()
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [selectedTable, setSelectedTable] = useState<string | null>(null)

  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [tableToClear, setTableToClear] = useState<string | null>(null)

  const [clearAllDialogOpen, setClearAllDialogOpen] = useState(false)

  const tablesQuery = useApiQuery<string[]>(TABLES_KEY, () => getManageableTables())
  const tables = tablesQuery.data ?? []
  const isLoading = tablesQuery.isLoading
  // Only the lookup tables can be loaded from a CSV (the other tables are written by their own
  // screens, which keep the ledger, patient numbers and the schedule correct).
  const importableQuery = useApiQuery<string[]>(queryKeys.database.importableTables(), () =>
    getImportableTables()
  )
  const importable = new Set(importableQuery.data ?? [])

  // A table clear or full wipe can invalidate almost any screen in the app, so
  // both mutations invalidate the whole cache rather than a specific list.
  const clearTableMutation = useApiMutation((tableName: string) => clearTable(tableName), {
    onSuccess: () => {
      void queryClient.invalidateQueries()
    },
  })
  const clearAllMutation = useApiMutation(() => clearAllBusinessData(), {
    onSuccess: () => {
      void queryClient.invalidateQueries()
    },
  })
  const isClearingAll = clearAllMutation.isPending

  const handleDownloadTemplate = async (tableName: string) => {
    const result = await getTableTemplate(tableName)
    if (result.success && result.data) {
      // Create a blob and download it
      const blob = new Blob([result.data], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${tableName}_template.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success('Template downloaded')
    } else {
      toast.error(result.error || 'Failed to generate template')
    }
  }

  const handleClearTable = async () => {
    if (!tableToClear) return
    try {
      await clearTableMutation.mutateAsync(tableToClear)
      toast.success(`Table ${tableToClear} cleared`)
      setClearDialogOpen(false)
      setTableToClear(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear table')
    }
  }

  const handleClearAll = async () => {
    try {
      await clearAllMutation.mutateAsync()
      toast.success('All business data cleared successfully')
      setClearAllDialogOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear all data')
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Database Management</CardTitle>
            <CardDescription>
              Manage database content, import data, and clear tables.
            </CardDescription>
          </div>
          <Button
            variant="destructive"
            onClick={() => setClearAllDialogOpen(true)}
            className="gap-2"
          >
            <AlertTriangle className="h-4 w-4" />
            Clear All Business Data
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Table Name</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tables.map((table) => (
                <TableRow key={table}>
                  <TableCell className="font-medium capitalize">
                    {table.replace(/_/g, ' ')}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {importable.has(table) ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownloadTemplate(table)}
                            title="Download Template"
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Template
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedTable(table)
                              setUploadDialogOpen(true)
                            }}
                            title="Upload CSV"
                          >
                            <Upload className="h-4 w-4 mr-2" />
                            Upload
                          </Button>
                        </>
                      ) : (
                        <span
                          className="self-center px-2 text-xs text-muted-foreground"
                          title="Only lookup tables can be imported from a CSV"
                        >
                          Not importable
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setTableToClear(table)
                          setClearDialogOpen(true)
                        }}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        title="Clear Table"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {selectedTable && (
        <CsvUploadDialog
          open={uploadDialogOpen}
          onOpenChange={setUploadDialogOpen}
          tableName={selectedTable}
          onSuccess={() => {
            // Optional: refresh data or show another success message
          }}
        />
      )}

      <DeleteConfirmationDialog
        open={clearDialogOpen}
        onOpenChange={setClearDialogOpen}
        onConfirm={handleClearTable}
        title={`Clear Table: ${tableToClear}`}
        description={`Are you sure you want to delete ALL records from the ${tableToClear} table? This action cannot be undone.`}
        itemName={tableToClear || 'table'}
        isLoading={false}
      />

      <DeleteConfirmationDialog
        open={clearAllDialogOpen}
        onOpenChange={setClearAllDialogOpen}
        onConfirm={handleClearAll}
        title="Clear All Business Data"
        description="WARNING: This will delete ALL business data including patients, appointments, payments, records, etc. Authentication and Admin accounts will be preserved. This action CANNOT BE UNDONE."
        itemName="ALL BUSINESS DATA"
        isLoading={isClearingAll}
      />
    </Card>
  )
}
