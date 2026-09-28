import { format } from 'date-fns'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'

interface MedicalRecord {
  id: string
  date?: string | Date
  createdAt: string | Date
  complaint?: string
  examination?: string
  diagnosis?: string
  treatment?: string
  prescription?: string
  notes?: string
  attachments?: string
  doctor?: {
    user: {
      name: string
    }
  }
}

interface ViewMedicalRecordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: MedicalRecord | null
}

export function ViewMedicalRecordDialog({
  open,
  onOpenChange,
  record,
}: ViewMedicalRecordDialogProps) {
  if (!record) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Medical Record Details</DialogTitle>
          <DialogDescription>View complete medical record information</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Date</p>
              <p className="text-sm">
                {format(new Date(record.date || record.createdAt), 'MMMM d, yyyy')}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Doctor</p>
              <p className="text-sm">{record.doctor?.user?.name || 'Unknown'}</p>
            </div>
          </div>

          <Separator />

          {record.complaint && (
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Chief Complaint</p>
              <p className="text-sm whitespace-pre-wrap">{record.complaint}</p>
            </div>
          )}

          {record.examination && (
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Examination</p>
              <p className="text-sm whitespace-pre-wrap">{record.examination}</p>
            </div>
          )}

          {record.diagnosis && (
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Diagnosis</p>
              <p className="text-sm whitespace-pre-wrap">{record.diagnosis}</p>
            </div>
          )}

          {record.treatment && (
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Treatment Plan</p>
              <p className="text-sm whitespace-pre-wrap">{record.treatment}</p>
            </div>
          )}

          {record.prescription && (
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Prescription</p>
              <p className="text-sm whitespace-pre-wrap">{record.prescription}</p>
            </div>
          )}

          {record.notes && (
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Additional Notes</p>
              <p className="text-sm whitespace-pre-wrap">{record.notes}</p>
            </div>
          )}

          {record.attachments &&
            (() => {
              try {
                const images = JSON.parse(record.attachments)
                if (Array.isArray(images) && images.length > 0) {
                  return (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">Images</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {images.map((image: string, index: number) => (
                          <div key={index} className="relative group">
                            <div className="aspect-square rounded-lg overflow-hidden border border-muted">
                              <img
                                src={image}
                                alt={`Medical record image ${index + 1}`}
                                width={200}
                                height={200}
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
                  )
                }
              } catch {
                // Invalid JSON, ignore
              }
              return null
            })()}
        </div>
      </DialogContent>
    </Dialog>
  )
}
