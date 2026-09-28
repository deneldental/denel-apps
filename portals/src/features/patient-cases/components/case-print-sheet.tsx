import { format } from 'date-fns'
import { Printer } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '@/shared/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import type { CaseStage } from './case-detail-sheet'
import { STAGE_LABEL, StageDataView } from './stage-detail-sheet'

interface CasePrintSheetProps {
  caseData: {
    id: string
    caseNumber: string
    status: 'open' | 'closed'
    chiefComplaint: string | null
    createdAt: string
    createdBy: { id: string; name: string } | null
    stages: CaseStage[]
  }
  patientName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CasePrintSheet({ caseData, patientName, open, onOpenChange }: CasePrintSheetProps) {
  const printRef = useRef<HTMLDivElement>(null)

  function handlePrint() {
    const content = printRef.current
    if (!content) return

    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) return

    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Case ${caseData.caseNumber} — ${patientName}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #111; background: #fff; padding: 24px; }
            h1 { font-size: 20px; font-weight: 700; }
            h2 { font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin: 20px 0 8px; border-bottom: 1px solid #e5e5e5; padding-bottom: 4px; }
            .meta { color: #555; font-size: 12px; margin-top: 4px; }
            .stage { margin-bottom: 20px; border: 1px solid #e5e5e5; border-radius: 6px; overflow: hidden; }
            .stage-header { background: #f5f5f5; padding: 8px 12px; font-weight: 600; font-size: 12px; display: flex; justify-content: space-between; }
            .stage-body { padding: 12px; }
            .field-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #888; font-weight: 600; margin-bottom: 2px; }
            .field-value { font-size: 13px; white-space: pre-line; }
            .badge { display: inline-block; background: #f0f0f0; border-radius: 4px; padding: 1px 6px; font-size: 11px; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          ${content.innerHTML}
        </body>
      </html>
    `)
    win.document.close()
    win.focus()
    win.print()
    win.close()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="!w-full !max-w-[700px] !p-0 flex flex-col">
        <SheetHeader className="shrink-0 border-b px-6 pt-6 pb-4 text-left space-y-1">
          <SheetTitle>Print Case</SheetTitle>
          <SheetDescription>
            Preview and print all stages for case {caseData.caseNumber}
          </SheetDescription>
        </SheetHeader>

        {/* Scrollable preview */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div ref={printRef} className="space-y-4">
            {/* Case header */}
            <div className="border-b pb-4">
              <h1 className="text-xl font-bold font-mono">{caseData.caseNumber}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Patient: {patientName}</p>
              {caseData.chiefComplaint && <p className="text-sm mt-1">{caseData.chiefComplaint}</p>}
              <p className="text-xs text-muted-foreground mt-1">
                Created {format(new Date(caseData.createdAt), 'MMMM d, yyyy')}
                {caseData.createdBy ? ` · by ${caseData.createdBy.name}` : ''}
                {' · '}
                Status: {caseData.status === 'open' ? 'Open' : 'Closed'}
              </p>
            </div>

            {/* Stages */}
            {caseData.stages.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No stages recorded.</p>
            ) : (
              caseData.stages.map((stage) => {
                const label = STAGE_LABEL[stage.stageType] ?? stage.stageType
                return (
                  <div key={stage.id} className="border rounded-lg overflow-hidden">
                    <div className="bg-muted/40 px-4 py-2.5 flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wider">{label}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(stage.createdAt), 'MMM d, yyyy · h:mm a')}
                        {stage.createdBy ? ` · ${stage.createdBy.name}` : ''}
                      </p>
                    </div>
                    <div className="px-4 py-3">
                      <StageDataView stage={stage} />
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t bg-background px-6 py-4 flex items-center justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
