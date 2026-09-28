import { format } from 'date-fns'
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { MedicalRecord } from '@/features/medical-records/pages/columns'
import { deleteMedicalRecord } from '@/lib/actions/medical-records'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/shared/components/ui/breadcrumb'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import { Separator } from '@/shared/components/ui/separator'
import { usePermissions } from '@/shared/hooks/use-permissions'
import { EditMedicalRecordSheet } from './edit-medical-record-sheet'

interface DetailedMedicalRecord extends MedicalRecord {
  date?: string | Date
  createdAt: string | Date
  complaint?: string | null
  examination?: string | null
  diagnosis?: string | null
  treatment?: string | null
  prescription?: string | null
  notes?: string | null
  attachments?: string | null
  patient?: {
    name: string
  }
  doctor?: {
    user?: {
      name: string
    }
  }
  [key: string]: unknown
}

interface MedicalRecordDetailContentProps {
  record: DetailedMedicalRecord
  onReload?: () => void
}

export function MedicalRecordDetailContent({ record, onReload }: MedicalRecordDetailContentProps) {
  const navigate = useNavigate()
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const { hasPermission } = usePermissions()

  const handleDelete = async () => {
    const result = await deleteMedicalRecord(record.id)
    if (result.success) {
      toast.success('Medical record deleted successfully')
      navigate('/medical-records')
    } else {
      toast.error(result.error || 'Failed to delete medical record')
    }
  }

  const parseAttachments = () => {
    if (!record.attachments) return []
    try {
      const images = JSON.parse(record.attachments)
      return Array.isArray(images) ? images : []
    } catch {
      return []
    }
  }

  const attachments = parseAttachments()

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Breadcrumbs */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/medical-records">Medical Records</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>
              {record.patient?.name || 'Record'} -{' '}
              {format(new Date(record.date || record.createdAt), 'MMM d, yyyy')}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => navigate('/medical-records')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Medical Records
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {hasPermission('medical_records', 'update') && (
            <Button variant="outline" size="sm" onClick={() => setShowEditDialog(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
          )}
          {hasPermission('medical_records', 'delete') && (
            <Button variant="destructive" size="sm" onClick={() => setShowDeleteDialog(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Medical Record Details */}
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Date</p>
            <p className="text-lg">
              {format(new Date(record.date || record.createdAt), 'MMMM d, yyyy')}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Patient</p>
            <p className="text-lg font-medium">{record.patient?.name || 'Unknown'}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Doctor</p>
            <p className="text-lg">{record.doctor?.user?.name || 'Unknown'}</p>
          </div>
        </div>

        <Separator />

        {record.complaint && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Chief Complaint</p>
            <p className="text-sm whitespace-pre-wrap bg-muted p-4 rounded-lg">
              {record.complaint}
            </p>
          </div>
        )}

        {record.examination && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Examination</p>
            <p className="text-sm whitespace-pre-wrap bg-muted p-4 rounded-lg">
              {record.examination}
            </p>
          </div>
        )}

        {record.diagnosis && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Diagnosis</p>
            <p className="text-sm whitespace-pre-wrap bg-muted p-4 rounded-lg">
              {record.diagnosis}
            </p>
          </div>
        )}

        {record.treatment && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Treatment Plan</p>
            <p className="text-sm whitespace-pre-wrap bg-muted p-4 rounded-lg">
              {record.treatment}
            </p>
          </div>
        )}

        {record.prescription && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Prescription</p>
            <p className="text-sm whitespace-pre-wrap bg-muted p-4 rounded-lg">
              {record.prescription}
            </p>
          </div>
        )}

        {record.notes && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Additional Notes</p>
            <p className="text-sm whitespace-pre-wrap bg-muted p-4 rounded-lg">{record.notes}</p>
          </div>
        )}

        {attachments.length > 0 && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-4">Images</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {attachments.map((image: string, index: number) => (
                <div key={index} className="relative group">
                  <div className="aspect-square rounded-lg overflow-hidden border border-muted">
                    <img
                      src={image}
                      alt={`Medical record image ${index + 1}`}
                      className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => {
                        const newWindow = window.open()
                        if (newWindow) {
                          newWindow.document.write(`
                                                        <html>
                                                            <head><title>Image ${index + 1}</title></head>
                                                            <body style="margin:0;display:flex;justify-content:center;align-items:center;height:100vh;background:#000">
                                                                <img src="${image}" style="max-width:100%;max-height:100%;object-fit:contain;" />
                                                            </body>
                                                        </html>
                                                    `)
                        }
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <EditMedicalRecordSheet
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        record={record}
        onSuccess={onReload}
      />
      <DeleteConfirmationDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDelete}
        title="Delete Medical Record"
        description="Are you sure you want to delete this medical record? This action cannot be undone."
      />
    </div>
  )
}
