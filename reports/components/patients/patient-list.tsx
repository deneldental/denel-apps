import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { DataTable } from '@/components/data-table/data-table'
import { getTableTemplate } from '@/lib/actions/database'
import { importPatientsFromCSV } from '@/lib/actions/patients'
import { columns, type Patient } from '@/src/pages/patients/columns'

interface PatientListProps {
  data: Patient[]
}

export function PatientList({ data }: PatientListProps) {
  const navigate = useNavigate()

  const handleDownloadTemplate = async () => {
    const result = await getTableTemplate('patients')

    if (result.success && result.data) {
      // Create a blob and download it
      const blob = new Blob([result.data], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'patient-import-template.csv'
      document.body.appendChild(link)
      link.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(link)
      toast.success('Template downloaded successfully')
    } else {
      toast.error('Failed to download template')
    }
  }

  const parseCSV = (csvText: string): Array<Record<string, string>> => {
    const lines = csvText.split('\n').filter((line) => line.trim() !== '')
    if (lines.length < 2) {
      throw new Error('CSV file must have at least a header row and one data row')
    }

    // Parse header
    const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''))

    // Parse data rows
    const rows: Array<Record<string, string>> = []
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''))
      const row: Record<string, string> = {}

      headers.forEach((header, index) => {
        row[header] = values[index] || ''
      })

      rows.push(row)
    }

    return rows
  }

  const handleImportCSV = () => {
    // Create a file input element
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv'
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      try {
        const text = await file.text()
        const csvData = parseCSV(text)

        if (csvData.length === 0) {
          toast.error('CSV file is empty or invalid')
          return
        }

        toast.info(`Importing ${csvData.length} patient(s)...`)

        const result = await importPatientsFromCSV(csvData)

        if (result.error) {
          toast.error(result.error)
        } else if (result.success && result.data) {
          const { success, failed, errors } = result.data

          if (success > 0) {
            toast.success(`Successfully imported ${success} patient(s)`)
          }

          if (failed > 0) {
            const errorMessages = errors
              .slice(0, 5)
              .map((e: { row: number; error: string }) => `Row ${e.row}: ${e.error}`)
              .join('\n')
            const moreErrors = errors.length > 5 ? `\n...and ${errors.length - 5} more errors` : ''
            toast.error(`Failed to import ${failed} patient(s):\n${errorMessages}${moreErrors}`, {
              duration: 10000,
            })
          }

          // Refresh the page to show new patients
          navigate(0)
        }
      } catch (error) {
        console.error('CSV import error:', error)
        toast.error(error instanceof Error ? error.message : 'Failed to import CSV file')
      }
    }
    input.click()
  }

  // Add onRowClick handler to each patient
  const dataWithClick = data.map((patient) => ({
    ...patient,
    onRowClick: () => {
      navigate(`/patient-records/${patient.id}`)
    },
  }))

  return (
    <DataTable
      columns={columns}
      data={dataWithClick}
      onImport={handleImportCSV}
      onDownloadTemplate={handleDownloadTemplate}
      initialColumnVisibility={{
        isChild: false,
        isOrtho: false,
      }}
    />
  )
}
