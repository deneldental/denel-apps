import { Download, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, postStream, readSSE } from '@/lib/api-client'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { useConfirm } from '@/shared/hooks/use-confirm'

export function DataManagementSection() {
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  /** 0-100 while an import streams; null when idle. */
  const [progress, setProgress] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { confirm, confirmDialog } = useConfirm()

  const handleExport = async () => {
    try {
      setIsExporting(true)
      const res = await api.get<Record<string, any>>('/api/settings/export')

      if (!res.success) {
        toast.error('Failed to export settings')
        return
      }

      const jsonString = JSON.stringify(res.data, null, 2)
      const blob = new Blob([jsonString], { type: 'application/json' })
      const url = URL.createObjectURL(blob)

      const link = document.createElement('a')
      link.href = url
      link.download = `denel-settings-export-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(link)
      link.click()

      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast.success('Settings exported successfully')
    } catch (err) {
      console.error(err)
      toast.error('An error occurred during export')
    } finally {
      setIsExporting(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (
      !(await confirm({
        title: 'Import Settings',
        description:
          'Are you sure you want to import settings? This may overwrite your current configuration.',
        confirmLabel: 'Import',
        tone: 'destructive',
      }))
    ) {
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      return
    }

    try {
      setIsImporting(true)
      const text = await file.text()
      const data = JSON.parse(text)

      setProgress(0)
      const response = await postStream('/api/settings/import/stream', { data })

      // A non-2xx never opens a stream — auth/validation failures come back as
      // ordinary JSON, so read them as such instead of waiting on frames.
      if (!response.ok) {
        const err = await response.json().catch(() => null)
        toast.error(err?.error || `Import failed (${response.status})`)
        return
      }

      type DonePayload = {
        success: boolean
        imported: number
        failures: Array<{ table: string; row: string; error: string }>
      }
      let done: DonePayload | null = null
      let streamError: string | null = null

      await readSSE(response, (event, payload) => {
        if (event === 'progress') {
          const p = JSON.parse(payload) as { percent: number }
          setProgress(p.percent)
        } else if (event === 'done') {
          done = JSON.parse(payload) as DonePayload
        } else if (event === 'error') {
          streamError = (JSON.parse(payload) as { error: string }).error
        }
      })

      if (streamError) {
        toast.error(streamError)
        return
      }
      // The stream closing without a terminal event means the connection dropped
      // mid-import; claiming success there would be a lie.
      if (!done) {
        toast.error('Import ended unexpectedly — the result is unknown. Re-run to be sure.')
        return
      }

      const result = done as DonePayload
      setProgress(100)
      if (result.success) {
        toast.success(
          `Imported ${result.imported} row${result.imported === 1 ? '' : 's'}. Reload the page to see changes.`
        )
      } else {
        const first = result.failures[0]
        toast.error(
          `${result.failures.length} row(s) failed — e.g. ${first.table} "${first.row}": ${first.error}`
        )
        console.error('[settings import] failures:', result.failures)
      }
    } catch (err) {
      console.error(err)
      toast.error('Invalid JSON file or an error occurred during import')
    } finally {
      setIsImporting(false)
      setProgress(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">Data Management</h2>
        <p className="text-sm text-muted-foreground">
          Import and export your system configurations and lookups.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Export Settings</CardTitle>
            <CardDescription>
              Download a JSON file with the clinic settings and every Settings-managed lookup
              (types, tags, categories, statuses, SMS templates, holidays). Integration secrets are
              never included; appointment reminder stages and tax configurations are not either.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleExport} disabled={isExporting}>
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? 'Exporting...' : 'Export Configurations'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Import Settings</CardTitle>
            <CardDescription>
              Upload a previously exported JSON file to restore settings. This will merge with
              existing data, updating matching records.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileChange}
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
            >
              <Upload className="mr-2 h-4 w-4" />
              {isImporting ? `Importing… ${progress ?? 0}%` : 'Import Configurations'}
            </Button>
          </CardContent>
        </Card>
      </div>
      {confirmDialog}
    </div>
  )
}
