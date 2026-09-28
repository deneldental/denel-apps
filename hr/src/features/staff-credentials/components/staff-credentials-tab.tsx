import {
  Button,
  DeleteConfirmationDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  Switch,
  Textarea,
} from '@denel/ui'
import { differenceInDays, format } from 'date-fns'
import {
  AlertCircle,
  Download,
  FileText,
  Loader2,
  Pencil,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { verifyCredential } from '@/lib/actions/hr-phase2-4'
import { uploadFile } from '@/lib/actions/upload'
import { api } from '@/lib/api-client'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { StatusBadge } from '@/shared/components/status-badge'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'

type Credential = {
  id: string
  staffId: string
  credentialType: string
  credentialName: string
  issuingBody: string | null
  issueDate: string | null
  expiryDate: string | null
  documentUrl: string | null
  notes: string | null
  reminderDaysBefore: number | null
  reminderEnabled: boolean
  verifiedAt?: string | null
  verificationMethod?: string | null
  suspendedDueToLapse?: boolean
}

const VERIFICATION_METHODS: Array<{
  value: 'manual_check' | 'phone_to_issuer' | 'online_registry' | 'document_only'
  label: string
}> = [
  { value: 'manual_check', label: 'Manual check' },
  { value: 'phone_to_issuer', label: 'Phoned the issuer' },
  { value: 'online_registry', label: 'Online registry' },
  { value: 'document_only', label: 'Document only' },
]

interface Props {
  staffId: string
}

export function StaffCredentialsTab({ staffId }: Props) {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Credential | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Credential | null>(null)
  const [verifyTarget, setVerifyTarget] = useState<Credential | null>(null)
  const [verifyMethod, setVerifyMethod] =
    useState<(typeof VERIFICATION_METHODS)[number]['value']>('manual_check')
  const [verifyNotes, setVerifyNotes] = useState('')
  const [verifying, setVerifying] = useState(false)

  async function handleVerify() {
    if (!verifyTarget) return
    setVerifying(true)
    const res = await verifyCredential(verifyTarget.id, {
      method: verifyMethod,
      notes: verifyNotes || undefined,
    })
    setVerifying(false)
    if (!res.success) {
      surfaceApiError(res, 'Failed to record verification')
      return
    }
    toast.success(`${verifyTarget.credentialName} marked verified.`)
    setVerifyTarget(null)
    setVerifyMethod('manual_check')
    setVerifyNotes('')
    void load()
  }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<Credential[]>(`/api/staff-credentials?staffId=${staffId}`)
    if (res.success && res.data) setCredentials(res.data)
    setLoading(false)
  }, [staffId])

  useEffect(() => {
    load()
  }, [load])

  async function confirmDelete() {
    if (!deleteTarget) return
    const res = await api.delete(`/api/staff-credentials/${deleteTarget.id}`)
    if (res.success) {
      toast.success('Deleted')
      setDeleteTarget(null)
      load()
    } else {
      toast.error(res.error || 'Delete failed')
    }
  }

  function statusFor(c: Credential) {
    if (!c.expiryDate) return { label: 'No expiry', tone: 'muted' as const }
    const days = differenceInDays(new Date(c.expiryDate), new Date())
    if (days < 0) return { label: 'Expired', tone: 'danger' as const }
    if (days <= (c.reminderDaysBefore ?? 30))
      return { label: `Expiring in ${days}d`, tone: 'warning' as const }
    return { label: 'Valid', tone: 'success' as const }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Credentials & Licenses</h3>
          <p className="text-xs text-muted-foreground">
            Track licenses, certifications, and regulatory documents.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Credential
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : credentials.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center">
          <ShieldCheck className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No credentials recorded.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {credentials.map((c) => {
            const status = statusFor(c)
            return (
              <div key={c.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-semibold text-sm">{c.credentialName}</h4>
                      <StatusBadge
                        tone={status.tone === 'muted' ? 'neutral' : status.tone}
                        className="gap-1 text-[10px] normal-case"
                      >
                        {status.tone === 'danger' && <AlertCircle className="h-3 w-3" />}
                        {status.label}
                      </StatusBadge>
                      {c.verifiedAt && (
                        <StatusBadge tone="success" className="gap-1 text-[10px]">
                          <ShieldCheck className="h-2.5 w-2.5" />
                          Verified
                        </StatusBadge>
                      )}
                      {c.suspendedDueToLapse && (
                        <StatusBadge tone="danger" className="gap-1 text-[10px]">
                          <ShieldAlert className="h-2.5 w-2.5" />
                          Auto-suspended
                        </StatusBadge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {c.credentialType}
                      {c.issuingBody && ` · ${c.issuingBody}`}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 text-xs">
                      {c.issueDate && (
                        <span className="text-muted-foreground">
                          Issued: {(() => {
                            try {
                              return format(new Date(c.issueDate), 'MMM d, yyyy')
                            } catch {
                              return '—'
                            }
                          })()}
                        </span>
                      )}
                      {c.expiryDate && (
                        <span className="text-muted-foreground">
                          Expires: {(() => {
                            try {
                              return format(new Date(c.expiryDate), 'MMM d, yyyy')
                            } catch {
                              return '—'
                            }
                          })()}
                        </span>
                      )}
                    </div>
                    {c.notes && <p className="text-xs text-muted-foreground mt-1">{c.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    {c.documentUrl && (
                      <a
                        href={c.documentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted text-muted-foreground"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {!c.verifiedAt && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-emerald-600"
                        title="Verify credential"
                        onClick={() => {
                          setVerifyMethod('manual_check')
                          setVerifyNotes('')
                          setVerifyTarget(c)
                        }}
                        aria-label="Confirm"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setEditing(c)
                        setOpen(true)
                      }}
                      aria-label="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => setDeleteTarget(c)}
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <CredentialFormDialog
        open={open}
        onOpenChange={setOpen}
        staffId={staffId}
        credential={editing}
        onSaved={() => {
          setOpen(false)
          load()
        }}
      />

      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete credential?"
        description="The credential record will be permanently removed."
        itemName={deleteTarget?.credentialName}
      />

      {/* ── Verify dialog (Phase 3D) ─────────────────────────────────────── */}
      <Dialog
        open={!!verifyTarget}
        onOpenChange={(o) => {
          if (!o) {
            setVerifyTarget(null)
            setVerifyNotes('')
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Verify {verifyTarget?.credentialName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Record who checked this credential and how. Surfaces on the regulator-facing
              compliance export.
            </p>
            <div className="space-y-1.5">
              <Label>Method</Label>
              <RadioGroup
                value={verifyMethod}
                onValueChange={(v) =>
                  setVerifyMethod(v as (typeof VERIFICATION_METHODS)[number]['value'])
                }
                className="flex flex-wrap gap-2"
              >
                {VERIFICATION_METHODS.map((m) => (
                  <div key={m.value} className="flex items-center gap-1.5">
                    <RadioGroupItem value={m.value} id={`verify-method-${m.value}`} />
                    <Label
                      htmlFor={`verify-method-${m.value}`}
                      className="text-xs font-normal cursor-pointer"
                    >
                      {m.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="verify-notes">Notes</Label>
              <Textarea
                id="verify-notes"
                rows={2}
                value={verifyNotes}
                onChange={(e) => setVerifyNotes(e.target.value)}
                placeholder="Optional — who you spoke with, registry URL, etc."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVerifyTarget(null)} disabled={verifying}>
              Cancel
            </Button>
            <Button onClick={handleVerify} disabled={verifying}>
              {verifying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Recording…
                </>
              ) : (
                'Mark verified'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CredentialFormDialog({
  open,
  onOpenChange,
  staffId,
  credential,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  staffId: string
  credential: Credential | null
  onSaved: () => void
}) {
  const [credentialType, setCredentialType] = useState(credential?.credentialType ?? '')
  const [credentialName, setCredentialName] = useState(credential?.credentialName ?? '')
  const [issuingBody, setIssuingBody] = useState(credential?.issuingBody ?? '')
  const [issueDate, setIssueDate] = useState(credential?.issueDate?.slice(0, 10) ?? '')
  const [expiryDate, setExpiryDate] = useState(credential?.expiryDate?.slice(0, 10) ?? '')
  const [reminderDaysBefore, setReminderDaysBefore] = useState(
    credential?.reminderDaysBefore?.toString() ?? '60'
  )
  const [reminderEnabled, setReminderEnabled] = useState(credential?.reminderEnabled ?? true)
  const [notes, setNotes] = useState(credential?.notes ?? '')
  const [documentUrl, setDocumentUrl] = useState(credential?.documentUrl ?? '')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const { isSubmitting, submit } = useSubmitGuard()

  // Detect dirty state: any field differs from the saved credential (or non-empty for new)
  const isDirty =
    credentialType !== (credential?.credentialType ?? '') ||
    credentialName !== (credential?.credentialName ?? '') ||
    issuingBody !== (credential?.issuingBody ?? '') ||
    issueDate !== (credential?.issueDate?.slice(0, 10) ?? '') ||
    expiryDate !== (credential?.expiryDate?.slice(0, 10) ?? '') ||
    reminderDaysBefore !== (credential?.reminderDaysBefore?.toString() ?? '60') ||
    reminderEnabled !== (credential?.reminderEnabled ?? true) ||
    notes !== (credential?.notes ?? '') ||
    documentUrl !== (credential?.documentUrl ?? '')

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => onOpenChange(false),
  })

  useEffect(() => {
    if (open) {
      setCredentialType(credential?.credentialType ?? '')
      setCredentialName(credential?.credentialName ?? '')
      setIssuingBody(credential?.issuingBody ?? '')
      setIssueDate(credential?.issueDate?.slice(0, 10) ?? '')
      setExpiryDate(credential?.expiryDate?.slice(0, 10) ?? '')
      setReminderDaysBefore(credential?.reminderDaysBefore?.toString() ?? '60')
      setReminderEnabled(credential?.reminderEnabled ?? true)
      setNotes(credential?.notes ?? '')
      setDocumentUrl(credential?.documentUrl ?? '')
    }
  }, [open, credential])

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const up = await uploadFile(file, {
      folder: 'credentials',
      subfolder: staffId,
      profile: 'imageOrPdf',
    })
    setUploading(false)
    if (up.success && up.url) {
      setDocumentUrl(up.url)
      toast.success('Document uploaded')
    } else {
      toast.error(up.error || 'Upload failed')
    }
    e.target.value = ''
  }

  function save() {
    void submit(async () => {
      if (!credentialType.trim() || !credentialName.trim()) {
        toast.error('Type and name are required')
        return
      }
      if (issueDate && expiryDate && new Date(issueDate) > new Date(expiryDate)) {
        toast.error('Issue date must not be after expiry date')
        return
      }
      const parsed = parseInt(reminderDaysBefore, 10)
      const reminderDaysBeforeNum = Number.isNaN(parsed) ? null : parsed
      if (reminderEnabled && reminderDaysBeforeNum !== null && reminderDaysBeforeNum < 1) {
        toast.error('Days before expiry must be at least 1')
        return
      }
      const basePayload = {
        credentialType: credentialType.trim(),
        credentialName: credentialName.trim(),
        issuingBody: issuingBody || null,
        issueDate: issueDate || null,
        expiryDate: expiryDate || null,
        documentUrl: documentUrl || null,
        notes: notes || null,
        reminderDaysBefore: reminderDaysBeforeNum,
        reminderEnabled,
      }
      const res = credential
        ? await api.patch(`/api/staff-credentials/${credential.id}`, basePayload)
        : await api.post('/api/staff-credentials', { staffId, ...basePayload })
      if (res.success) {
        toast.success(credential ? 'Updated' : 'Added')
        onSaved()
      } else {
        surfaceApiError(res, 'Failed')
      }
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={guardedOnOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{credential ? 'Edit' : 'Add'} Credential</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cred-type">Type</Label>
                <Input
                  id="cred-type"
                  value={credentialType}
                  onChange={(e) => setCredentialType(e.target.value)}
                  placeholder="e.g. License, Certification"
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cred-name">Name</Label>
                <Input
                  id="cred-name"
                  value={credentialName}
                  onChange={(e) => setCredentialName(e.target.value)}
                  placeholder="Dental Council License"
                  maxLength={200}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cred-issuing-body">Issuing Body</Label>
              <Input
                id="cred-issuing-body"
                value={issuingBody}
                onChange={(e) => setIssuingBody(e.target.value)}
                placeholder="e.g. Dental Council of Ghana"
                maxLength={200}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cred-issue-date">Issue Date</Label>
                <Input
                  id="cred-issue-date"
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cred-expiry-date">Expiry Date</Label>
                <Input
                  id="cred-expiry-date"
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <span className="text-xs">Reminders</span>
                <Switch checked={reminderEnabled} onCheckedChange={setReminderEnabled} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cred-reminder-days" className="text-xs">
                  Days before expiry
                </Label>
                <Input
                  id="cred-reminder-days"
                  type="number"
                  min={1}
                  value={reminderDaysBefore}
                  onChange={(e) => setReminderDaysBefore(e.target.value)}
                  disabled={!reminderEnabled}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Document (optional)</Label>
              <input ref={fileRef} type="file" className="hidden" onChange={handleFileUpload} />
              {documentUrl ? (
                <div className="rounded-md border border-border px-3 py-2 flex items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <a
                    href={documentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm truncate flex-1 hover:underline"
                  >
                    View document
                  </a>
                  <Button size="sm" variant="ghost" onClick={() => setDocumentUrl('')}>
                    Remove
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="w-full justify-start"
                >
                  {uploading ? 'Uploading…' : 'Upload document'}
                </Button>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cred-notes">Notes</Label>
              <Textarea
                id="cred-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={1000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => guardedOnOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={isSubmitting || uploading}>
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
