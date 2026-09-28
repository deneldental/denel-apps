/**
 * Consent Templates — admin-v1 §18.5.
 *
 * Lists CC.4 document templates with category='consent' and lets the user
 * create a signed document instance for a specific patient. Two completion
 * modes (CC.4): digital (fill + sign in-browser) or uploaded-signed (scan).
 *
 * The legacy consent-forms page (HTML templates) remains accessible at
 * /consents/sign for backward-compat; this page covers the CC.4 PDF path.
 */

import { FileText, PenLine, Plus, Upload } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { createDocInstance, type DocTemplate, getDocTemplates } from '@/lib/actions/documents'
import { useApiQuery } from '@/lib/query'
import { PatientPicker } from '@/shared/components/patient-picker'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Skeleton } from '@/shared/components/ui/skeleton'

function UseTemplateDialog({ template, onClose }: { template: DocTemplate; onClose: () => void }) {
  const navigate = useNavigate()
  const [patientId, setPatientId] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleDigital() {
    if (!patientId) {
      toast.error('Select a patient first')
      return
    }
    setBusy(true)
    const res = await createDocInstance({
      templateId: template.id,
      subjectType: 'patient',
      subjectId: patientId,
      title: template.name,
    })
    setBusy(false)
    if (!res.success || !res.data) {
      toast.error('Failed to create document')
      return
    }
    // Navigate to the document signer in the Documents module.
    navigate(`/documents?instanceId=${res.data.id}`)
    onClose()
  }

  async function handleUpload() {
    if (!patientId) {
      toast.error('Select a patient first')
      return
    }
    setBusy(true)
    const res = await createDocInstance({
      templateId: template.id,
      subjectType: 'patient',
      subjectId: patientId,
      title: template.name,
    })
    setBusy(false)
    if (!res.success || !res.data) {
      toast.error('Failed to create document')
      return
    }
    navigate(`/documents?instanceId=${res.data.id}&mode=upload`)
    onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Use template: {template.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Patient</label>
            <PatientPicker
              value={patientId}
              onChange={(id) => setPatientId(id)}
              placeholder="Select patient…"
            />
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="w-full" disabled={busy} onClick={handleUpload}>
            <Upload className="mr-2 h-4 w-4" />
            Upload signed scan
          </Button>
          <Button className="w-full" disabled={busy || !patientId} onClick={handleDigital}>
            <PenLine className="mr-2 h-4 w-4" />
            Digital sign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function ConsentTemplatesPage() {
  const [selected, setSelected] = useState<DocTemplate | null>(null)

  // Local literal — no shared query-key group exists for the document-signing
  // engine. Same shape as `documents/components/{templates-manager,subject-documents}.tsx`.
  const { data: templates = [], isLoading: loading } = useApiQuery(
    ['documents', 'templates', 'consent'],
    () => getDocTemplates('consent')
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Consent Templates</h2>
          <p className="text-sm text-muted-foreground">
            PDF consent forms managed via the document signing engine (CC.4).
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href="/documents/templates">
            <Plus className="mr-1.5 h-4 w-4" />
            Manage templates
          </a>
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          <FileText className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">No consent templates yet.</p>
          <p className="text-xs mt-1">
            Create one in{' '}
            <a href="/documents/templates" className="underline">
              Documents → Templates
            </a>{' '}
            with category <strong>consent</strong>.
          </p>
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {templates.map((tpl) => (
            <div key={tpl.id} className="flex items-center gap-4 p-4">
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{tpl.name}</p>
                {tpl.description && (
                  <p className="text-xs text-muted-foreground truncate">{tpl.description}</p>
                )}
              </div>
              <Badge variant={tpl.isActive ? 'default' : 'secondary'}>
                {tpl.isActive ? 'Active' : 'Inactive'}
              </Badge>
              <Button size="sm" onClick={() => setSelected(tpl)}>
                <PenLine className="mr-1.5 h-3.5 w-3.5" />
                Use
              </Button>
            </div>
          ))}
        </div>
      )}

      {selected && <UseTemplateDialog template={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
