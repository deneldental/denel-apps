import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  getLabCase,
  getLabCaseStatuses,
  getLabStatusHistory,
  type LabStageConfig,
  type LabStatusHistoryRow,
  labNotifyPatient,
  labSmsPreview,
  updateLabCase,
} from '@/lib/actions/lab-workflow'
import { useCan } from '@/lib/permissions-context'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Textarea } from '@/shared/components/ui/textarea'

interface LabCase {
  id: string
  caseNumber: string
  serviceName: string
  status: string
  expectedReturn: string | null
  notes: string | null
  delayReason: string | null
  patient: { id: string; name: string; phone?: string | null } | null
  vendor: { id: string; name: string } | null
}

const HISTORY_PAGE = 10

function toDateInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

export default function LabCaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isReadOnly = !useCan('labs', 'update')

  const [selectedStatus, setSelectedStatus] = useState('')
  const [notes, setNotes] = useState('')
  const [delayDate, setDelayDate] = useState('')
  const [delayReason, setDelayReason] = useState('')
  const [sendSms, setSendSms] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewMessage, setPreviewMessage] = useState('')

  const [historyPage, setHistoryPage] = useState(0)

  const CASE_KEY = queryKeys.labs.caseDetail(id ?? '')
  const caseQuery = useApiQuery<LabCase>(CASE_KEY, () => getLabCase(id as string), {
    enabled: !!id,
  })
  const labCase = caseQuery.data ?? null

  // Nested under CASE_KEY so invalidating the case (a status/notes update
  // writes a new history row) also invalidates every cached history page.
  const historyQuery = useApiQuery(
    [...CASE_KEY, 'history', historyPage] as const,
    async () => {
      const res = await getLabStatusHistory(id as string, HISTORY_PAGE, historyPage * HISTORY_PAGE)
      return {
        success: res.success,
        data: {
          rows: res.data ?? [],
          // `total` is a top-level sibling of `data` (not part of ApiResponse's typed fields).
          total: (res as unknown as { total?: number }).total ?? 0,
        },
        error: res.error,
      }
    },
    { enabled: !!id }
  )
  const history = historyQuery.data?.rows ?? []
  const historyTotal = historyQuery.data?.total ?? 0

  // Shares the key `settings/components/lab-workflow-section.tsx` uses for
  // the same stage-label admin data.
  const stagesQuery = useApiQuery<LabStageConfig[]>(['lab-workflow', 'stages'] as const, () =>
    getLabCaseStatuses()
  )
  const stages = stagesQuery.data ?? []

  const loading = caseQuery.isLoading || historyQuery.isLoading

  // Re-seed the editable fields whenever the case's own values change —
  // initial load, or after a successful submit's refetch. Keyed on those values,
  // not on the whole object: the case carries the patient's photo, whose link is
  // re-signed every 15 minutes, and that must not wipe what is being typed.
  const seedId = caseQuery.data?.id
  const seedStatus = caseQuery.data?.status
  const seedNotes = caseQuery.data?.notes ?? ''
  const seedDelayReason = caseQuery.data?.delayReason ?? ''
  const seedReturn = caseQuery.data?.expectedReturn ?? null
  useEffect(() => {
    if (!seedId || seedStatus === undefined) return
    setSelectedStatus(seedStatus)
    setNotes(seedNotes)
    setDelayReason(seedDelayReason)
    setDelayDate(toDateInput(seedReturn))
  }, [seedId, seedStatus, seedNotes, seedDelayReason, seedReturn])

  const updateCaseMutation = useApiMutation(
    (updates: Record<string, unknown>) => updateLabCase(id as string, updates),
    { invalidates: [CASE_KEY] }
  )

  const stageByName = (name: string) => stages.find((s) => s.name === name)
  const stageLabel = (name: string) => stageByName(name)?.displayName ?? name.replace(/_/g, ' ')
  const activeStages = stages.filter((s) => s.isActive)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!labCase) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/labs')}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to Lab
        </Button>
        <p className="mt-4 text-sm text-muted-foreground">Case not found.</p>
      </div>
    )
  }

  const isDelayed = selectedStatus === 'delayed'
  const canSms = !!stageByName(selectedStatus)?.smsTemplate
  const statusChanged = selectedStatus !== labCase.status
  const notesChanged = (notes ?? '') !== (labCase.notes ?? '')
  const delayIncomplete = isDelayed && (!delayDate || !delayReason.trim())
  const dirty = statusChanged || notesChanged

  // isReadOnly already checked

  const sortedStages = [...activeStages].sort((a, b) => a.sortOrder - b.sortOrder)
  const timelineStages = sortedStages.filter((s) => s.name !== 'delayed' && s.name !== 'cancelled')
  const currentStageIndex = timelineStages.findIndex((s) => s.name === labCase.status)

  async function openPreview() {
    if (!id) return
    const res = await labSmsPreview(id, selectedStatus)
    if (res.success && res.data?.hasTemplate && res.data.message) {
      setPreviewMessage(res.data.message)
      setPreviewOpen(true)
    } else {
      toast.info('No SMS is sent for this status.')
    }
  }

  async function handleSubmit() {
    if (!id || !labCase) return
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
    if (notesChanged) updates.notes = notes
    if (isDelayed) {
      updates.delayReason = delayReason.trim()
      if (delayDate) updates.expectedReturn = new Date(delayDate).toISOString()
    }
    try {
      await updateCaseMutation.mutateAsync(updates)
    } catch (err) {
      setSubmitting(false)
      toast.error(err instanceof Error ? err.message : 'Failed to submit')
      return
    }
    let notified = false
    if (sendSms && canSms) {
      const sres = await labNotifyPatient(id, selectedStatus)
      notified = !!sres.success
      if (!sres.success) toast.warning(sres.error || 'Saved, but the SMS failed to send')
    }
    setSubmitting(false)
    setSendSms(false)
    toast.success(notified ? 'Submitted · patient notified' : 'Submitted successfully')
    setHistoryPage(0)
  }

  const pageCount = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE))

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/labs')}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Lab
        </Button>
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">{labCase.caseNumber}</p>
          <h1 className="truncate text-xl font-bold tracking-tight">{labCase.serviceName}</h1>
        </div>
        <Badge className="ml-auto">{stageLabel(labCase.status)}</Badge>
      </div>

      {/* Summary */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Patient</p>
            <p className="text-sm font-medium">{labCase.patient?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Phone</p>
            <p className="text-sm font-medium">{labCase.patient?.phone ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Vendor</p>
            <p className="text-sm font-medium">{labCase.vendor?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Expected return</p>
            <p className="text-sm font-medium">
              {labCase.expectedReturn ? new Date(labCase.expectedReturn).toLocaleDateString() : '—'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Update progress */}
      <Card className="shadow-lg border-muted/40 overflow-hidden">
        <CardHeader className="bg-muted/10 pb-6 border-b border-muted/20">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-bold">Update progress</CardTitle>
              <CardDescription>
                {isReadOnly
                  ? 'View current progress status and notes (Read-Only for Doctors).'
                  : 'Change the stage, add notes, and optionally notify the patient.'}
              </CardDescription>
            </div>
            {isReadOnly && (
              <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">
                Read-Only
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-8 pt-8">
          {/* Stepper Timeline.
              `overflow-x-auto` also clips vertically, so the scroll box needs
              its own top/bottom padding — without it the active step's ring-4
              and the hover:scale-105 lift get sliced off. */}
          <div className="w-full overflow-x-auto px-1 pt-4 pb-6">
            <div className="flex items-start justify-between min-w-[700px] px-8 pt-6 pb-2 relative">
              {timelineStages.map((s, idx) => {
                const isCompleted = currentStageIndex !== -1 && idx < currentStageIndex
                const isCurrent = currentStageIndex !== -1 && idx === currentStageIndex
                const isSelected = selectedStatus === s.name

                return (
                  <div key={s.id} className="flex-1 flex items-center group/step">
                    <div className="flex flex-col items-center relative">
                      {/* Step Circle Button */}
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => setSelectedStatus(s.name)}
                        className={`relative z-10 flex h-11 w-11 items-center justify-center rounded-full border-2 transition-all duration-300 shadow-sm ${
                          isCompleted
                            ? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600'
                            : isCurrent
                              ? 'border-blue-600 bg-blue-50 text-blue-600 ring-4 ring-blue-100'
                              : 'border-muted-foreground/30 bg-background text-muted-foreground/50 hover:border-muted-foreground/60'
                        } ${isSelected && !isCurrent ? 'ring-2 ring-primary ring-offset-2' : ''} ${
                          !isReadOnly ? 'cursor-pointer hover:scale-105' : 'cursor-default'
                        }`}
                      >
                        {isCompleted ? (
                          <Check className="h-5 w-5 stroke-[2.5]" />
                        ) : (
                          <span className="text-xs font-bold">{idx + 1}</span>
                        )}
                      </button>

                      {/* Step Labels */}
                      <div className="mt-4 text-center flex flex-col items-center">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground/50">
                          Step {idx + 1}
                        </span>
                        <span
                          className={`text-xs font-bold mt-0.5 max-w-[120px] truncate ${
                            isSelected ? 'text-blue-600 font-extrabold' : 'text-foreground/90'
                          }`}
                        >
                          {s.displayName}
                        </span>

                        {/* Status badge pill under each step */}
                        <button
                          type="button"
                          disabled={isReadOnly}
                          onClick={() => setSelectedStatus(s.name)}
                          className={`mt-2.5 inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide transition-all border ${
                            isCompleted
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50 hover:bg-emerald-100'
                              : isCurrent
                                ? 'bg-blue-100 text-blue-800 border border-blue-200 hover:bg-blue-200'
                                : 'bg-muted/60 text-muted-foreground/75 border border-muted hover:bg-muted'
                          } ${isSelected ? 'ring-1 ring-blue-600' : ''} ${
                            isReadOnly ? 'pointer-events-none' : 'cursor-pointer'
                          }`}
                        >
                          {isCompleted ? 'Completed' : isCurrent ? 'Active' : 'Pending'}
                        </button>
                      </div>
                    </div>

                    {/* Step line to the next circle. Anchored to the top of the
                        row (circle is h-11, so 21px centers the 2px rule on it)
                        rather than floated up from centre with a negative
                        margin — that old offset silently drifted whenever the
                        label block below changed height. */}
                    {idx < timelineStages.length - 1 && (
                      <div
                        className={`h-[2px] flex-1 mx-4 self-start mt-5.25 transition-colors duration-500 ${
                          idx < currentStageIndex ? 'bg-emerald-500' : 'bg-muted-foreground/20'
                        }`}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Exception status pills (delayed / cancelled) */}
          <div className="flex flex-wrap items-center gap-3 pt-6 border-t border-muted/20">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">
              Other status actions:
            </span>
            {['delayed', 'cancelled'].map((exName) => {
              const exStage = stageByName(exName)
              if (!exStage) return null
              const isSelected = selectedStatus === exName
              const isCurrent = labCase.status === exName
              return (
                <button
                  key={exStage.id}
                  type="button"
                  disabled={isReadOnly}
                  onClick={() => setSelectedStatus(exName)}
                  className={`inline-flex items-center rounded-full px-3.5 py-1.5 text-xs font-bold transition-all border ${
                    isSelected
                      ? exName === 'cancelled'
                        ? 'bg-red-100 text-red-800 border-red-300 ring-2 ring-red-600 ring-offset-1'
                        : 'bg-amber-100 text-amber-800 border-amber-300 ring-2 ring-amber-600 ring-offset-1'
                      : isCurrent
                        ? exName === 'cancelled'
                          ? 'bg-red-50 text-red-700 border-red-200 animate-pulse'
                          : 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse'
                        : exName === 'cancelled'
                          ? 'bg-red-50/50 text-red-600 hover:bg-red-50 border-red-100'
                          : 'bg-amber-50/50 text-amber-600 hover:bg-amber-50 border-amber-100'
                  } ${isReadOnly ? 'pointer-events-none' : 'cursor-pointer hover:scale-105'}`}
                >
                  {exStage.displayName}
                  {isCurrent && (
                    <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-current animate-ping" />
                  )}
                </button>
              )
            })}
          </div>

          {/* Delayed details section (if active or selected status is delayed) */}
          {isDelayed && (
            <div className="grid gap-4 sm:grid-cols-2 p-4 rounded-xl bg-amber-50/40 border border-amber-100 transition-all duration-300">
              <div className="space-y-1.5">
                <Label htmlFor="delayDate" className="text-amber-900 font-bold">
                  New expected return date
                </Label>
                <Input
                  id="delayDate"
                  type="date"
                  disabled={isReadOnly}
                  value={delayDate}
                  onChange={(e) => setDelayDate(e.target.value)}
                  className="bg-background border-amber-200 focus-visible:ring-amber-500"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="delayReason" className="text-amber-900 font-bold">
                  Reason for delay
                </Label>
                <Textarea
                  id="delayReason"
                  rows={2}
                  disabled={isReadOnly}
                  value={delayReason}
                  onChange={(e) => setDelayReason(e.target.value)}
                  placeholder="Why is this case delayed?"
                  className="bg-background border-amber-200 focus-visible:ring-amber-500"
                />
              </div>
            </div>
          )}

          {/* Notes Area */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="notes" className="font-bold">
                Case notes
              </Label>
              {notesChanged && (
                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                  Unsaved changes
                </span>
              )}
            </div>
            <Textarea
              id="notes"
              rows={3}
              disabled={isReadOnly}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add internal notes for this lab case…"
              className="resize-none focus-visible:ring-primary"
            />
          </div>

          {/* Footer Actions (Only render if write access) */}
          {!isReadOnly && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-muted/20">
              {canSms ? (
                <div className="flex items-center gap-3">
                  <label
                    htmlFor="sendSms"
                    className="flex items-center gap-2.5 text-sm font-medium text-muted-foreground hover:text-foreground cursor-pointer select-none"
                  >
                    <input
                      id="sendSms"
                      type="checkbox"
                      checked={sendSms}
                      onChange={(e) => setSendSms(e.target.checked)}
                      className="h-4 w-4 rounded border-muted/40 text-primary focus:ring-primary accent-primary cursor-pointer"
                    />
                    Send SMS notification to patient
                  </label>
                  <button
                    type="button"
                    onClick={openPreview}
                    className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors hover:underline"
                  >
                    Preview template
                  </button>
                </div>
              ) : (
                <span className="text-xs font-medium text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-md">
                  Patient SMS notifications are not supported for this status.
                </span>
              )}

              <div className="flex items-center gap-3">
                {dirty && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedStatus(labCase.status)
                      setNotes(labCase.notes ?? '')
                      setDelayReason(labCase.delayReason ?? '')
                      setDelayDate(toDateInput(labCase.expectedReturn))
                    }}
                    className="text-xs font-semibold"
                  >
                    Reset changes
                  </Button>
                )}
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || !dirty || delayIncomplete}
                  className="font-bold shadow-md bg-blue-600 hover:bg-blue-700 text-white transition-all duration-200"
                >
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save updates
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Status history</CardTitle>
          <CardDescription>Every progress change on this case, and who made it.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No changes yet.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Change</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell>
                        {h.fromStatus ? (
                          <span className="text-muted-foreground">
                            {stageLabel(h.fromStatus)} →{' '}
                          </span>
                        ) : null}
                        <span className="font-medium">{stageLabel(h.toStatus)}</span>
                      </TableCell>
                      <TableCell>{h.byName ?? 'Unknown'}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {new Date(h.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {historyTotal > HISTORY_PAGE && (
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {historyPage * HISTORY_PAGE + 1}–
                    {Math.min((historyPage + 1) * HISTORY_PAGE, historyTotal)} of {historyTotal}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={historyPage === 0}
                      onClick={() => setHistoryPage(historyPage - 1)}
                    >
                      Prev
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {historyPage + 1}/{pageCount}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={historyPage >= pageCount - 1}
                      onClick={() => setHistoryPage(historyPage + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* SMS preview */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Message preview</DialogTitle>
            <DialogDescription>Sent to the patient when you submit with SMS on.</DialogDescription>
          </DialogHeader>
          <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-sm">
            {previewMessage}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
