import { format } from 'date-fns'
import { AlertCircle, Calendar, CheckCircle2, Wallet, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useBranding } from '@/lib/branding-context'
import { Button } from '@/shared/components/ui/button'
import { Skeleton } from '@/shared/components/ui/skeleton'

const API_URL = import.meta.env.VITE_API_URL

type ApptInfo = {
  firstName: string
  date: string
  doctorName: string | null
  currentResponse: 'yes' | 'no' | null
  alreadyActed: boolean
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; appt: ApptInfo }
  | { kind: 'done'; response: 'yes' | 'no' }

export default function AppointmentConfirmPage() {
  const { token } = useParams<{ token: string }>()
  const branding = useBranding()
  const [state, setState] = useState<ViewState>({ kind: 'loading' })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: 'Invalid or missing link.' })
      return
    }
    fetch(`${API_URL}/api/appointment-workflow/public/confirm/${token}`)
      .then(async (r) => {
        const json = await r.json()
        if (!r.ok || !json.success) {
          setState({ kind: 'error', message: json.error || 'Link not found or expired.' })
          return
        }
        setState({ kind: 'ready', appt: json.data })
      })
      .catch(() =>
        setState({ kind: 'error', message: 'Unable to reach the clinic. Please try again later.' })
      )
  }, [token])

  async function submit(response: 'yes' | 'no') {
    if (!token) return
    setSubmitting(true)
    try {
      const res = await fetch(`${API_URL}/api/appointment-workflow/public/confirm/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setState({ kind: 'error', message: json.error || 'Unable to save your response.' })
        return
      }
      setState({ kind: 'done', response })
    } catch {
      setState({ kind: 'error', message: 'Network error. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-muted/20">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="flex items-center gap-2 justify-center mb-6">
          <Wallet className="h-6 w-6" />
          <span className="font-semibold">{branding.name}</span>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm p-6 sm:p-8">
          {state.kind === 'loading' && (
            <div className="space-y-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {state.kind === 'error' && (
            <div className="text-center space-y-3">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertCircle className="h-6 w-6" />
              </div>
              <h1 className="text-xl font-semibold">Link unavailable</h1>
              <p className="text-sm text-muted-foreground">{state.message}</p>
              <p className="text-xs text-muted-foreground">
                Please call the clinic if you need help.
              </p>
            </div>
          )}

          {state.kind === 'ready' && (
            <>
              <div className="text-center space-y-1.5 mb-6">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Calendar className="h-6 w-6" />
                </div>
                <h1 className="text-xl font-semibold">Hi {state.appt.firstName}!</h1>
                <p className="text-sm text-muted-foreground">
                  You have an appointment with{' '}
                  <span className="font-medium text-foreground">
                    {state.appt.doctorName || 'your doctor'}
                  </span>{' '}
                  on
                </p>
                <p className="text-base font-semibold text-foreground">
                  {(() => {
                    try {
                      return format(new Date(state.appt.date), 'EEEE, MMM d, yyyy — h:mm a')
                    } catch {
                      return state.appt.date
                    }
                  })()}
                </p>
              </div>

              {state.appt.alreadyActed ? (
                <p className="text-center text-sm text-muted-foreground py-4">
                  This appointment has already been finalized and can no longer be changed from this
                  link.
                </p>
              ) : state.appt.currentResponse ? (
                <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-center text-sm">
                  <p>
                    You previously responded:{' '}
                    <span className="font-medium">
                      {state.appt.currentResponse === 'yes' ? 'Confirmed' : 'Cancelled'}
                    </span>
                    .
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Change your response below if needed.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-center text-muted-foreground mb-4">
                  Please let us know if you'll be there.
                </p>
              )}

              {!state.appt.alreadyActed && (
                <div className="grid grid-cols-2 gap-3 mt-5">
                  <Button
                    size="lg"
                    className="h-14 flex flex-col gap-0 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => submit('yes')}
                    disabled={submitting}
                  >
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="text-sm font-medium mt-0.5">Confirm</span>
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-14 flex flex-col gap-0 border-destructive text-destructive hover:bg-destructive/5"
                    onClick={() => submit('no')}
                    disabled={submitting}
                  >
                    <XCircle className="h-5 w-5" />
                    <span className="text-sm font-medium mt-0.5">Cancel</span>
                  </Button>
                </div>
              )}
            </>
          )}

          {state.kind === 'done' && (
            <div className="text-center space-y-3 py-3">
              <div
                className={`inline-flex h-12 w-12 items-center justify-center rounded-full ${
                  state.response === 'yes'
                    ? 'bg-emerald-100 text-emerald-600'
                    : 'bg-destructive/10 text-destructive'
                }`}
              >
                {state.response === 'yes' ? (
                  <CheckCircle2 className="h-6 w-6" />
                ) : (
                  <XCircle className="h-6 w-6" />
                )}
              </div>
              <h1 className="text-xl font-semibold">
                {state.response === 'yes' ? 'Thank you for confirming!' : 'Appointment cancelled'}
              </h1>
              <p className="text-sm text-muted-foreground">
                {state.response === 'yes'
                  ? 'We look forward to seeing you.'
                  : "We've marked your appointment as cancelled. Please call us to reschedule when ready."}
              </p>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Need help? Call the clinic directly.
        </p>
      </div>
    </div>
  )
}
