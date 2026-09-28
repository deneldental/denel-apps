import { AlertTriangle, Download, Loader2, Trash2, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CsvUploadDialog } from '@/components/settings/csv-upload-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteConfirmationDialog } from '@/components/ui/delete-confirmation-dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  clearAllBusinessData,
  clearTable,
  getManageableTables,
  getTableTemplate,
} from '@/lib/actions/database'

export function DatabaseManagementSection() {
  const [tables, setTables] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [selectedTable, setSelectedTable] = useState<string | null>(null)

  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [tableToClear, setTableToClear] = useState<string | null>(null)

  const [clearAllDialogOpen, setClearAllDialogOpen] = useState(false)
  const [isClearingAll, setIsClearingAll] = useState(false)

  // Initial load
  useEffect(() => {
    let active = true

    const loadTables = async () => {
      setIsLoading(true)
      const result = await getManageableTables()
      if (!active) return

      if (result.success && result.data) {
        setTables(result.data)
      } else {
        toast.error(result.error || 'Failed to load tables')
      }
      setIsLoading(false)
    }

    void Promise.resolve().then(loadTables)

    return () => {
      active = false
    }
  }, [])

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
    const result = await clearTable(tableToClear)
    if (result.success) {
      toast.success(`Table ${tableToClear} cleared`)
      setClearDialogOpen(false)
      setTableToClear(null)
    } else {
      toast.error(result.error || 'Failed to clear table')
    }
  }

  const handleClearAll = async () => {
    setIsClearingAll(true)
    const result = await clearAllBusinessData()
    if (result.success) {
      toast.success('All business data cleared successfully')
      setClearAllDialogOpen(false)
    } else {
      toast.error(result.error || 'Failed to clear all data')
    }
    setIsClearingAll(false)
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
