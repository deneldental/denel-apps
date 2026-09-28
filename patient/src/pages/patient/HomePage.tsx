import { WelcomeCard } from '@denel/ui/blocks'
import { formatAmount } from '@denel/utils'
import {
  Bell,
  Calendar,
  ChevronRight,
  CreditCard,
  FileText,
  Loader2,
  Receipt,
  ScanLine,
  Wallet,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { usePatientAuth } from '@/lib/patient-auth'

/** Friendly "how soon" label for the next appointment. */
function relativeWhen(dateStr: string): string {
  const target = new Date(dateStr)
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const days = Math.round((target.getTime() - startOfToday.getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 7) return `In ${days} days`
  if (days < 14) return 'Next week'
  return target.toLocaleDateString('en-GH', { month: 'short', day: 'numeric' })
}

interface Summary {
  upcomingAppointment: { date: string; type: string; doctorName: string } | null
  openInvoiceCount: number
  outstandingBalance: number
  walletBalance: number
}

export default function PatientHomePage() {
  const { patient } = usePatientAuth()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      // biome-ignore lint/suspicious/noExplicitAny: patient-portal payloads are loosely typed
      api.get<any[]>('/api/patient-portal/appointments'),
      // biome-ignore lint/suspicious/noExplicitAny: patient-portal payloads are loosely typed
      api.get<{ invoices: any[]; wallet: any }>('/api/patient-portal/payments'),
    ])
      .then(([apptRes, payRes]) => {
        // biome-ignore lint/suspicious/noExplicitAny: loose payload
        const appointments: any[] = apptRes.data ?? []
        const upcoming = appointments
          .filter((a) => new Date(a.date) >= new Date() && a.status === 'scheduled')
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0]

        // biome-ignore lint/suspicious/noExplicitAny: loose payload
        // Backend returns active patient invoices only; outstanding is the sum
        // of the authoritative `balance` column (matches the portal). Money
        // fields arrive as strings (Postgres numeric) — coerce to numbers.
        const invoices: any[] = payRes.data?.invoices ?? []
        const openInvoices = invoices.filter((i) => Number(i.balance ?? 0) > 0)
        const outstandingBalance = openInvoices.reduce((sum, i) => sum + Number(i.balance ?? 0), 0)

        setSummary({
          upcomingAppointment: upcoming
            ? {
                date: upcoming.date,
                type: upcoming.type,
                doctorName: upcoming.doctor?.user?.name ?? 'Your doctor',
              }
            : null,
          openInvoiceCount: openInvoices.length,
          outstandingBalance,
          walletBalance: Number(payRes.data?.wallet?.creditBalance ?? 0),
        })
      })
      .finally(() => setLoading(false))
  }, [])

  const openCount = summary?.openInvoiceCount ?? 0
  const outstanding = summary?.outstandingBalance ?? 0

  return (
    <div className="space-y-6 p-5 pb-8">
      {/* Welcome card */}
      <WelcomeCard name={patient?.name?.split(' ')[0] ?? 'there'} subtitle={patient?.patientId} />

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Next appointment — sky, with a "how soon" indicator pill */}
          <Link
            to="/patient/appointments"
            className="block rounded-2xl border border-sky-100 bg-sky-50 p-4 transition-colors hover:border-sky-300"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                <Calendar className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                    Next appointment
                  </p>
                  {summary?.upcomingAppointment && (
                    <span className="rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                      {relativeWhen(summary.upcomingAppointment.date)}
                    </span>
                  )}
                </div>
                {summary?.upcomingAppointment ? (
                  <>
                    <p className="mt-0.5 text-sm font-semibold text-sky-900">
                      {new Date(summary.upcomingAppointment.date).toLocaleDateString('en-GH', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                      {' · '}
                      {new Date(summary.upcomingAppointment.date).toLocaleTimeString('en-GH', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                    <p className="truncate text-xs capitalize text-sky-700/80">
                      {summary.upcomingAppointment.type} · {summary.upcomingAppointment.doctorName}
                    </p>
                  </>
                ) : (
                  <p className="mt-0.5 text-sm text-sky-700/70">No upcoming appointments</p>
                )}
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-sky-400" />
            </div>
          </Link>

          {/* Stats — outstanding (rose when owed, else emerald) + wallet (teal) */}
          <div className="grid grid-cols-2 gap-3">
            <Link
              to="/patient/payments"
              className={`rounded-2xl border p-4 transition-colors ${
                outstanding > 0
                  ? 'border-rose-100 bg-rose-50 hover:border-rose-300'
                  : 'border-emerald-100 bg-emerald-50 hover:border-emerald-300'
              }`}
            >
              <div
                className={`mb-2 flex h-9 w-9 items-center justify-center rounded-xl ${
                  outstanding > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                <CreditCard className="h-4 w-4" />
              </div>
              <p
                className={`text-2xl font-bold ${outstanding > 0 ? 'text-rose-900' : 'text-emerald-900'}`}
              >
                GHS {formatAmount(outstanding)}
              </p>
              <p
                className={`mt-0.5 text-xs ${outstanding > 0 ? 'text-rose-700/80' : 'text-emerald-700/80'}`}
              >
                outstanding balance
              </p>
            </Link>

            <Link
              to="/patient/payments"
              className="rounded-2xl border border-teal-100 bg-teal-50 p-4 transition-colors hover:border-teal-300"
            >
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-teal-100 text-teal-700">
                <Wallet className="h-4 w-4" />
              </div>
              <p className="text-2xl font-bold text-teal-900">
                GHS {formatAmount(summary?.walletBalance ?? 0)}
              </p>
              <p className="mt-0.5 text-xs text-teal-700/80">wallet credit</p>
            </Link>
          </div>

          {/* Records — violet */}
          <Link
            to="/patient/records"
            className="flex items-center gap-3 rounded-2xl border border-violet-100 bg-violet-50 p-4 transition-colors hover:border-violet-300"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-violet-900">Medical records</p>
              <p className="text-xs text-violet-700/80">Treatment history & notes</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-violet-400" />
          </Link>

          {/* X-rays (indigo) + Reminders (amber) */}
          <div className="grid grid-cols-2 gap-3">
            <Link
              to="/patient/xrays"
              className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 transition-colors hover:border-indigo-300"
            >
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
                <ScanLine className="h-4 w-4" />
              </div>
              <p className="text-sm font-semibold text-indigo-900">X-rays</p>
              <p className="text-xs text-indigo-700/80">Imaging history</p>
            </Link>
            <Link
              to="/patient/reminders"
              className="rounded-2xl border border-amber-100 bg-amber-50 p-4 transition-colors hover:border-amber-300"
            >
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                <Bell className="h-4 w-4" />
              </div>
              <p className="text-sm font-semibold text-amber-900">Reminders</p>
              <p className="text-xs text-amber-700/80">Clinic notifications</p>
            </Link>
          </div>

          {/* Invoices — orange */}
          <Link
            to="/patient/payments"
            className="flex items-center gap-3 rounded-2xl border border-orange-100 bg-orange-50 p-4 transition-colors hover:border-orange-300"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-700">
              <Receipt className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-orange-900">Invoices</p>
              <p className="text-xs text-orange-700/80">
                {openCount > 0
                  ? `${openCount} pending payment${openCount === 1 ? '' : 's'}`
                  : 'All settled — nothing due'}
              </p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-orange-400" />
          </Link>
        </div>
      )}
    </div>
  )
}
