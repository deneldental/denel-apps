'use client'

import { useEffect, useState } from 'react'
import Footer from '@/components/footer'
import NavigationMenu from '@/components/navigation-menu'
import PageHeader from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'

type AppointmentType = { id: string; name: string; displayName: string | null }

export default function AppointmentsPage() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preferredDate, setPreferredDate] = useState<Date | undefined>(undefined)
  const [isCalendarOpen, setIsCalendarOpen] = useState(false)
  // Service options come from the clinic's canonical appointment-type lookup so
  // a website request converts to a consistent appointment type. If the list
  // can't be loaded, the form falls back to a free-text field.
  const [serviceTypes, setServiceTypes] = useState<AppointmentType[]>([])

  useEffect(() => {
    let active = true
    fetch('/api/appointment-types')
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j: { data?: AppointmentType[] }) => {
        if (active && Array.isArray(j.data)) setServiceTypes(j.data)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  async function onSubmit(formData: FormData) {
    setIsSubmitting(true)
    setSuccess(null)
    setError(null)
    try {
      const payload = {
        fullName: String(formData.get('fullName') || ''),
        phone: String(formData.get('phone') || ''),
        service: String(formData.get('service') || ''),
        preferredDate: String(formData.get('preferredDate') || ''),
        message: String(formData.get('message') || ''),
      }

      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to submit appointment')
      }

      setSuccess('Thanks! Your appointment request has been received.')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <NavigationMenu />
      <PageHeader
        title="Book an Appointment"
        description="Please fill out the form and we'll get back to you to confirm your appointment."
        backgroundImage="/bg03.jpg"
      />
      <div className="container mx-auto max-w-3xl px-4 py-10">
        <form
          className="mt-8 grid grid-cols-1 gap-4"
          action={async (fd) => {
            await onSubmit(fd)
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Full name</span>
              <Input
                name="fullName"
                placeholder="John Doe"
                className="focus-visible:ring-gray-900 focus-visible:border-gray-900"
                required
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium">Phone</span>
              <Input
                name="phone"
                placeholder="(233)54-123-4567"
                className="focus-visible:ring-gray-900 focus-visible:border-gray-900"
                required
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Preferred date</span>
              <div className="relative">
                <Button
                  variant="outline"
                  type="button"
                  className="w-full justify-start text-left font-normal focus-visible:ring-gray-900 focus-visible:border-gray-900"
                  onClick={() => setIsCalendarOpen((v) => !v)}
                >
                  {preferredDate ? preferredDate.toLocaleDateString() : 'Pick a date'}
                </Button>
                {isCalendarOpen ? (
                  <div className="absolute z-50 mt-2 rounded-md border bg-background p-2 shadow-md">
                    <Calendar
                      mode="single"
                      selected={preferredDate}
                      onSelect={(d) => {
                        setPreferredDate(d)
                        setIsCalendarOpen(false)
                      }}
                      classNames={
                        {
                          day: 'h-9 w-9 p-0 font-normal aria-selected:opacity-100 focus:ring-2 focus:ring-gray-900 focus:ring-offset-1',
                          day_selected:
                            'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground focus:ring-2 focus:ring-gray-900 focus:ring-offset-1',
                        } as any
                      }
                    />
                  </div>
                ) : null}
                <Input
                  type="hidden"
                  name="preferredDate"
                  value={preferredDate ? preferredDate.toISOString().split('T')[0] : ''}
                  required
                />
              </div>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium">How can we help you?</span>
              {serviceTypes.length > 0 ? (
                <select
                  name="service"
                  required
                  defaultValue=""
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:border-gray-900 focus-visible:ring-offset-2"
                >
                  <option value="" disabled>
                    Select a service…
                  </option>
                  {serviceTypes.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.displayName || t.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  name="service"
                  placeholder="Cleaning, whitening, checkup..."
                  className="focus-visible:ring-gray-900 focus-visible:border-gray-900"
                  required
                />
              )}
            </label>
          </div>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Additional details</span>
            <textarea
              name="message"
              placeholder="Tell us anything important ahead of your visit"
              className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:border-gray-900 focus-visible:ring-offset-2"
            />
          </label>

          <div className="mt-2 flex items-center gap-3">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-[#B8873A] text-black hover:bg-[#9C7231]"
            >
              {isSubmitting ? 'Submitting...' : 'Submit request'}
            </Button>
            {error ? <span className="text-sm text-red-600">{error}</span> : null}
          </div>
        </form>
      </div>

      {/* Success Modal */}
      {success ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="appointment-success-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSuccess(null)
          }}
        >
          <div className="absolute inset-0 bg-black/50" onClick={() => setSuccess(null)} />
          <div className="relative z-[101] w-[90%] max-w-md rounded-lg border bg-background p-6 shadow-xl">
            <h2 id="appointment-success-title" className="text-lg font-semibold">
              Thank you!
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{success}</p>
            <div className="mt-6 flex justify-end ">
              <Button onClick={() => setSuccess(null)}>Close</Button>
            </div>
          </div>
        </div>
      ) : null}
      <Footer />
    </>
  )
}
