import { NavCard } from '@denel/ui/blocks'
import { format } from 'date-fns'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardList,
  Loader2,
  Phone,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { labApi } from '@/lib/api'

interface LabCaseDetail {
  id: string
  caseNumber: string
  serviceName: string
  status: string
  expectedReturn: string | null
  notes: string | null
  delayReason: string | null
  shade: string | null
  toothNumbers: number[]
  patient: { id: string; name: string; phone?: string | null; doNotContact?: boolean | null } | null
}

interface StageConfig {
  id: string
  name: string
  displayName: string
  isActive: boolean
  smsTemplate: string | null
}

interface HistoryRow {
  id: string
  fromStatus: string | null
  toStatus: string
  source: string | null
  createdAt: string
  byName: string | null
  byRole: string | null
}

const STEP_LABELS: Record<string, string> = {
  draft: 'Ordered',
  sent: 'Dispatched',
  in_progress: 'In Progress',
  received: 'Shipped',
  ready_for_insertion: 'Ready',
  delayed: 'Delayed',
  cancelled: 'Cancelled',
  inserted: 'Inserted',
}

const TECH_STAGES = [
  'draft',
  'sent',
  'in_progress',
  'received',
  'ready_for_insertion',
  'delayed',
  'cancelled',
] as const

const LINEAR_ORDER = ['draft', 'sent', 'in_progress', 'received', 'ready_for_insertion']
const HISTORY_PAGE = 8

function normalizeCase(raw: LabCaseDetail): LabCaseDetail {
  return { ...raw, toothNumbers: raw.toothNumbers ?? [] }
}

function daysLeft(expectedReturn: string | null): { text: string; overdue: boolean } | null {
  if (!expectedReturn) return null
  const diff = Math.round((new Date(expectedReturn).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  if (diff < 0)
    return {
      text: `${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'} overdue`,
      overdue: true,
    }
  if (diff === 0) return { text: 'Due today', overdue: false }
  return { text: `${diff} day${diff === 1 ? '' : 's'} left`, overdue: false }
}

function toDateInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

export default function LabJobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const seededRef = useRef(false)

  const [caseData, setCaseData] = useState<LabCaseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [stages, setStages] = useState<StageConfig[]>([])

  // Update-modal form state (nothing saved until Submit).
  const [updateOpen, setUpdateOpen] = useState(false)
  const [selectedStatus, setSelectedStatus] = useState('')
  const [notesValue, setNotesValue] = useState('')
  const [delayDate, setDelayDate] = useState('')
  const [delayReason, setDelayReason] = useState('')
  const [sendSms, setSendSms] = useState(false)
  const [previewMessage, setPreviewMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Status-history table.
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(0)

  const loadHistory = useCallback(
    async (page: number) => {
      if (!id) return
      const res = await labApi.getStatusHistory(id, HISTORY_PAGE, page * HISTORY_PAGE)
      if (res.success && Array.isArray(res.data)) {
        setHistory(res.data as HistoryRow[])
        setHistoryTotal(typeof res.total === 'number' ? res.total : 0)
        setHistoryPage(page)
      }
    },
    [id]
  )

  useEffect(() => {
    if (!id) return
    labApi
      .getCase(id)
      .then((res) => {
        if (res.success && res.data) {
          const d = normalizeCase(res.data as LabCaseDetail)
          setCaseData(d)
          if (!seededRef.current) {
            setNotesValue(d.notes ?? '')
            seededRef.current = true
          }
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  useEffect(() => {
    labApi.getCaseStatuses().then((res) => {
      if (res.success && Array.isArray(res.data)) setStages(res.data as StageConfig[])
    })
    loadHistory(0)
  }, [loadHistory])

  const stageByName = (name: string): StageConfig | undefined => stages.find((s) => s.name === name)
  const stageLabel = (name: string): string =>
    stageByName(name)?.displayName ?? STEP_LABELS[name] ?? name.replace(/_/g, ' ')

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!caseData) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <p className="mt-4 text-center text-sm text-muted-foreground">Case not found.</p>
      </div>
    )
  }

  const isDelayed = selectedStatus === 'delayed'
  const canSms = !!stageByName(selectedStatus)?.smsTemplate
  const statusChanged = selectedStatus !== caseData.status
  const notesChanged = (notesValue ?? '') !== (caseData.notes ?? '')
  const delayIncomplete = isDelayed && (!delayDate || !delayReason.trim())
  const dirty = statusChanged || notesChanged
  const offerStages = TECH_STAGES.filter((n) =>
    stages.length ? stages.some((s) => s.name === n && s.isActive) : true
  )
  const currentLinearIdx = LINEAR_ORDER.indexOf(caseData.status)
  const dl = daysLeft(caseData.expectedReturn)
  const isTerminal = caseData.status === 'inserted' || caseData.status === 'cancelled'

  function openUpdate() {
    if (!caseData) return
    setSelectedStatus(caseData.status)
    setNotesValue(caseData.notes ?? '')
    setDelayReason(caseData.delayReason ?? '')
    setDelayDate(toDateInput(caseData.expectedReturn))
    setSendSms(false)
    setPreviewMessage(null)
    setUpdateOpen(true)
  }

  async function togglePreview() {
    if (!id) return
    if (previewMessage) {
      setPreviewMessage(null)
      return
    }
    const res = await labApi.smsPreview(id, selectedStatus)
    if (res.success && res.data?.hasTemplate && res.data.message)
      setPreviewMessage(res.data.message as string)
    else toast.info('No SMS is sent for this status.')
  }

  async function handleSubmit() {
    if (!caseData || !id) return
    if (delayIncomplete) {
      toast.error('Delayed needs a new date and a reason.')
      return
    }
    if (!dirty) {
      toast.info('Nothing to submit yet.')
      return
    }
    setSubmitting(true)
    const updates: Record<string, unknown> = {}
    if (statusChanged) updates.status = selectedStatus
    if (notesChanged) updates.notes = notesValue
    if (isDelayed) {
      updates.delayReason = delayReason.trim()
      if (delayDate) updates.expectedReturn = new Date(delayDate).toISOString()
    }

    const res = await labApi.updateCase(id, updates)
    if (!res.success) {
      setSubmitting(false)
      toast.error(res.error || 'Failed to submit')
      return
    }
    const updated = res.data as Partial<LabCaseDetail> | undefined
    const next = normalizeCase({ ...caseData, ...(updates as Partial<LabCaseDetail>), ...updated })
    setCaseData(next)

    let notified = false
    if (sendSms && canSms) {
      const sres = await labApi.notifyPatient(id, selectedStatus)
      notified = !!sres.success
      if (!sres.success) toast.warning(sres.error || 'Saved, but the SMS failed to send')
    }
    setSubmitting(false)
    setUpdateOpen(false)
    toast.success(notified ? 'Submitted · patient notified' : 'Submitted successfully')
    loadHistory(0)
  }

  const pageCount = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE))

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate('/lab/jobs')}
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs text-muted-foreground">{caseData.caseNumber}</p>
            <p className="truncate text-sm font-semibold">{caseData.serviceName}</p>
          </div>
          <Badge className="bg-primary/10 text-primary">{stageLabel(caseData.status)}</Badge>
        </div>
      </div>

      <div className="space-y-3 px-4 pt-4">
        {/* Patient — tinted, no vendor */}
        <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-sky-700/80">Patient</p>
              <p className="truncate text-sm font-semibold text-sky-950">
                {caseData.patient?.name ?? 'Unknown patient'}
              </p>
              {caseData.patient?.phone && !caseData.patient?.doNotContact ? (
                <a
                  href={`tel:${caseData.patient.phone}`}
                  className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-sky-700"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {caseData.patient.phone}
                </a>
              ) : caseData.patient?.doNotContact ? (
                <p className="mt-1 text-xs italic text-sky-700/70">Do not contact</p>
              ) : (
                <p className="mt-1 text-xs italic text-sky-700/70">No contact on file</p>
              )}
              {(caseData.toothNumbers.length > 0 || caseData.shade) && (
                <p className="mt-2 text-xs text-sky-800/80">
                  {[
                    caseData.toothNumbers.length > 0
                      ? `Teeth ${caseData.toothNumbers.join(', ')}`
                      : null,
                    caseData.shade ? `Shade ${caseData.shade}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs text-sky-700/80">Expected return</p>
              <p className="text-sm font-medium text-sky-950">
                {caseData.expectedReturn
                  ? format(new Date(caseData.expectedReturn), 'MMM d, yyyy')
                  : '—'}
              </p>
              {!isTerminal && dl && (
                <p
                  className={`text-xs font-medium ${dl.overdue ? 'text-red-600' : 'text-sky-700/80'}`}
                >
                  {dl.text}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Update progress — colored, opens the modal */}
        <NavCard
          tone="brand"
          icon={ClipboardList}
          title="Update progress"
          subtitle={`Current: ${stageLabel(caseData.status)}`}
          onClick={openUpdate}
        />

        {/* Status history */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-2 text-sm font-semibold">Status history</p>
          {history.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No changes yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {history.map((h) => (
                <li key={h.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {h.fromStatus ? (
                        <>
                          <span className="text-muted-foreground">{stageLabel(h.fromStatus)}</span>{' '}
                          <span className="text-muted-foreground">→</span>{' '}
                        </>
                      ) : null}
                      <span>{stageLabel(h.toStatus)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{h.byName ?? 'Unknown'}</p>
                  </div>
                  <p className="shrink-0 text-right text-[11px] text-muted-foreground">
                    {format(new Date(h.createdAt), 'MMM d, HH:mm')}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {historyTotal > HISTORY_PAGE && (
            <div className="mt-2 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {historyPage * HISTORY_PAGE + 1}–
                {Math.min((historyPage + 1) * HISTORY_PAGE, historyTotal)} of {historyTotal}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => loadHistory(historyPage - 1)}
                  disabled={historyPage === 0}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border disabled:opacity-40"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-1 text-xs tabular-nums text-muted-foreground">
                  {historyPage + 1}/{pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => loadHistory(historyPage + 1)}
                  disabled={historyPage >= pageCount - 1}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border disabled:opacity-40"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Update modal — the whole form */}
      <Dialog open={updateOpen} onOpenChange={setUpdateOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Update progress</DialogTitle>
            <DialogDescription>Set the stage, add notes, then Submit.</DialogDescription>
          </DialogHeader>

          {/* Stage */}
          <div className="space-y-1.5">
            {offerStages.map((step) => {
              const linIdx = LINEAR_ORDER.indexOf(step)
              const isCompleted = currentLinearIdx >= 0 && linIdx >= 0 && linIdx < currentLinearIdx
              const isCurrent = step === caseData.status
              const isSelected = selectedStatus === step
              return (
                <button
                  key={step}
                  type="button"
                  onClick={() => {
                    setSelectedStatus(step)
                    setPreviewMessage(null)
                  }}
                  className={`flex w-full items-center gap-3 rounded-md border p-2.5 text-left transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/10'
                      : isCurrent
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border hover:border-primary/40 hover:bg-muted/40'
                  }`}
                >
                  {isSelected ? (
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary">
                      <div className="h-2 w-2 rounded-full bg-primary-foreground" />
                    </div>
                  ) : isCompleted ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" />
                  )}
                  <span className={`flex-1 text-sm ${isCurrent ? 'font-semibold' : ''}`}>
                    {stageLabel(step)}
                  </span>
                  {isCurrent && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Current
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Delay details */}
          {isDelayed && (
            <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3">
              <div className="space-y-1">
                <label htmlFor="delayDate" className="text-xs font-medium text-muted-foreground">
                  New expected date
                </label>
                <input
                  id="delayDate"
                  name="delayDate"
                  type="date"
                  value={delayDate}
                  onChange={(e) => setDelayDate(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="delayReason" className="text-xs font-medium text-muted-foreground">
                  Reason
                </label>
                <textarea
                  id="delayReason"
                  name="delayReason"
                  rows={2}
                  value={delayReason}
                  onChange={(e) => setDelayReason(e.target.value)}
                  placeholder="Why is it delayed?"
                  className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1">
            <label htmlFor="labNotes" className="text-sm font-semibold">
              Notes
            </label>
            <textarea
              id="labNotes"
              name="labNotes"
              rows={3}
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              placeholder="Add notes for this case…"
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Notify */}
          {canSms && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="sendSms"
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <input
                    id="sendSms"
                    name="sendSms"
                    type="checkbox"
                    checked={sendSms}
                    onChange={(e) => setSendSms(e.target.checked)}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                  Send SMS to patient
                </label>
                <button
                  type="button"
                  onClick={togglePreview}
                  className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  {previewMessage ? 'Hide preview' : 'Preview message'}
                </button>
              </div>
              {previewMessage && (
                <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-xs">
                  {previewMessage}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setUpdateOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || !dirty || delayIncomplete}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
