import { ArrowLeft, Loader2, Paperclip, Send, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { staffApi } from '@/lib/api'
import { cn } from '@/lib/utils'

// A "Request" (top level) and its "Types" both come from the configurable
// lookup (HR Settings → Requests & types). The four built-in requests drive
// special behaviour via their flags (showsDates / showsAmount).
type RequestKind = {
  name: string
  displayName: string
  showsDates: boolean
  showsAmount: boolean
}

type RequestSubtype = { id: string; category: string; name: string; displayName: string }

type LeaveBalanceData = {
  year: number
  entitlement: number
  used: number
  remaining: number
  split: {
    totalQuota: number
    annualQuota: number
    annualRemaining: number
    casualQuota: number
    casualRemaining: number
    casualExhausted: boolean
  }
}

const urgencyLevels = ['low', 'normal', 'high', 'urgent'] as const

export default function NewRequestPage() {
  const navigate = useNavigate()
  const [requestType, setRequestType] = useState('')
  const [subType, setSubType] = useState('')
  const [reason, setReason] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [amount, setAmount] = useState('')
  const [urgencyLevel, setUrgencyLevel] = useState('normal')
  const [attachments, setAttachments] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [subtypes, setSubtypes] = useState<RequestSubtype[]>([])
  const [kinds, setKinds] = useState<RequestKind[]>([])
  const [leaveBalance, setLeaveBalance] = useState<LeaveBalanceData | null>(null)

  useEffect(() => {
    staffApi.getRequestTypes().then((res) => {
      if (res.success && Array.isArray(res.data)) setSubtypes(res.data as RequestSubtype[])
    })
    staffApi.getRequestKinds().then((res) => {
      if (res.success && Array.isArray(res.data)) setKinds(res.data as RequestKind[])
    })
    staffApi.getLeaveBalance().then((res) => {
      if (res.success && res.data) setLeaveBalance(res.data as LeaveBalanceData)
    })
  }, [])

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length) setAttachments((prev) => [...prev, ...files])
    // Allow re-selecting the same file
    e.target.value = ''
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx))
  }

  const subTypeOptions = subtypes.filter((s) => s.category === requestType)
  const selectedKind = kinds.find((k) => k.name === requestType)
  const showDates = selectedKind?.showsDates ?? false
  const showAmount = selectedKind?.showsAmount ?? false

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!requestType) {
      setError('Please select a request')
      return
    }
    if (!reason.trim()) {
      setError('Please provide a reason')
      return
    }
    // Kind-aware validation (mirrors the HR file-on-behalf form). Without this a
    // dates-required request could be filed with blank dates, which then skips
    // the attendance-excuse + leave-balance paths on approval.
    if (showDates) {
      if (!startDate || !endDate) {
        setError('Please provide both a start and end date')
        return
      }
      if (new Date(endDate) < new Date(startDate)) {
        setError('End date cannot be before the start date')
        return
      }
    }
    if (showAmount) {
      const parsed = parseFloat(amount)
      if (!amount || Number.isNaN(parsed) || parsed <= 0) {
        setError('Please enter an amount greater than zero')
        return
      }
    }

    setLoading(true)

    // Upload any attachments first, then submit the request with their URLs.
    let uploaded: { name: string; url: string }[] = []
    try {
      uploaded = await Promise.all(
        attachments.map(async (f) => {
          const up = await staffApi.uploadAttachment(f)
          const url = (up as { url?: string }).url
          if (!up.success || !url) throw new Error(up.error || 'upload failed')
          return { name: f.name, url }
        })
      )
    } catch {
      setLoading(false)
      setError('Could not upload one or more attachments. Please try again.')
      return
    }

    const res = await staffApi.submitRequest({
      requestType,
      subType: subType || undefined,
      reason: reason.trim(),
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      amount: amount ? parseFloat(amount) : undefined,
      urgencyLevel,
      attachments: uploaded,
    })
    setLoading(false)

    if (res.success) {
      navigate('/requests', { replace: true })
    } else {
      setError(res.error || 'Failed to submit request')
    }
  }

  return (
    <div className="page-enter p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={20} />
        </Button>
        <h1 className="text-xl font-bold tracking-tight">New Request</h1>
      </div>

      <Card>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive leading-snug">
                {error}
              </div>
            )}

            {/* Request */}
            <div className="space-y-1.5">
              <Label>Request *</Label>
              <Select
                value={requestType}
                onValueChange={(v) => {
                  setRequestType(v)
                  setSubType('')
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select request..." />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((k) => (
                    <SelectItem key={k.name} value={k.name}>
                      {k.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Sub Type */}
            {requestType && subTypeOptions.length > 0 && (
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={subType} onValueChange={setSubType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {subTypeOptions.map((st) => (
                      <SelectItem key={st.id} value={st.name}>
                        {st.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Leave balance — Total Leave split into Annual (single block) +
                Casual (in bits) — Phase 5. */}
            {requestType === 'leave' && leaveBalance && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold">Total Leave · {leaveBalance.year}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {leaveBalance.remaining}/{leaveBalance.entitlement} days left
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border bg-background px-2.5 py-1.5">
                    <p className="text-[11px] text-muted-foreground">Annual Leave · single block</p>
                    <p className="text-sm font-semibold tabular-nums">
                      {leaveBalance.split.annualRemaining}
                      <span className="font-normal text-muted-foreground">
                        /{leaveBalance.split.annualQuota} left
                      </span>
                    </p>
                  </div>
                  <div
                    className={cn(
                      'rounded-md border bg-background px-2.5 py-1.5',
                      leaveBalance.split.casualExhausted && 'border-amber-400/60'
                    )}
                  >
                    <p className="text-[11px] text-muted-foreground">Casual Leave · in bits</p>
                    <p className="text-sm font-semibold tabular-nums">
                      {leaveBalance.split.casualRemaining}
                      <span className="font-normal text-muted-foreground">
                        /{leaveBalance.split.casualQuota} left
                      </span>
                    </p>
                  </div>
                </div>
                {leaveBalance.split.casualExhausted && (
                  <p className="text-[11px] text-amber-700">
                    Casual allowance used up — further casual leave needs management approval.
                  </p>
                )}
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Annual Leave is taken as one block; Casual Leave in smaller pieces. Together they
                  make up your {leaveBalance.entitlement}-day Total Leave. Annual beyond{' '}
                  {leaveBalance.split.annualQuota} days is drawn from your Casual allowance.
                </p>
              </div>
            )}

            {/* Dates */}
            {showDates && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Start Date</Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>End Date</Label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
            )}

            {/* Amount */}
            {showAmount && (
              <div className="space-y-1.5">
                <Label>Amount (GHS)</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                />
              </div>
            )}

            {/* Urgency */}
            <div className="space-y-1.5">
              <Label>Urgency Level</Label>
              <div className="flex gap-2 flex-wrap">
                {urgencyLevels.map((level) => (
                  <Button
                    key={level}
                    type="button"
                    size="sm"
                    variant={urgencyLevel === level ? 'default' : 'outline'}
                    onClick={() => setUrgencyLevel(level)}
                    className={cn(
                      'capitalize',
                      urgencyLevel === level &&
                        level === 'urgent' &&
                        'bg-destructive hover:bg-destructive/90'
                    )}
                  >
                    {level}
                  </Button>
                ))}
              </div>
            </div>

            {/* Reason */}
            <div className="space-y-1.5">
              <Label>Reason / Justification *</Label>
              <Textarea
                placeholder="Describe your request..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
              />
            </div>

            {/* Attachments */}
            <div className="space-y-1.5">
              <Label>Attachments</Label>
              <label className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border bg-secondary/40 px-3 py-2.5 text-sm text-muted-foreground cursor-pointer hover:bg-secondary/60 transition-colors">
                <Paperclip size={14} />
                <span>Add files (images / PDF)</span>
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  onChange={handleFiles}
                  className="hidden"
                />
              </label>
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {attachments.map((f, i) => (
                    <span
                      key={`${f.name}-${i}`}
                      className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium max-w-[180px]"
                    >
                      <span className="truncate">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(i)}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                        aria-label={`Remove ${f.name}`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send size={16} />
                  Submit Request
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
