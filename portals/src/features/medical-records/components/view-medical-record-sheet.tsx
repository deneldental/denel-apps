import { format } from 'date-fns'
import { Badge } from '@/shared/components/ui/badge'
import { Separator } from '@/shared/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'

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

interface ViewMedicalRecordSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: MedicalRecord | null
}

/**
 * Sliding read-only sheet for viewing a medical record. Migrated from
 * `view-medical-record-dialog.tsx` per M2.7 in ui-refinement-IP.md — records
 * can be long (complaint + examination + diagnosis + treatment + prescription
 * + notes + images) and a centered modal clips uncomfortably. A right-side
 * sheet gives full-height scroll while keeping the patient context visible
 * behind the overlay.
 */
export function ViewMedicalRecordSheet({
  open,
  onOpenChange,
  record,
}: ViewMedicalRecordSheetProps) {
  if (!record) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="!w-full !max-w-[680px] flex flex-col !p-0">
        <SheetHeader className="shrink-0 space-y-1 border-b px-6 pt-6 pb-4 text-left">
          <SheetTitle>Medical Record</SheetTitle>
          <SheetDescription>
            {format(new Date(record.date || record.createdAt), 'MMMM d, yyyy')}
            {record.doctor?.user?.name ? ` • ${record.doctor.user.name}` : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Date
                </p>
                <p className="mt-1 text-sm">
                  {format(new Date(record.date || record.createdAt), 'MMMM d, yyyy')}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Doctor
                </p>
                <p className="mt-1 text-sm">{record.doctor?.user?.name || 'Unknown'}</p>
              </div>
            </div>

            <Separator />

            {record.complaint && <Section label="Chief Complaint" body={record.complaint} />}
            {record.examination && <Section label="Examination" body={record.examination} />}
            {record.diagnosis && <Section label="Diagnosis" body={record.diagnosis} />}
            {record.treatment && <Section label="Treatment Plan" body={record.treatment} />}
            {record.prescription && <Section label="Prescription" body={record.prescription} />}
            {record.notes && <Section label="Additional Notes" body={record.notes} />}

            {record.attachments &&
              (() => {
                try {
                  const images = JSON.parse(record.attachments)
                  if (Array.isArray(images) && images.length > 0) {
                    return (
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Images
                          </p>
                          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                            {images.length}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {images.map((image: string, index: number) => (
                            <div key={index} className="relative">
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
                    )
                  }
                } catch {
                  // Invalid JSON, ignore
                }
                return null
              })()}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Section({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        {label}
      </p>
      <p className="text-sm whitespace-pre-wrap leading-relaxed">{body}</p>
    </div>
  )
}
